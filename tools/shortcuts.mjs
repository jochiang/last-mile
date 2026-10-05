// The shortcuts a local knows and the GPS doesn't (bot only): the alleys, the parking lots' aisles and
// side strips, and the paths across the parks (round the fountain). Each is a polyline between two
// points on streets, usable both ways, with a speed cap (dumpsters, parked cars, grass).
import { CURB, LINE, X } from "../src/city/map.js";
import { route } from "../src/city/gps.js";

// a point on the nearest street, as a GPS destination
function place(city, x, z) {
  let best = null;
  for (const e of city.edges) {
    const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len;
    const t = Math.max(0, Math.min(e.len, (x - e.ax) * dx + (z - e.az) * dz));
    const d = Math.hypot(e.ax + dx * t - x, e.az + dz * t - z);
    if (!best || d < best.d) best = { d, x: e.ax + dx * t, z: e.az + dz * t, edge: e, t };
  }
  return best;
}

export function buildShortcuts(city) {
  const out = [];
  const add = (kind, cap, pts) => {
    for (const p of [pts, pts.slice().reverse()]) {
      const A = place(city, ...p[0]), B = place(city, ...p[p.length - 1]);
      let len = 0;
      for (let i = 0; i < p.length - 1; i++) len += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
      const [ax, az] = p[p.length - 2], [bx, bz] = p[p.length - 1];
      out.push({ kind, cap, pts: p, A, B, len, hB: Math.atan2(bx - ax, bz - az) });
    }
  };
  // alleys: straight through the block, street to street
  for (const a of city.alleys) {
    if (a.ns) { const x = (a.x0 + a.x1) / 2; add("alley", 12, [[x, a.z0 - CURB], [x, a.z1 + CURB]]); }
    else { const z = (a.z0 + a.z1) / 2; add("alley", 12, [[a.x0 - CURB, z], [a.x1 + CURB, z]]); }
  }
  // lots: the two aisles east-west between the rows (the strips at the ends are too tight between
  // the lampposts and the parked cars)
  for (const l of city.lots) {
    const iz0 = l.z0 - CURB + LINE;
    for (const dz of [11.6, 26.6]) add("lot", 10, [[l.x0 - CURB, iz0 + dz], [l.x1 + CURB, iz0 + dz]]);
  }
  // parks: the diagonal paths of each park block; where one ends at the fountain (a dead node),
  // carry on to the opposite corner, swinging round the fountain
  const dead = city.deadNodes;
  const seen = new Set();
  for (const p of city.parks) {
    const x0 = X(p.c), x1 = X(p.c + 1), z0 = X(p.r), z1 = X(p.r + 1);
    for (const [[ax, az], [bx, bz]] of [[[x0, z0], [x1, z1]], [[x1, z0], [x0, z1]]]) {
      const f = dead.find((n) => (n.x === ax && n.z === az) || (n.x === bx && n.z === bz));
      if (!f) { add("park", 17, [[ax, az], [bx, bz]]); continue; }
      // through the fountain: from the far corner of this block to the far corner of the opposite one
      const [sx, sz] = f.x === ax && f.z === az ? [bx, bz] : [ax, az];
      const ex = 2 * f.x - sx, ez = 2 * f.z - sz, key = [`${sx},${sz}`, `${ex},${ez}`].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const ux = (ex - sx) / Math.hypot(ex - sx, ez - sz), uz = (ez - sz) / Math.hypot(ex - sx, ez - sz);
      // (inside the treeless ring, 11 m round the fountain)
      const P = (a, w) => [f.x + ux * a - uz * w, f.z + uz * a + ux * w];   // a along the diagonal, w to its left
      add("park", 15, [[sx, sz], P(-12, 0), P(-6, 7), P(0, 8), P(6, 7), P(12, 0), [ex, ez]]);
    }
  }
  return out;
}

/** The best way to target: plain GPS, or via one shortcut. A polyline [[x, z]...] with a speed cap per
 *  segment (Infinity on streets), its length, and which shortcut (or null). */
export function planRoute(city, shortcuts, car, target, speed, vStreet = 15) {
  const direct = route(city, car.x, car.z, car.h, target, speed);
  const time = (len, cap = Infinity) => len / Math.min(cap, vStreet);
  // every corner costs time too (braking for it, getting back up to speed)
  const corners = (pts) => {
    let n = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const a1 = Math.atan2(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]), a2 = Math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1))) > 0.6) n++;
    }
    return n * 1.8;
  };
  let best = { pts: direct.points, caps: direct.points.map(() => Infinity), t: time(direct.length) + corners(direct.points), sc: null };
  for (const sc of shortcuts) {
    // cheap filter: the shortcut's ends can't both be further away than the target
    if (Math.hypot(sc.A.x - car.x, sc.A.z - car.z) > direct.length || Math.hypot(sc.B.x - target.x, sc.B.z - target.z) > direct.length) continue;
    const r1 = route(city, car.x, car.z, car.h, sc.A, speed);
    const r2 = route(city, sc.B.x, sc.B.z, sc.hB, target, 8);
    const t = time(r1.length) + time(sc.len, sc.cap) + time(r2.length) + corners(r1.points) + corners(r2.points) + 2 * 1.8;   // + the turns in and out
    if (t < best.t - 1) {
      const pts = [...r1.points, ...sc.pts.slice(1, -1), ...r2.points];
      const caps = [...r1.points.map(() => Infinity), ...sc.pts.slice(1, -1).map(() => sc.cap), ...r2.points.map(() => Infinity)];
      caps[r1.points.length - 1] = sc.cap;   // the segment from the street into the shortcut
      best = { pts, caps, t, sc };
    }
  }
  return best;
}
