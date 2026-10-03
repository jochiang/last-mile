// Arcade car physics, fixed 60 Hz, no rendering. The model:
// - auto-throttle toward a top speed; brake is a held button
// - steering sets a yaw rate, scaled by speed so the car turns tight when slow and calm when fast
// - grip swings the velocity toward the heading; low grip (drifting, grass) leaves it sliding
// - drifting charges a mini-turbo; letting go at a charge tier fires a boost
// Input: { steer: -1..1 (+ = right), drift: bool, brake: bool }

import { locate, ROAD, WALL } from "./track.js";

export const DT = 1 / 60;
export const TUNE = {
  vmax: 42, acc: 15, brake: 30,
  offMax: 17, offDrag: 2.2,                // grass: top speed and how hard it pulls you down to it
  rMin: 6, rK: 0.85,                       // turn radius = rMin + speed * rK
  yawK: 12,                                // how fast the yaw rate follows the steering
  grip: 9, gripDrift: 2.0, gripOff: 4,     // velocity-to-heading pull, per second
  scrub: 0.55, scrubDrift: 0.18,           // speed lost to sliding (a drift is a controlled slide: cheaper)
  driftMin: 11, driftBase: 1.3, driftSteer: 0.5,
  tiers: [0.75, 1.6, 2.6], boostT: [0.55, 1.0, 1.5], boostV: 11, boostAcc: 26,
};
const HALF_W = 1.0;   // car half width, for the barrier

export function makeCar(tr, i = 6) {
  return {
    x: tr.x[i], z: tr.z[i], h: tr.heading[i], vx: 0, vz: 0, w: 0,
    drifting: false, dDir: 0, charge: 0, boost: 0, tier: 0,
    off: false, wallT: 0, stuckT: 0, i, d: 0,
    events: [],
  };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const q = { i: 0, d: 0 };

export function stepCar(c, inp, tr, T = TUNE) {
  c.events.length = 0;
  const fx = Math.sin(c.h), fz = Math.cos(c.h);
  let fwd = c.vx * fx + c.vz * fz;

  // throttle / brake / grass
  let vmax = T.vmax + (c.boost > 0 ? T.boostV : 0);
  let a = inp.brake ? -T.brake * (fwd > 0 ? 1 : 0) : T.acc * (1 - fwd / vmax);
  if (c.boost > 0 && !inp.brake) a += T.boostAcc * (1 - fwd / vmax);
  if (c.off && fwd > T.offMax) a = Math.min(a, -(fwd - T.offMax) * T.offDrag);
  c.vx += fx * a * DT; c.vz += fz * a * DT;
  c.boost = Math.max(0, c.boost - DT);

  // drifting: hold drift while steering; the direction locks in at the start
  fwd = c.vx * fx + c.vz * fz;
  if (c.drifting && (!inp.drift || fwd < T.driftMin * 0.7 || c.wallT > 0.45)) {
    c.drifting = false;
    const tier = T.tiers.filter((t) => c.charge >= t).length;
    if (tier && inp.drift === false) { c.boost = Math.max(c.boost, T.boostT[tier - 1]); c.events.push({ type: "boost", tier }); }
    c.charge = 0; c.tier = 0;
  } else if (!c.drifting && inp.drift && Math.abs(inp.steer) > 0.25 && fwd > T.driftMin) {
    c.drifting = true; c.dDir = Math.sign(inp.steer); c.charge = 0; c.tier = 0;
    c.events.push({ type: "hop" });
  }
  if (c.drifting) {
    c.charge += DT * (0.8 + 0.5 * Math.max(0, inp.steer * c.dDir));   // tight drifts charge faster
    const tier = T.tiers.filter((t) => c.charge >= t).length;
    if (tier > c.tier) { c.tier = tier; c.events.push({ type: "tier", tier }); }
  }

  // yaw: + steer is right, which is a falling heading
  const fs = Math.max(0, fwd);
  const wmax = fs / (T.rMin + fs * T.rK);
  const target = c.drifting
    ? -c.dDir * wmax * (T.driftBase + T.driftSteer * inp.steer * c.dDir)
    : -inp.steer * wmax;
  c.w += (target - c.w) * (1 - Math.exp(-T.yawK * DT));
  c.h = wrap(c.h + c.w * DT);

  // grip: swing the velocity toward the heading, losing some speed to the slide
  let s = Math.hypot(c.vx, c.vz);
  if (s > 0.01) {
    const va = Math.atan2(c.vx, c.vz), diff = wrap(c.h - va);
    const k = c.drifting ? T.gripDrift : c.off ? T.gripOff : T.grip;
    const nva = va + diff * (1 - Math.exp(-k * DT));
    s *= 1 - Math.min(0.5, Math.abs(Math.sin(diff)) * (c.drifting ? T.scrubDrift : T.scrub) * DT);
    c.slip = diff;
    c.vx = Math.sin(nva) * s; c.vz = Math.cos(nva) * s;
  } else c.slip = 0;

  c.x += c.vx * DT; c.z += c.vz * DT;

  // where are we on the track; grass and the barrier
  locate(tr, c.x, c.z, c.i, q);
  c.i = q.i; c.d = q.d;
  c.off = Math.abs(q.d) > ROAD + 0.6;
  c.wallT = Math.max(0, c.wallT - DT);
  if (Math.abs(q.d) > WALL - HALF_W) {
    const side = Math.sign(q.d), nx = tr.nx[q.i] * side, nz = tr.nz[q.i] * side;
    const push = Math.abs(q.d) - (WALL - HALF_W);
    c.x -= nx * push; c.z -= nz * push;
    const into = c.vx * nx + c.vz * nz;
    if (into > 0) {
      // kill the speed into the wall (a little bounce) and scrub some of the rest
      c.vx -= nx * into * 1.25; c.vz -= nz * into * 1.25;
      const keep = 1 - Math.min(0.35, into * 0.03);
      c.vx *= keep; c.vz *= keep;
      if (into > 2.5 && c.wallT <= 0) c.events.push({ type: "wall", speed: into });
      if (into > 2.5) c.wallT = 0.5;
    }
  }

  // stuck (crashed facing a wall, spun out): put it back on the road
  c.stuckT = Math.hypot(c.vx, c.vz) < 3 ? c.stuckT + DT : 0;
  if (c.stuckT > 1.5) resetCar(c, tr);
}

export function resetCar(c, tr) {
  const i = c.i;
  c.x = tr.x[i]; c.z = tr.z[i]; c.h = tr.heading[i];
  c.vx = Math.sin(c.h) * 10; c.vz = Math.cos(c.h) * 10; c.w = 0;
  c.drifting = false; c.charge = 0; c.tier = 0; c.stuckT = 0; c.d = 0; c.off = false;
  c.events.push({ type: "reset" });
}

/** Lap timing: checkpoints at a third and two thirds, lap counts when the start line is crossed after both. */
export function makeTimer() {
  return { tick: 0, lapStart: 0, cp: 0, last: null, laps: [], prevI: -1, offT: 0, walls: 0, steerJerk: 0 };
}

export function stepTimer(t, c, tr, prevSteer, steer) {
  t.tick++;
  if (c.off) t.offT++;
  t.steerJerk += Math.abs(steer - prevSteer);
  if (c.events.some((e) => e.type === "wall")) t.walls++;
  const i = c.i, N = tr.N;
  if (t.cp === 0 && i > N / 3 && i < N / 2) t.cp = 1;
  if (t.cp === 1 && i > (2 * N) / 3 && i < (5 * N) / 6) t.cp = 2;
  let lap = null;
  if (t.prevI > N - 40 && i < 40) {
    if (t.cp === 2) {
      const ticks = t.tick - t.lapStart;
      lap = { ticks, time: ticks / 60, off: t.offT / ticks, walls: t.walls, jerk: t.steerJerk / (ticks / 60) };
      t.laps.push(lap);
      t.last = lap;
    }
    t.lapStart = t.tick; t.cp = 0; t.offT = 0; t.walls = 0; t.steerJerk = 0;
  }
  t.prevI = i;
  return lap;
}
