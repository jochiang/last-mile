// The "pedals" model: a two-axle car with weight transfer, for throttle/brake technique.
// - weight moves between the axles with longitudinal acceleration (lagged, like suspension):
//   braking loads the front and lightens the rear, power does the opposite
// - each axle's grip scales with its load, and is shared between cornering and braking/driving
//   (a friction circle): a locked or spinning axle keeps only a little side grip
// - rear-wheel drive, brakes biased to the front
// So: lifting mid-corner tightens the line, too much power swings the rear out, and braking
// while still on the throttle (left-foot braking) rotates the car without scrubbing speed.
// Body frame: u forward, v left, r yaw rate (+ = turning left, the heading h rising).
// Input: { steer: -1..1 (+ = right), throttle: 0..1, brake: 0..1 }. Holding the brake at a standstill
// engages reverse (the brake becomes the reverse throttle) until the gas is pressed.
//
// dynamics() is the car alone (it reads c.offAmt for grass); stepCar2() adds the race track's
// grass and barrier, and the city (src/city) adds its own buildings.

import { locate, ROAD, WALL, KERB } from "./track.js";
import { DT } from "./car.js";

export const P = {
  m: 1200, Iz: 1750, a: 1.2, b: 1.4, hcg: 0.55, g: 9.81,
  mu: 1.85, muOff: 1.55, B: 20, C: 1.4,        // tyre peak grip (peaks at ~6 deg of slip); a simplified Pacejka curve
  rearGrip: 1.2, BR: 26, CR: 1.25,            // rear: more grip, stiffer, gentler past the peak. Rear
                                              // stiffness per kg must beat the front's or the car oversteers
  power: 210000, fMax: 13500, drag: 1.35, roll: 30,
  grassV: 20, grassDrag: 450,                 // grass pulls you down toward ~110 km/h at full gas (N per m/s over), it doesn't anchor you
  brakeMax: 1.5, brakeRear: 0.8,              // total brake force in g; the rear gets this much of its share of
                                              // the load (a proportioning valve: the fronts lock first, braking stays stable)
  steerMax: 0.6, steerSpeed: 15.5,             // lock shrinks with speed, ~what the tyres can use: steerMax / (1 + (u / steerSpeed)^2)
  steerRate: 4,                               // full locks per second: the wheel can't snap, whatever the thumb does
  revForce: 6000, revMax: 8, revHold: 0.35,   // reverse: pull, top speed (m/s), seconds of brake at a standstill to engage
  lockFloor: 0.35,                            // side grip left on a locked or spinning axle
  loadLag: 0.1,                               // seconds for weight to move between axles
  loadSens: 0.4,                              // grip per kg falls as load rises (real tyres): tempers weight transfer
  sub: 4,                                     // substeps per tick (tyres are stiff)
};
const HALF_W = 1.0;

export function makeCar2(tr, i = 6) {
  return {
    model: "pedals", x: tr.x[i], z: tr.z[i], h: tr.heading[i], u: 0, v: 0, r: 0, vx: 0, vz: 0,
    delta: 0, ax: 0, loadF: 0.5, slipF: 0, slipR: 0, slip: 0, gripF: 1, gripR: 1,
    off: false, offAmt: 0, wallT: 0, stuckT: 0, i, d: 0, events: [], reverse: false, revT: 0,
    // the arcade model's fields, so the HUD and renderer can treat both alike
    drifting: false, charge: 0, tier: 0, boost: 0,
  };
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const q = { i: 0, d: 0 };

export function stepCar2(c, inp, tr, p = P) {
  c.events.length = 0;
  dynamics(c, inp, p);
  trackEnv(c, inp, tr);
}

/** The car on its own: steering, pedals, tyres, weight transfer, integration. */
export function dynamics(c, inp, p = P) {
  const L = p.a + p.b, W = p.m * p.g, dt = DT / p.sub;
  const lock = p.steerMax / (1 + (c.u / p.steerSpeed) ** 2), target = -inp.steer * lock;
  c.delta += clamp(target - c.delta, -p.steerRate * lock * DT, p.steerRate * lock * DT);
  const og = c.offAmt || 0;   // 0 = on the road, 1 = fully on the grass (blended over the edge)
  const mu = p.mu + (p.muOff - p.mu) * og;
  let thr = clamp(inp.throttle, 0, 1), brk = clamp(inp.brake, 0, 1);
  // reverse gear: brake held at a standstill engages it; the gas takes it out
  if (!c.reverse) {
    c.revT = Math.abs(c.u) < 0.5 && brk > 0.5 && thr < 0.05 ? c.revT + DT : 0;
    if (c.revT > p.revHold) { c.reverse = true; c.events.push({ type: "reverse" }); }
  } else if (thr > 0.1 || c.u > 1) { c.reverse = false; c.revT = 0; }
  const rev = c.reverse ? brk : 0;
  if (c.reverse) brk = 0;

  for (let s = 0; s < p.sub; s++) {
    // axle loads, shifted by the (lagged) longitudinal acceleration
    const shift = (p.m * c.ax * p.hcg) / L;
    const Nf = Math.max(0.15 * W, (W * p.b) / L - shift), Nr = Math.max(0.15 * W, (W * p.a) / L + shift);
    // what the driver asks of each axle along the car
    const dir = c.u >= 0 ? 1 : -1;
    const drive = thr * Math.min(p.fMax, p.power / Math.max(c.u, 4)) - rev * p.revForce * clamp((p.revMax + c.u) / 3, 0, 1);
    const brake = brk * p.brakeMax * W;
    const rearShare = (p.brakeRear * Nr) / (Nf + Nr);
    let fxF = -dir * brake * (1 - rearShare);
    let fxR = drive - dir * brake * rearShare;
    // friction circle: longitudinal force first, side grip gets what's left
    const N0f = (W * p.b) / L, N0r = (W * p.a) / L;
    const capF = mu * Nf * Math.max(0.5, 1 - p.loadSens * (Nf / N0f - 1));
    const capR = mu * p.rearGrip * Nr * Math.max(0.5, 1 - p.loadSens * (Nr / N0r - 1));
    const kF = Math.abs(fxF) / capF, kR = Math.abs(fxR) / capR;
    if (kF > 1) fxF /= kF;
    if (kR > 1) fxR /= kR;
    const latF = capF * (kF >= 1 ? p.lockFloor : Math.max(p.lockFloor, Math.sqrt(1 - kF * kF)));
    const latR = capR * (kR >= 1 ? p.lockFloor : Math.max(p.lockFloor, Math.sqrt(1 - kR * kR)));
    // slip angles and side forces; tyres need some rolling speed to make force at all
    const vF = c.v + p.a * c.r, vR = c.v - p.b * c.r, ue = Math.max(Math.abs(c.u), 3);
    const aF = Math.atan2(vF, ue) - c.delta * dir, aR = Math.atan2(vR, ue);
    const sF = Math.min(1, Math.hypot(c.u, vF) / 2), sR = Math.min(1, Math.hypot(c.u, vR) / 2);
    const fyF = -latF * Math.sin(p.C * Math.atan(p.B * aF)) * sF;
    const fyR = -latR * Math.sin(p.CR * Math.atan(p.BR * aR)) * sR;
    // into the body frame
    const cd = Math.cos(c.delta), sd = Math.sin(c.delta);
    const FxF = fxF * cd - fyF * sd, FyF = fxF * sd + fyF * cd;
    const grass = og * p.grassDrag * Math.max(0, c.u - p.grassV);
    const resist = p.drag * c.u * Math.abs(c.u) + p.roll * c.u + grass;
    const Fx = FxF + fxR - resist, Fy = FyF + fyR;
    const Mz = p.a * FyF - p.b * fyR;
    const u0 = c.u;
    c.u += (Fx / p.m + c.v * c.r) * dt;
    c.v += (Fy / p.m - c.u * c.r) * dt;
    c.r += (Mz / p.Iz) * dt;
    if (u0 >= 0 && c.u < 0 && thr < 0.05 && !c.reverse) c.u = 0;   // brakes stop the car, they don't reverse it
    // grass drag doesn't pitch the car (it would lighten the rear and spin you, which isn't fun)
    c.ax += ((Fx + grass) / p.m - c.ax) * (1 - Math.exp(-dt / p.loadLag));
    c.h += c.r * dt;
    const sh = Math.sin(c.h), ch = Math.cos(c.h);
    c.vx = sh * c.u + ch * c.v; c.vz = ch * c.u - sh * c.v;
    c.x += c.vx * dt; c.z += c.vz * dt;
    if (s === p.sub - 1) {
      c.slipF = aF; c.slipR = aR; c.loadF = Nf / (Nf + Nr);
      c.gripF = latF / capF; c.gripR = latR / capR;
    }
  }
  c.h = Math.atan2(Math.sin(c.h), Math.cos(c.h));
  c.slip = -Math.atan2(c.v, Math.max(Math.abs(c.u), 1));
  c.drifting = Math.abs(c.slipR) > 0.14 && Math.abs(c.u) > 6;
}

/** A wall with outward normal (nx, nz) (pointing from the wall's face into the space the car is in,
 *  negated: i.e. the direction the car was moving into it). Kills the speed into it, scrubs some
 *  of the rest, and turns the car along the wall, as arcade racers do: otherwise the tyres keep
 *  steering the nose into the wall and it scrapes along. Returns the impact speed (m/s). */
export function wallHit(c, nx, nz) {
  const into = c.vx * nx + c.vz * nz;
  if (into <= 0) return 0;
  c.vx -= nx * into * 1.25; c.vz -= nz * into * 1.25;
  const keep = 1 - Math.min(0.35, into * 0.03);
  c.vx *= keep; c.vz *= keep;
  // the wall's direction is perpendicular to its normal; turn toward whichever way we were going
  const along = Math.atan2(-nz, nx), back = along + Math.PI;
  const dA = Math.atan2(Math.sin(along - c.h), Math.cos(along - c.h)), dB = Math.atan2(Math.sin(back - c.h), Math.cos(back - c.h));
  const turn = Math.abs(dA) < Math.abs(dB) ? dA : dB;
  c.h += turn * Math.min(0.85, 0.35 + into * 0.04);
  const sh = Math.sin(c.h), ch = Math.cos(c.h);
  c.u = c.vx * sh + c.vz * ch; c.v = (c.vx * ch - c.vz * sh) * 0.4;
  c.vx = sh * c.u + ch * c.v; c.vz = ch * c.u - sh * c.v;
  c.r *= 0.2;
  if (into > 2.5 && c.wallT <= 0) c.events.push({ type: "wall", speed: into });
  if (into > 2.5) c.wallT = 0.5;
  return into;
}

function trackEnv(c, inp, tr) {
  const thr = clamp(inp.throttle, 0, 1);
  // the track: grass and the barrier
  locate(tr, c.x, c.z, c.i, q);
  c.i = q.i; c.d = q.d;
  // kerbs count as road; the grass takes hold over the next metre and a half (tr.open: a test plane)
  c.offAmt = tr.open ? 0 : Math.max(0, Math.min(1, (Math.abs(q.d) - ROAD - KERB + 0.5) / 1.5));
  c.off = c.offAmt > 0.5;
  c.wallT = Math.max(0, c.wallT - DT);
  if (!tr.open && Math.abs(q.d) > WALL - HALF_W) {
    const side = Math.sign(q.d), nx = tr.nx[q.i] * side, nz = tr.nz[q.i] * side;
    const push = Math.abs(q.d) - (WALL - HALF_W);
    c.x -= nx * push; c.z -= nz * push;
    wallHit(c, nx, nz);
  }

  // stuck against a wall or facing backwards with the throttle on: put it back on the road
  const facing = Math.cos(c.h - tr.heading[c.i]);
  c.stuckT = !tr.open && (c.u < 2 || facing < -0.2) && thr > 0.3 ? c.stuckT + DT : 0;
  if (c.stuckT > 2) resetCar2(c, tr);
}

export function resetCar2(c, tr) {
  const i = c.i;
  c.x = tr.x[i]; c.z = tr.z[i]; c.h = tr.heading[i];
  c.u = 10; c.v = 0; c.r = 0; c.delta = 0; c.ax = 0;
  c.vx = Math.sin(c.h) * 10; c.vz = Math.cos(c.h) * 10;
  c.stuckT = 0; c.d = 0; c.off = false;
  c.events.push({ type: "reset" });
}
