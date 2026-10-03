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

const UTURN = 45;   // metres of penalty for a route that starts by turning around

/** Route from a car at (x, z) heading h to a place {edge, t, x, z}. Returns { points: [[x, z]...], length }. */
export function route(city, x, z, h, dest) {
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
