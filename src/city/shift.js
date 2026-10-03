// A shift: one order at a time. Drive to the restaurant, stop in its zone; drive to the customer,
// stop in theirs. The tip drains as the clock runs; drinks spill under hard driving and knocks.
// Your rating is your health: bad deliveries drag it down, and below the line you're deactivated.

import { placeDistance } from "./gps.js";
import { DT } from "../car.js";

export const SHIFT = {
  length: 6 * 60,          // seconds
  zoneR: 6, stopSpeed: 1.8, stopHold: 0.45,
  pace: 13, slack: 10,     // the clock: street distance at this speed (m/s), plus slack seconds
  base: 3, perKm: 9, tipMax: 7,
  spillG: 0.9, spillRate: 0.12, spillHit: 0.02,     // drinks: g over this, per second; and per m/s of impact
  deactivate: 4.0, minJobs: 3,
};

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

export function makeShift(city, seed = 1) {
  const sh = {
    t: 0, money: 0, ratings: [5, 5, 5, 5, 4], jobs: 0, log: [], over: null, order: null, R: rng(seed), events: [],
  };
  return sh;
}

export const rating = (sh) => sh.ratings.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, sh.ratings.length);

function newOrder(sh, city, car) {
  const R = sh.R;
  const rest = city.restaurants[Math.floor(R() * city.restaurants.length)];
  const kind = rest.kinds[Math.floor(R() * rest.kinds.length)];
  // a customer a reasonable drive away
  let cust, d = 0;
  for (let k = 0; k < 40; k++) {
    cust = city.addresses[Math.floor(R() * city.addresses.length)];
    d = placeDistance(city, rest, cust);
    if (d > 180 && d < 520) break;
  }
  const toRest = placeDistance(city, { x: car.x, z: car.z }, rest);
  const time = (toRest + d) / SHIFT.pace + SHIFT.slack;
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
    o.spill += Math.max(0, g - SHIFT.spillG) * SHIFT.spillRate * DT;
    for (const e of car.events) if (e.type === "wall") o.spill += e.speed * SHIFT.spillHit;
    o.spill = Math.min(1, o.spill);
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
  const tip = late > 0 ? 0 : SHIFT.tipMax * (o.left / o.time) * quality;
  const stars = late <= 0 && quality >= 0.75 ? 5 : late < 15 && quality >= 0.5 ? 4 : late < 45 && quality >= 0.25 ? 3 : 1;
  const earned = o.pay * (0.5 + 0.5 * quality) + tip;
  sh.money += earned; sh.jobs++;
  sh.ratings.push(stars);
  const entry = { item: o.item, to: o.cust.label, earned, tip, stars, late, quality };
  sh.log.push(entry);
  sh.events.push({ type: "delivered", ...entry });
  sh.order = null;
  if (sh.jobs >= SHIFT.minJobs && rating(sh) < SHIFT.deactivate) sh.over = "deactivated";
}
