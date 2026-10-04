// The three cars side by side: acceleration, top speed, braking, cornering, U-turns, and the
// behaviour checks that matter (no spin at full lock at speed; what full gas does mid-corner).
// usage: node tools/carcompare.mjs
import { makeCar2, stepCar2, P } from "../src/car2.js";
import { CARS, CAR_ORDER } from "../src/city/cars.js";

const N = 4000, tr = { open: true, N, x: new Float64Array(N), z: new Float64Array(N), nx: new Float64Array(N), nz: new Float64Array(N), heading: new Float64Array(N), curv: new Float64Array(N) };
for (let i = 0; i < N; i++) { tr.x[i] = i - 200; tr.nz[i] = 1; tr.heading[i] = Math.PI / 2; }
const fresh = () => { const c = makeCar2(tr, 200); c.i = 200; return c; };
const run = (p, c, inp, ticks, each) => { for (let t = 0; t < ticks; t++) { stepCar2(c, typeof inp === "function" ? inp(t, c) : inp, tr, p); each?.(t, c); } };
const spd = (c) => Math.hypot(c.vx, c.vz);

for (const id of CAR_ORDER) {
  const p = { ...P, ...CARS[id].p };
  const out = [];
  { const c = fresh(); let t100 = 0; run(p, c, { steer: 0, throttle: 1, brake: 0 }, 60 * 30, (t, c) => { if (!t100 && spd(c) > 27.8) t100 = t / 60; c.z = 0; }); out.push(`0-100 ${t100 ? t100.toFixed(1) + "s" : "never"}, top ${(spd(c) * 3.6).toFixed(0)} km/h`); }
  { const c = fresh(); c.u = 25; let d = 0; const x0 = c.x; run(p, c, { steer: 0, throttle: 0, brake: 1 }, 60 * 4, (t, c) => { d = Math.max(d, c.x - x0); }); out.push(`90-0 ${d.toFixed(0)} m`); }
  { // steady cornering grip: full lock at 15 m/s, gas to hold speed
    const c = fresh(); c.u = 15; let g = 0;
    run(p, c, (t, c) => ({ steer: 1, throttle: c.u < 15 ? 0.6 : 0.2, brake: 0 }), 240, (t, c) => { if (t > 120) g = Math.max(g, Math.abs(c.u * c.r) / 9.81); });
    out.push(`corner ${g.toFixed(2)} g`);
  }
  { // U-turn width: brake a moment, then 40% gas at full lock, from 25 km/h
    const c = fresh(); c.u = 7; const z0 = c.z; let turned = 0, w = 0;
    run(p, c, (t) => ({ steer: 1, throttle: t < 20 ? 0 : 0.4, brake: t < 20 ? 0.6 : 0 }), 300, (t, c) => { if (turned < Math.PI) { turned += Math.abs(c.r) / 60; w = Math.max(w, Math.abs(c.z - z0)); } });
    out.push(`U-turn ${turned >= Math.PI ? (w + 2).toFixed(1) + " m" : "didn't"}`);
  }
  { // full lock at 110 km/h: understeer, not a spin
    const c = fresh(); c.u = 30; let spun = false;
    run(p, c, { steer: 1, throttle: 0.5, brake: 0 }, 90, (t, c) => { if (Math.abs(c.slipR) > 0.35) spun = true; });
    out.push(spun ? "SPINS at full lock" : "full lock at speed: safe");
  }
  { // flooring it in a slow corner: rear-drives rotate, front-drive pushes wide
    const c = fresh(); c.u = 11; const hold = { steer: 0.6, throttle: 0.25, brake: 0 };
    run(p, c, hold, 120); const r0 = Math.abs(c.r);
    let r1 = 0; run(p, c, { ...hold, throttle: 1 }, 30, (t, c) => { r1 = Math.max(r1, Math.abs(c.r)); });
    out.push(`full gas mid-corner: yaw x${(r1 / r0).toFixed(2)}`);
  }
  console.log(`${CARS[id].name.padEnd(9)} ${out.join(" | ")}`);
}
