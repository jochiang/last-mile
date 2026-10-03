// The car in the city: buildings, parked cars, trees and the fountain are solid; lampposts break;
// the park is grass. The car is two circles (front and rear axle) against boxes and circles.

import { dynamics, wallHit, P } from "../car2.js";
import { DT } from "../car.js";
import { nearestEdge } from "./gps.js";

const CR = 1.05, AX = 1.3;   // the car's circles: radius, and distance from the middle to each

export function makeCityCar(city) {
  const s = city.start;
  return {
    model: "pedals", x: s.x, z: s.z, h: s.h, u: 0, v: 0, r: 0, vx: 0, vz: 0,
    delta: 0, ax: 0, loadF: 0.5, slipF: 0, slipR: 0, slip: 0, gripF: 1, gripR: 1,
    off: false, offAmt: 0, wallT: 0, stuckT: 0, events: [], reverse: false, revT: 0,
    drifting: false, charge: 0, tier: 0, boost: 0,
    cond: 1,              // condition 0..1: knocks cost power
    gLat: 0, gLong: 0,    // smoothed accelerations in g, for spilling drinks
  };
}

export function stepCityCar(c, inp, city, p = P) {
  c.events.length = 0;
  const pvx = c.vx, pvz = c.vz;
  // a battered car loses power
  const power = p.power, fMax = p.fMax;
  p.power = power * (0.55 + 0.45 * c.cond); p.fMax = fMax * (0.55 + 0.45 * c.cond);
  dynamics(c, inp, p);
  p.power = power; p.fMax = fMax;

  c.offAmt += ((city.surfaceAt(c.x, c.z) ? 1 : 0) - c.offAmt) * 0.25;
  c.off = c.offAmt > 0.5;
  c.wallT = Math.max(0, c.wallT - DT);

  // collisions: push each circle out of whatever it overlaps
  const fx = Math.sin(c.h), fz = Math.cos(c.h);
  for (const k of [1, -1]) {
    for (let pass = 0; pass < 2; pass++) {
      const cx = c.x + fx * AX * k, cz = c.z + fz * AX * k;
      let hit = null, best = 0;
      city.near(cx, cz, CR + 0.5, (o) => {
        if (o.broken) return;
        let nx, nz, pen;
        if (o.r !== undefined) {
          const dx = cx - o.x, dz = cz - o.z, d = Math.hypot(dx, dz);
          if (d >= CR + o.r) return;
          pen = CR + o.r - d; nx = d > 1e-6 ? dx / d : 1; nz = d > 1e-6 ? dz / d : 0;
        } else {
          const px = Math.max(o.x0, Math.min(o.x1, cx)), pz = Math.max(o.z0, Math.min(o.z1, cz));
          const dx = cx - px, dz = cz - pz, d = Math.hypot(dx, dz);
          if (d >= CR) return;
          if (d > 1e-6) { pen = CR - d; nx = dx / d; nz = dz / d; }
          else {
            // centre inside the box: out the nearest side
            const sides = [[cx - o.x0, -1, 0], [o.x1 - cx, 1, 0], [cz - o.z0, 0, -1], [o.z1 - cz, 0, 1]].sort((a, b) => a[0] - b[0]);
            pen = sides[0][0] + CR; nx = sides[0][1]; nz = sides[0][2];
          }
        }
        if (o.kind === "pole") {
          // lampposts snap off: a jolt, a little damage
          o.broken = true; o.fallX = -nx; o.fallZ = -nz;
          c.vx *= 0.86; c.vz *= 0.86;
          const sh = Math.sin(c.h), ch = Math.cos(c.h);
          c.u = c.vx * sh + c.vz * ch; c.v = c.vx * ch - c.vz * sh;
          c.cond = Math.max(0, c.cond - 0.02);
          c.events.push({ type: "pole", pole: o, speed: Math.hypot(c.vx, c.vz) });
          return;
        }
        if (pen > best) { best = pen; hit = [nx, nz]; }
      });
      if (!hit) break;
      c.x += hit[0] * best; c.z += hit[1] * best;
      const into = wallHit(c, -hit[0], -hit[1]);
      if (into > 2.5) c.cond = Math.max(0, c.cond - Math.min(0.25, (into - 2) * 0.012));
    }
  }

  // felt acceleration (for drinks): this tick's change in velocity, in the car's frame
  const ax = (c.vx - pvx) / DT, az = (c.vz - pvz) / DT, sh = Math.sin(c.h), ch = Math.cos(c.h);
  c.gLong += ((ax * sh + az * ch) / 9.81 - c.gLong) * 0.2;
  c.gLat += ((ax * ch - az * sh) / 9.81 - c.gLat) * 0.2;

  // wedged somewhere with the gas on and reverse not helping: back onto the nearest street
  c.stuckT = Math.abs(c.u) < 1.5 && inp.throttle > 0.3 ? c.stuckT + DT : 0;
  if (c.stuckT > 3) resetCityCar(c, city);
}

export function resetCityCar(c, city) {
  const s = nearestEdge(city, c.x, c.z), e = s.e;
  c.x = s.px; c.z = s.pz;
  const h = Math.atan2(e.bx - e.ax, e.bz - e.az);
  c.h = Math.cos(h - c.h) >= 0 ? h : h + Math.PI;
  c.u = 0; c.v = 0; c.r = 0; c.vx = c.vz = 0; c.delta = 0; c.ax = 0; c.stuckT = 0; c.reverse = false;
  c.events.push({ type: "reset" });
}
