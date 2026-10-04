// What each day brings. New order types arrive as the days go on, and from day 3 each day rolls
// a few conditions from a growing pool. The plan is deterministic from the run's seed and the
// day, so the garage can forecast tomorrow exactly. Underneath, the clock tightens and customers
// live further away.

import { LINE, CURB } from "./map.js";

export const CONDITIONS = {
  // one new thing a day from day 2 to 6, each guaranteed on the day it first appears
  surge: { name: "Surge zone", minDay: 2, weight: 0.5, good: true, desc: "One part of town pays 1.5× today (pink on the map)." },
  rain: { name: "Rain", minDay: 3, weight: 1, desc: "−18% grip. People tip more in the rain: +15% tips." },
  roadworks: { name: "Road works", minDay: 4, weight: 1, desc: "A few streets are barricaded. The GPS goes round; you might know better." },
  cameras: { name: "Speed cameras", minDay: 5, weight: 1, desc: "A $6 fine for passing one over 60 km/h." },
  rush: { name: "Rush hour", minDay: 6, weight: 1, desc: "Clocks 15% tighter, tips +25%, and 40% more traffic." },
};

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The day's plan: { conds, kinds, pace, maxDist, closed: [edge], surge: rect|null, cameras: [{x, z, edge}] } */
export function dayPlan(city, seed, day) {
  const R = rng(seed * 7919 + day * 104729);
  const kinds = ["food"];
  if (day >= 2) kinds.push("drink");
  if (day >= 4) kinds.push("cake");
  // conditions: whatever's new today, then more from the unlocked pool (1 a day from day 2, 2 from
  // day 5, 3 from day 8), picked by weight
  const pool = Object.keys(CONDITIONS).filter((k) => CONDITIONS[k].minDay <= day);
  const n = day < 2 ? 0 : day < 5 ? 1 : day < 8 ? 2 : 3;
  const conds = pool.filter((k) => CONDITIONS[k].minDay === day);
  let rest = pool.filter((k) => !conds.includes(k));
  while (conds.length < n && rest.length) {
    let w = rest.reduce((a, k) => a + CONDITIONS[k].weight, 0) * R();
    const pick = rest.find((k) => (w -= CONDITIONS[k].weight) <= 0) || rest[rest.length - 1];
    conds.push(pick); rest = rest.filter((k) => k !== pick);
  }
  const plan = {
    day, conds, kinds,
    pace: 12 + Math.min(2.4, 0.3 * (day - 1)),          // the clock's assumed speed (traffic slows everyone): it tightens daily
    maxDist: 520 + Math.min(220, 30 * (day - 1)),        // customers get further away
    closed: [], surge: null, cameras: [],
    // traffic: the main difficulty dial (user, 2026-10-04). Cars kept around the player.
    traffic: Math.round(Math.min(30, 5 + 2 * (day - 1)) * (conds.includes("rush") ? 1.4 : 1)),
  };
  const restEdges = new Set(city.restaurants.map((r) => r.edge));
  if (conds.includes("roadworks")) {
    // 2-3 street segments, never a restaurant's, never on the district's edge (keeps it connected)
    const cand = city.edges.filter((e) => !restEdges.has(e) && Math.min(e.ax, e.bx, e.az, e.bz) > city.inner.x0 + LINE && Math.max(e.ax, e.bx, e.az, e.bz) < city.inner.x1 - LINE);
    const k = 2 + (R() < 0.5 ? 1 : 0);
    while (plan.closed.length < k && cand.length) plan.closed.push(cand.splice(Math.floor(R() * cand.length), 1)[0]);
  }
  if (conds.includes("surge")) {
    // a 2x2-block patch of town
    const n0 = city.nodes[0], step = city.nodes[1].x - n0.x;
    const i = Math.floor(R() * 5), j = Math.floor(R() * 5);
    plan.surge = { x0: n0.x + i * step, z0: n0.z + j * step, x1: n0.x + (i + 2) * step, z1: n0.z + (j + 2) * step };
  }
  if (conds.includes("cameras")) {
    const cand = city.edges.filter((e) => !plan.closed.includes(e));
    for (let k = 0; k < 4 && cand.length; k++) {
      const e = cand.splice(Math.floor(R() * cand.length), 1)[0];
      const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len, side = R() < 0.5 ? -1 : 1;
      plan.cameras.push({ x: e.ax + dx * e.len / 2 - dz * side * (CURB + 1.2), z: e.az + dz * e.len / 2 + dx * side * (CURB + 1.2), cx: e.ax + dx * e.len / 2, cz: e.az + dz * e.len / 2, edge: e, cool: 0 });
    }
  }
  return plan;
}

/** Barricades across a closed street, just inside each end, from building line to building line. */
export function barriers(plan) {
  const out = [];
  for (const e of plan.closed) {
    const horiz = Math.abs(e.az - e.bz) < 1;
    for (const s of [LINE + 3, e.len - LINE - 3]) {
      const x = e.ax + ((e.bx - e.ax) * s) / e.len, z = e.az + ((e.bz - e.az) * s) / e.len;
      out.push(horiz ? { x0: x - 0.4, x1: x + 0.4, z0: z - LINE, z1: z + LINE, kind: "barrier", edge: e }
        : { x0: x - LINE, x1: x + LINE, z0: z - 0.4, z1: z + 0.4, kind: "barrier", edge: e });
    }
  }
  return out;
}

export const inRect = (r, x, z) => !!r && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/** Set the city and the rules up for a day: closures, barricades, and what rain and rush hour change. */
export function applyPlan(city, plan, fx, p) {
  for (const e of city.edges) e.closed = false;
  for (const e of plan.closed) e.closed = true;
  city.setExtra(barriers(plan));
  if (plan.conds.includes("rain")) { p.mu *= 0.82; p.muOff *= 0.85; fx.tipMul *= 1.15; }
  if (plan.conds.includes("rush")) { fx.timeMul *= 0.85; fx.tipMul *= 1.25; }
  for (const c of plan.cameras) c.cool = 0;
}
