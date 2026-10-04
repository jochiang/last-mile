// A shift: one order at a time. Drive to the restaurant, stop in its zone; drive to the customer,
// stop in theirs. The tip drains as the clock runs; drinks spill under hard driving and knocks.
// Your rating is your health: bad deliveries drag it down. It's judged at the end of the day (run.js):
// under the line once is probation, twice running is deactivation.

import { placeDistance } from "./gps.js";
import { DT } from "../car.js";

const inSurge = (r, x, z) => !!r && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

export const SHIFT = {
  length: 5 * 60,          // seconds
  zoneR: 7.5, stopSpeed: 3.2, stopHold: 0.3,   // a rolling crawl (<12 km/h) in the circle counts (user: the old 6.5 km/h was too strict)
  pace: 13, slack: 10,     // the clock: street distance at this speed (m/s), plus slack seconds
  base: 3, perKm: 9, tipMax: 7,
  spillG: 0.9, spillRate: 0.12, spillHit: 0.02,     // drinks: g over this, per second; and per m/s of impact
  cakeG: 0.7, cakeRate: 0.22, cakeHit: 0.06,        // cakes: hate braking/accelerating hard (lengthwise g) and knocks
  surgeMul: 1.5, camLimit: 60 / 3.6, camFine: 6, camR: 10,
  deactivate: 4.0, memory: 20,   // the rating: average of the last `memory` deliveries
};

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

// fx: the run's mods (run.js effects().fx); ratings carry over from earlier shifts
export const HISTORY = () => [...Array(16).fill(5), 4, 4, 4, 4];   // a new driver's 4.8, as if from earlier gigs
// plan: the day's conditions.js dayPlan (null = a plain day-3-ish shift with everything on)
export function makeShift(city, seed = 1, { ratings = HISTORY(), fx = null, plan = null } = {}) {
  return {
    t: 0, money: 0, ratings: ratings.slice(), jobs: 0, log: [], over: null, order: null, R: rng(seed), events: [], fines: 0,
    plan: plan || { kinds: ["food", "drink"], pace: SHIFT.pace, maxDist: 520, surge: null, cameras: [], closed: [] },
    fx: fx || { tipMul: 1, timeMul: 1, spillMul: 1, starBonus: 0, lateForgive: false },
  };
}

export const avgRating = (rs) => { const r = rs.slice(-SHIFT.memory); return r.reduce((a, b) => a + b, 0) / r.length; };
export const rating = (sh) => avgRating(sh.ratings);

function newOrder(sh, city, car) {
  const R = sh.R, plan = sh.plan;
  // only restaurants selling something that's on today
  const open = city.restaurants.filter((r) => r.kinds.some((k) => plan.kinds.includes(k)));
  const rest = open[Math.floor(R() * open.length)];
  const kinds = rest.kinds.filter((k) => plan.kinds.includes(k));
  const kind = kinds[Math.floor(R() * kinds.length)];
  // a customer a reasonable drive away, not behind today's barricades
  const reachable = city.addresses.filter((a) => !a.edge.closed);
  let cust, d = 0;
  for (let k = 0; k < 40; k++) {
    cust = reachable[Math.floor(R() * reachable.length)];
    d = placeDistance(city, rest, cust);
    if (d > 180 && d < plan.maxDist) break;
  }
  const toRest = placeDistance(city, { x: car.x, z: car.z }, rest);
  const time = ((toRest + d) / plan.pace + SHIFT.slack) * sh.fx.timeMul;
  sh.order = {
    rest, cust, kind, dist: d, time, left: time, phase: "pickup", spill: 0, hold: 0,
    pay: SHIFT.base + (SHIFT.perKm * d) / 1000,
    item: rest.menu[kind][Math.floor(R() * rest.menu[kind].length)],
  };
  sh.events.push({ type: "order", order: sh.order });
}

export function stepShift(sh, city, car) {
  sh.events.length = 0;
  if (sh.over) return;
  sh.t += DT;
  if (!sh.order) newOrder(sh, city, car);
  const o = sh.order;
  o.left -= DT;
  // drinks spill: hard cornering/braking/acceleration and knocks
  if (o.kind === "drink" && o.phase === "dropoff") {
    const g = Math.hypot(car.gLat, car.gLong);
    o.spill += Math.max(0, g - SHIFT.spillG) * SHIFT.spillRate * DT * sh.fx.spillMul;
    for (const e of car.events) if (e.type === "wall") o.spill += e.speed * SHIFT.spillHit * sh.fx.spillMul;
    o.spill = Math.min(1, o.spill);
  }
  // cakes: lengthwise g (hard braking, hard launches) and knocks; cornering bothers them less
  if (o.kind === "cake" && o.phase === "dropoff") {
    const g = Math.hypot(car.gLong, car.gLat * 0.5);
    o.spill += Math.max(0, g - SHIFT.cakeG) * SHIFT.cakeRate * DT * sh.fx.spillMul;
    for (const e of car.events) if (e.type === "wall") o.spill += e.speed * SHIFT.cakeHit * sh.fx.spillMul;
    o.spill = Math.min(1, o.spill);
  }
  // speed cameras: a fine for passing one too fast
  for (const c of sh.plan.cameras) {
    c.cool = Math.max(0, c.cool - DT);
    if (c.cool <= 0 && Math.hypot(car.x - c.cx, car.z - c.cz) < SHIFT.camR && Math.hypot(car.vx, car.vz) > SHIFT.camLimit) {
      c.cool = 4; sh.money -= SHIFT.camFine; sh.fines += SHIFT.camFine;
      sh.events.push({ type: "fine", cam: c, speed: Math.hypot(car.vx, car.vz) });
    }
  }
  // stopping in the zone
  const target = o.phase === "pickup" ? o.rest : o.cust;
  const inZone = Math.hypot(car.x - target.x, car.z - target.z) < SHIFT.zoneR;
  const slow = Math.hypot(car.vx, car.vz) < SHIFT.stopSpeed;
  o.hold = inZone && slow ? o.hold + DT : 0;
  o.inZone = inZone;
  if (o.hold >= SHIFT.stopHold) {
    o.hold = 0;
    if (o.phase === "pickup") { o.phase = "dropoff"; sh.events.push({ type: "pickup", order: o }); }
    else deliver(sh);
  }
  if (sh.t >= SHIFT.length && !sh.over) sh.over = "time";
}

function deliver(sh) {
  const o = sh.order, late = -o.left, quality = 1 - o.spill;
  const tip = late > 0 ? 0 : SHIFT.tipMax * (o.left / o.time) * quality * sh.fx.tipMul;
  // gentle (user was deactivated on day 2): nothing under 2 stars unless it's very late or mostly spilled
  let stars = late <= 0 && quality >= 0.75 ? 5 : late < 20 && quality >= 0.5 ? 4 : late < 60 && quality >= 0.25 ? 3 : late < 120 && quality >= 0.1 ? 2 : 1;
  if (late > 0 && sh.fx.lateForgive) stars = Math.min(5, stars + 1);
  stars = Math.min(5, stars + sh.fx.starBonus);
  const surge = inSurge(sh.plan.surge, o.cust.x, o.cust.z) ? SHIFT.surgeMul : 1;
  const earned = (o.pay * (0.5 + 0.5 * quality) + tip) * surge;
  sh.money += earned; sh.jobs++;
  sh.ratings.push(stars);
  const entry = { item: o.item, kind: o.kind, to: o.cust.label, earned, tip, stars, late, quality, surge: surge > 1 };
  sh.log.push(entry);
  sh.events.push({ type: "delivered", ...entry });
  sh.order = null;
}
