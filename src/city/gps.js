// The GPS: shortest route by street from the car to a place on a street edge. It knows nothing
// about alleys, the lot or the park; beating it with those is the skill.

import { projT } from "./map.js";

/** The street edge nearest (x, z), and where along it. */
export function nearestEdge(city, x, z) {
  let best = null, bd = Infinity;
  for (const e of city.edges) {
    const t = projT(e, x, z), px = e.ax + ((e.bx - e.ax) * t) / e.len, pz = e.az + ((e.bz - e.az) * t) / e.len;
    const d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; best = { e, t, d, px, pz }; }
  }
  return best;
}

// metres of penalty for a route that starts by turning around: it grows with speed, so the GPS keeps
// you moving forward round the block unless turning back is much shorter (user, 2026-10-03)
const uturnCost = (speed) => 90 + speed * 6;

/** Route from a car at (x, z) heading h, moving at speed (m/s), to a place {edge, t, x, z}.
 *  Returns { points: [[x, z]...], length }. */
export function route(city, x, z, h, dest, speed = 0) {
  const UTURN = uturnCost(speed);
  const s = nearestEdge(city, x, z), e = s.e;
  // which way along the edge is the car facing? (+1 = toward b)
  const fx = Math.sin(h), fz = Math.cos(h), along = (e.bx - e.ax) * fx + (e.bz - e.az) * fz >= 0 ? 1 : -1;
  const de = dest.edge;
  // same street, target ahead: straight there
  if (de === e && (dest.t - s.t) * along >= 0) {
    return { points: [[x, z], [dest.x, dest.z]], length: Math.abs(dest.t - s.t) + s.d };
  }
  // Dijkstra from the two ends of the car's edge (one of them behind us: U-turn penalty)
  const N = city.nodes.length, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  dist[e.b] = (e.len - s.t) + (along < 0 ? UTURN : 0);
  dist[e.a] = s.t + (along > 0 ? UTURN : 0);
  for (;;) {
    let u = -1, ud = Infinity;
    for (let i = 0; i < N; i++) if (!done[i] && dist[i] < ud) { ud = dist[i]; u = i; }
    if (u < 0) break;
    done[u] = 1;
    for (const { n, e: ed } of city.nodes[u].adj) {
      const nd = ud + ed.len;
      if (nd < dist[n]) { dist[n] = nd; prev[n] = u; }
    }
  }
  // finish into the target edge from whichever end is cheaper
  const viaA = dist[de.a] + dest.t, viaB = dist[de.b] + (de.len - dest.t);
  let end = viaA <= viaB ? de.a : de.b;
  const path = [];
  for (let n = end; n >= 0; n = prev[n]) path.push(n);
  path.reverse();
  const points = [[x, z], [s.px, s.pz]];
  for (const n of path) points.push([city.nodes[n].x, city.nodes[n].z]);
  points.push([dest.x, dest.z]);
  return { points, length: Math.min(viaA, viaB) + s.d };
}

/** Plain street distance between two places (for order timers and pay). */
export function placeDistance(city, a, b) {
  const h = Math.atan2(b.x - a.x, b.z - a.z);   // assume you set off roughly toward it
  return route(city, a.x, a.z, h, b).length;
}

/** The next manoeuvre on a route, for the turn prompt: { dir: "left"|"right"|"arrive", dist, onto }. */
export function nextTurn(city, rt) {
  // points[0] is the car and points[1] its projection onto the street: that sideways hop isn't a turn
  const pts = rt.points;
  let d = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  for (let i = 2; i < pts.length - 1; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], [cx, cz] = pts[i + 1];
    d += Math.hypot(bx - ax, bz - az);
    const a1 = Math.atan2(bx - ax, bz - az), a2 = Math.atan2(cx - bx, cz - bz);
    if (Math.hypot(cx - bx, cz - bz) < 0.5 || Math.hypot(bx - ax, bz - az) < 0.5) continue;
    const turn = Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1));   // + = heading rises = left
    if (Math.abs(turn) > 0.5) {
      const onto = city.edges.find((e) => {
        const mx = (bx + cx) / 2, mz = (bz + cz) / 2;
        return Math.min(e.ax, e.bx) - 1 <= mx && mx <= Math.max(e.ax, e.bx) + 1 && Math.min(e.az, e.bz) - 1 <= mz && mz <= Math.max(e.az, e.bz) + 1;
      });
      return { dir: Math.abs(turn) > 2.6 ? "uturn" : turn > 0 ? "left" : "right", dist: d, onto: onto ? onto.name : "" };
    }
  }
  const [ax, az] = pts[pts.length - 2], [bx, bz] = pts[pts.length - 1];
  return { dir: "arrive", dist: d + Math.hypot(bx - ax, bz - az), onto: "" };
}

/** Target speed for a turn of this many radians (a 90 degree street corner ~ 40 km/h). */
const cornerSpeed = (ang) => 4 + 7 * Math.pow(Math.max(0, Math.PI - ang) / (Math.PI / 2), 1.3);
export const STOP_SPEED = 2.5, PLAN_DECEL = 9;   // the stop at the end; the braking rate the plan assumes (m/s^2)

/** Speed limits along a route: [{ s, v }] at each turn and at the stop, s = metres from points[0]. */
export function speedPlan(rt) {
  const pts = rt.points, out = [];
  let s = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
  for (let i = 2; i < pts.length - 1; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], [cx, cz] = pts[i + 1];
    const l1 = Math.hypot(bx - ax, bz - az), l2 = Math.hypot(cx - bx, cz - bz);
    s += l1;
    if (l1 < 0.5 || l2 < 0.5) continue;
    const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(cx - bx, cz - bz) - Math.atan2(bx - ax, bz - az)), Math.cos(Math.atan2(cx - bx, cz - bz) - Math.atan2(bx - ax, bz - az))));
    if (turn > 0.35) out.push({ s, v: cornerSpeed(turn) });
  }
  const [ax, az] = pts[pts.length - 2], [bx, bz] = pts[pts.length - 1];
  out.push({ s: s + Math.hypot(bx - ax, bz - az), v: STOP_SPEED });
  return out;
}

/** The highest speed you can be doing at distance s along the route and still make every limit ahead. */
export function allowedSpeed(plan, s) {
  let v = Infinity;
  for (const c of plan) if (c.s >= s) v = Math.min(v, Math.sqrt(c.v * c.v + 2 * PLAN_DECEL * (c.s - s)));
  return v;
}

/** How far along the route's polyline the point (x, z) is. */
export function alongRoute(rt, x, z) {
  const pts = rt.points;
  let best = Infinity, at = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az) || 1e-6;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (L * L)));
    const d = Math.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t));
    if (d < best) { best = d; at = acc + L * t; }
    acc += L;
  }
  return at;
}
