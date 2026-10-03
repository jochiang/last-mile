// Checks for the pedals model: straight-line numbers, then the techniques it's meant to reward,
// measured on a flat open plane (a giant fake track so walls never interfere).
// usage: node tools/physics.mjs
import { makeCar2, stepCar2, P } from "../src/car2.js";
import { buildTrack } from "../src/track.js";

// a straight "track" 4 km long and far wider than anything we do, so locate() just works
const N = 4000, tr = { open: true, N, x: new Float64Array(N), z: new Float64Array(N), nx: new Float64Array(N), nz: new Float64Array(N), heading: new Float64Array(N), curv: new Float64Array(N), tx: new Float64Array(N), tz: new Float64Array(N) };
for (let i = 0; i < N; i++) { tr.x[i] = i - 200; tr.z[i] = 0; tr.tx[i] = 1; tr.nz[i] = 1; tr.heading[i] = Math.PI / 2; }
const fresh = () => { const c = makeCar2(tr, 200); c.i = 200; return c; };
const run = (c, inp, ticks, each) => { for (let t = 0; t < ticks; t++) { const i = typeof inp === "function" ? inp(t, c) : inp; stepCar2(c, i, tr); c.off = false; each?.(t, c); } };
// keep the car in the middle of the fake track so the barrier never matters
const center = (c) => { if (Math.abs(c.d) > 5) { c.z = 0; } };
const spd = (c) => Math.hypot(c.vx, c.vz);
let ok = true;
const check = (name, cond, info) => { console.log(`${cond ? "ok  " : "FAIL"} ${name}: ${info}`); ok &&= cond; };

{ // acceleration and top speed
  const c = fresh(); let t100 = 0;
  run(c, { steer: 0, throttle: 1, brake: 0 }, 60 * 30, (t, c) => { if (!t100 && spd(c) > 27.8) t100 = t / 60; center(c); });
  check("0-100 km/h", t100 > 2.5 && t100 < 6, `${t100.toFixed(2)} s; top speed after 30 s ${(spd(c) * 3.6).toFixed(0)} km/h`);
}
{ // braking from 40 m/s
  const c = fresh(); c.u = 40;
  let d = 0; const x0 = c.x;
  run(c, { steer: 0, throttle: 0, brake: 1 }, 60 * 6, (t, c) => { if (spd(c) > 0.1) d = c.x - x0; center(c); });
  check("stop from 144 km/h", d > 45 && d < 90 && spd(c) < 0.1, `${d.toFixed(1)} m (${(40 * 40 / (2 * d) / 9.81).toFixed(2)} g)`);
}
// steady cornering, then a change of pedal: does the yaw rate respond the way a driver expects?
function corner(changeTo, label, u0 = 18, steer = 0.45, throttle = 0.32) {
  const c = fresh(); c.u = u0;
  const hold = { steer, throttle, brake: 0 };
  run(c, hold, 120);   // settle into a steady turn
  const r0 = Math.abs(c.r), s0 = spd(c);
  let rMax = r0, rearMax = 0;
  run(c, { ...hold, ...changeTo }, 30, (t, c) => { rMax = Math.max(rMax, Math.abs(c.r)); rearMax = Math.max(rearMax, Math.abs(c.slipR)); });
  return { r0, r: rMax, ratio: rMax / r0, s0, s: spd(c), rearMax, label };
}
const show = (x) => `yaw ${x.r0.toFixed(2)} -> ${x.r.toFixed(2)} rad/s (x${x.ratio.toFixed(2)}), speed ${x.s0.toFixed(1)} -> ${x.s.toFixed(1)}, rear slip ${(x.rearMax * 57.3).toFixed(0)} deg`;
const lift = corner({ throttle: 0 }, "lift");
check("lifting mid-corner tightens the line", lift.ratio > 1.05, show(lift));
const lfb = corner({ throttle: 0.32, brake: 0.15 }, "left-foot brake");
check("left-foot braking rotates the car a little, keeping speed", lfb.ratio > 1.03, show(lfb));
const power = corner({ throttle: 1 }, "power", 11, 0.6, 0.25);
check("flooring it in a slow corner rotates the car", power.ratio > 1.15 && power.rearMax > 0.07, show(power));
const steady = corner({}, "steady");
check("holding steady stays steady", Math.abs(steady.ratio - 1) < 0.05 && steady.rearMax < 0.1, show(steady));
{ // full lock at speed: should push wide (understeer), not spin
  const c = fresh(); c.u = 40; let spun = false;
  run(c, { steer: 1, throttle: 0.5, brake: 0 }, 90, (t, c) => { if (Math.abs(c.slipR) > 0.35) spun = true; });
  check("full lock at 144 km/h understeers, no spin", !spun && Math.abs(c.slipR) < Math.abs(c.slipF) && Math.abs(c.slipR) < 0.2, `rear slip ${(c.slipR * 57.3).toFixed(0)} deg, front ${(c.slipF * 57.3).toFixed(0)} deg`);
}
{ // stability: straight line, full throttle, no wobble
  const c = fresh(); let rMax = 0;
  run(c, { steer: 0, throttle: 1, brake: 0 }, 600, (t, c) => { rMax = Math.max(rMax, Math.abs(c.r)); center(c); });
  check("straight line is stable", rMax < 1e-6, `max yaw rate ${rMax.toExponential(1)}`);
}
{ // glancing a wall on the real track at 25 degrees: how long until the car is pointing down the road again?
  // the "driver" steers toward the road's direction, like a player correcting
  const real = buildTrack(), i0 = 120;
  for (const deg of [15, 30, 45]) {
    const c = makeCar2(real, i0); c.h = real.heading[i0] - (deg * Math.PI) / 180; c.u = 30;
    let hitT = -1, okT = -1;
    for (let t = 0; t < 60 * 6 && okT < 0; t++) {
      const err = Math.atan2(Math.sin(c.h - real.heading[c.i]), Math.cos(c.h - real.heading[c.i]));   // + = pointing left of the road
      const steer = hitT < 0 ? 0 : Math.max(-1, Math.min(1, err * 3 - c.d * 0.03));
      stepCar2(c, { steer, throttle: 0.7, brake: 0 }, real);
      if (hitT < 0 && c.events.some((e) => e.type === "wall")) hitT = t;
      if (hitT >= 0 && t > hitT + 6 && Math.abs(err) < 0.08 && Math.abs(c.slip) < 0.06) okT = t;
    }
    check(`recover from a ${deg} degree wall hit`, hitT >= 0 && okT >= 0 && okT - hitT < 60 * 1.2,
      hitT < 0 ? "never hit the wall" : okT < 0 ? "not straight after 6 s" : `${((okT - hitT) / 60).toFixed(2)} s after the hit`);
  }
}
console.log(ok ? "all physics checks pass" : "SOME PHYSICS CHECKS FAILED");
