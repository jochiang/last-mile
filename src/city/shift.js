// A shift. After each delivery a few orders light up at different restaurants; stopping at one
// takes it. An order is one pickup and one or two drop-offs (a stacked order); each drop-off has
// its own clock (from pickup), tip and spill meter, and you can deliver them in either order.
// The tip drains as a clock runs; drinks, cakes and catering trays suffer under hard driving.
// Your rating is your health: bad deliveries drag it down. It's judged at the end of the day (run.js):
// under the line once is probation, twice running is deactivation.

import { placeDistance } from "./gps.js";
import { DT } from "../car.js";

const inSurge = (r, x, z) => !!r && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

export const SHIFT = {
  length: 4 * 60,          // seconds (5 → 4 min, 2026-10-04: the user found days 4-5 comfortable; shorter shifts = less money a day, same payments)
  zoneR: 7.5, stopSpeed: 3.2, stopHold: 0.3,   // a rolling crawl (<12 km/h) in the circle counts (user: the old 6.5 km/h was too strict)
  pace: 13, slack: 10,     // the clock: street distance at this speed (m/s), plus slack seconds
  base: 3, perKm: 9, tipMax: 7,
  spillG: 0.9, spillRate: 0.12, spillHit: 0.02,     // drinks: g over this, per second; and per m/s of impact
  cakeG: 0.7, cakeRate: 0.22, cakeHit: 0.06,        // cakes and catering: hate braking/accelerating hard (lengthwise g) and knocks
  surgeMul: 1.5, camLimit: 35 / 2.23694, camFine: 6, camR: 10,   // cameras: 35 mph
  deactivate: 4.0, memory: 20,   // the rating: average of the last `memory` deliveries
  // the late game (2026-10-04): stacked orders (one pickup, two drop-offs) and premium orders
  stackFrom: 3, stackChance: 0.2, premiumFrom: 5, premiumChance: 0.25, premiumPay: 3, premiumTip: 1.8, premiumTime: 1.25,
  loyaltyStep: 0.5, loyaltyMax: 4,   // the loyalty sticker: $0.50 more per on-time delivery in a row, up to $4
};

const PREMIUM = [
  { kind: "catering", items: ["Catering tray", "Party platter", "Sheet cake (catering)"], fragile: true },
  { kind: "lunch", items: ["Office lunch ×12", "Team lunch", "Board meeting sandwiches"], fragile: false },
];

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

// fx: the run's mods (run.js effects().fx); ratings carry over from earlier shifts
export const HISTORY = () => [...Array(16).fill(5), 4, 4, 4, 4];   // a new driver's 4.8, as if from earlier gigs
const FX0 = { tipMul: 1, timeMul: 1, spillMul: 1, starBonus: 0, lateForgive: false, loyalty: false, stackMul: 1, stackPay: 1, offers: 3 };
// plan: the day's conditions.js dayPlan (null = a plain day-3-ish shift with everything on)
export function makeShift(city, seed = 1, { ratings = HISTORY(), fx = null, plan = null } = {}) {
  return {
    t: 0, money: 0, ratings: ratings.slice(), jobs: 0, offers: [], log: [], over: null, order: null, R: rng(seed), events: [], fines: 0, streak: 0,
    plan: plan || { day: 3, kinds: ["food", "drink"], pace: SHIFT.pace, maxDist: 520, surge: null, cameras: [], closed: [] },
    fx: { ...FX0, ...(fx || {}) },
  };
}

export const avgRating = (rs) => { const r = rs.slice(-SHIFT.memory); return r.reduce((a, b) => a + b, 0) / r.length; };
export const rating = (sh) => avgRating(sh.ratings);

// --- offers

function pickCustomer(sh, city, from, maxDist) {
  const R = sh.R, reachable = city.addresses.filter((a) => !a.edge.closed);
  let cust, d = 0;
  for (let k = 0; k < 40; k++) {
    cust = reachable[Math.floor(R() * reachable.length)];
    d = placeDistance(city, from, cust);
    if (d > 180 && d < maxDist) break;
  }
  return [cust, d];
}

function makeDrop(sh, cust, d, kind, item, premium) {
  const surge = inSurge(sh.plan.surge, cust.x, cust.z);
  const pay = (SHIFT.base + (SHIFT.perKm * d) / 1000) * (premium ? SHIFT.premiumPay : 1);
  return { cust, kind, item, dist: d, pay, surge, premium: !!premium, spill: 0, hold: 0, time: 0, left: 0, done: false, fragile: kind === "cake" || !!(premium && premium.fragile) };
}

function makeOffer(sh, city, rest) {
  const R = sh.R, plan = sh.plan, fx = sh.fx, day = plan.day ?? 3;
  const kinds = rest.kinds.filter((k) => plan.kinds.includes(k));
  const pickKind = () => kinds[Math.floor(R() * kinds.length)];
  const itemOf = (k) => rest.menu[k][Math.floor(R() * rest.menu[k].length)];
  // premium (one per set at most), stacked, or plain
  const premium = day >= SHIFT.premiumFrom && !sh.offers.some((o) => o.premium) && R() < SHIFT.premiumChance ? PREMIUM[Math.floor(R() * PREMIUM.length)] : null;
  const stacked = !premium && day >= SHIFT.stackFrom && R() < Math.min(0.8, SHIFT.stackChance * fx.stackMul);
  const drops = [];
  const [c1, d1] = pickCustomer(sh, city, rest, plan.maxDist);
  if (premium) drops.push(makeDrop(sh, c1, d1, premium.kind, premium.items[Math.floor(R() * premium.items.length)], premium));
  else { const k = pickKind(); drops.push(makeDrop(sh, c1, d1, k, itemOf(k), null)); }
  if (stacked) {
    let c2, d2;
    for (let k = 0; k < 10; k++) { [c2, d2] = pickCustomer(sh, city, rest, plan.maxDist); if (c2 !== c1) break; }
    const k = pickKind();
    drops.push(makeDrop(sh, c2, d2, k, itemOf(k), null));
    for (const d of drops) d.pay *= fx.stackPay;
  }
  // what the app advertises: base pay plus the best possible tip, for every drop
  const est = drops.reduce((a, d) => a + (d.pay + SHIFT.tipMax * fx.tipMul * (d.premium ? SHIFT.premiumTip : 1)) * (d.surge ? SHIFT.surgeMul : 1), 0);
  return { rest, drops, premium: !!premium, stacked, est, hold: 0, inZone: false, surge: drops.some((d) => d.surge),
    kind: drops[0].kind, dist: Math.max(...drops.map((d) => d.dist)) };
}

function newOffers(sh, city) {
  const open = city.restaurants.filter((r) => r.kinds.some((k) => sh.plan.kinds.includes(k)));
  const pool = open.slice();
  sh.offers = [];
  while (sh.offers.length < sh.fx.offers && pool.length) sh.offers.push(makeOffer(sh, city, pool.splice(Math.floor(sh.R() * pool.length), 1)[0]));
  sh.events.push({ type: "offers", offers: sh.offers });
}

// pickup: the clocks start. Nearer drop first; the second's clock allows for the first stop.
function take(sh, city, o) {
  const pace = sh.plan.pace, k = o.premium ? SHIFT.premiumTime : 1;
  o.drops.sort((a, b) => a.dist - b.dist);
  const [a, b] = o.drops;
  a.time = (a.dist / pace + SHIFT.slack) * sh.fx.timeMul * k;
  if (b) b.time = ((a.dist + placeDistance(city, a.cust, b.cust)) / pace + SHIFT.slack * 1.6) * sh.fx.timeMul;
  for (const d of o.drops) d.left = d.time;
  o.phase = "dropoff";
  sh.order = o; sh.offers = [];
  sh.events.push({ type: "pickup", order: o });
}

// stopping inside a zone: under the stop speed for the hold time
function stopIn(o, target, car, slow) {
  o.inZone = Math.hypot(car.x - target.x, car.z - target.z) < SHIFT.zoneR;
  o.hold = o.inZone && slow ? o.hold + DT : 0;
  return o.hold >= SHIFT.stopHold;
}

export function stepShift(sh, city, car) {
  sh.events.length = 0;
  if (sh.over) return;
  sh.t += DT;
  const slow = Math.hypot(car.vx, car.vz) < SHIFT.stopSpeed;
  if (!sh.order) {
    if (!sh.offers?.length) newOffers(sh, city);
    for (const of of sh.offers) if (stopIn(of, of.rest, car, slow)) { take(sh, city, of); break; }
  }
  cameras(sh, car);
  if (sh.t >= SHIFT.length && !sh.over) sh.over = "time";
  const o = sh.order;
  if (!o) return;
  const hits = car.events.filter((e) => e.type === "wall");
  for (const d of o.drops) {
    if (d.done) continue;
    d.left -= DT;
    // drinks spill: hard cornering/braking/acceleration and knocks
    if (d.kind === "drink") {
      d.spill += Math.max(0, Math.hypot(car.gLat, car.gLong) - SHIFT.spillG) * SHIFT.spillRate * DT * sh.fx.spillMul;
      for (const e of hits) d.spill += e.speed * SHIFT.spillHit * sh.fx.spillMul;
    }
    // cakes and catering trays: lengthwise g (hard braking, hard launches) and knocks
    if (d.fragile) {
      d.spill += Math.max(0, Math.hypot(car.gLong, car.gLat * 0.5) - SHIFT.cakeG) * SHIFT.cakeRate * DT * sh.fx.spillMul;
      for (const e of hits) d.spill += e.speed * SHIFT.cakeHit * sh.fx.spillMul;
    }
    d.spill = Math.min(1, d.spill);
  }
  for (const d of o.drops) if (!d.done && stopIn(d, d.cust, car, slow)) { d.hold = 0; deliver(sh, d); break; }
  if (o.drops.every((d) => d.done)) sh.order = null;
}

// speed cameras: a fine for passing one too fast
function cameras(sh, car) {
  for (const c of sh.plan.cameras) {
    c.cool = Math.max(0, c.cool - DT);
    if (!sh.fx.noFines && c.cool <= 0 && Math.hypot(car.x - c.cx, car.z - c.cz) < SHIFT.camR && Math.hypot(car.vx, car.vz) > SHIFT.camLimit) {
      c.cool = 4; sh.money -= SHIFT.camFine; sh.fines += SHIFT.camFine;
      sh.events.push({ type: "fine", cam: c, speed: Math.hypot(car.vx, car.vz) });
    }
  }
}

function deliver(sh, d) {
  d.done = true;
  const late = -d.left, quality = 1 - d.spill;
  const tip = late > 0 ? 0 : SHIFT.tipMax * (d.left / d.time) * quality * sh.fx.tipMul * (d.premium ? SHIFT.premiumTip : 1);
  // gentle (user was deactivated on day 2): nothing under 2 stars unless it's very late or mostly spilled
  let stars = late <= 0 && quality >= 0.75 ? 5 : late < 20 && quality >= 0.5 ? 4 : late < 60 && quality >= 0.25 ? 3 : late < 120 && quality >= 0.1 ? 2 : 1;
  if (late > 0 && sh.fx.lateForgive) stars = Math.min(5, stars + 1);
  stars = Math.min(5, stars + sh.fx.starBonus);
  // the loyalty sticker: a growing bonus for on-time, intact deliveries in a row
  const clean = late <= 0 && quality >= 0.75;
  sh.streak = clean ? sh.streak + 1 : 0;
  const loyalty = sh.fx.loyalty && clean ? Math.min(SHIFT.loyaltyMax, SHIFT.loyaltyStep * sh.streak) : 0;
  const surge = d.surge ? SHIFT.surgeMul : 1;
  const earned = (d.pay * (0.5 + 0.5 * quality) + tip) * surge + loyalty;
  sh.money += earned; sh.jobs++;
  sh.ratings.push(stars);
  const left = sh.order ? sh.order.drops.filter((x) => !x.done).length : 0;
  const entry = { item: d.item, kind: d.kind, to: d.cust.label, earned, tip, stars, late, quality, surge: surge > 1, loyalty, streak: sh.streak, left };
  sh.log.push(entry);
  sh.events.push({ type: "delivered", ...entry });
}
