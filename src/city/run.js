// A run: one shift a day until you can't make the car payment or the app deactivates you.
// After each shift the day's bill comes out; then the garage: repairs, and a shop of four random
// mods (each bought once, reroll for a little more each time). Damage and your rating carry over.

import { P } from "../car2.js";
import { CARS } from "./cars.js";
import { HISTORY, avgRating, SHIFT } from "./shift.js";

export const ECON = {
  signing: 40,                           // starting cash
  repairPerPct: 0.5,                     // $ per percentage point of condition
  rerollBase: 4, rerollStep: 2,
  offers: 4,
};

// fx: what mods change. p: the car's physics (a copy of P).
const fx0 = () => ({ tipMul: 1, timeMul: 1, spillMul: 1, starBonus: 0, lateForgive: false, dmgMul: 1, repairMul: 1, bullbar: false, underglow: null });

export const MODS = [
  // performance
  { id: "tyres", kind: "perf", name: "Sticky tyres", price: 30, desc: "+10% grip", apply: (f, p) => { p.mu *= 1.1; p.muOff *= 1.1; } },
  { id: "ecu", kind: "perf", name: "ECU remap", price: 35, desc: "+15% power", apply: (f, p) => { p.power *= 1.15; p.fMax *= 1.1; } },
  { id: "brakes", kind: "perf", name: "Big brakes", price: 25, desc: "+15% braking, later ABS", apply: (f, p) => { p.brakeMax *= 1.15; p.abs = Math.min(0.95, p.abs + 0.05); } },
  { id: "coilovers", kind: "perf", name: "Coilovers", price: 30, desc: "Flatter cornering: −30% spills", apply: (f, p) => { f.spillMul *= 0.7; p.hcg *= 0.85; } },
  { id: "bullbar", kind: "perf", name: "Bull bar", price: 25, desc: "−50% crash damage; lampposts don't slow you", apply: (f) => { f.dmgMul *= 0.5; f.bullbar = true; } },
  { id: "light", kind: "perf", name: "Lightweight panels", price: 30, desc: "−12% weight, but +25% crash damage", apply: (f, p) => { p.m *= 0.88; p.Iz *= 0.88; f.dmgMul *= 1.25; } },
  // cargo
  { id: "cups", kind: "cargo", name: "Cup holder", price: 12, desc: "−35% spills", apply: (f) => { f.spillMul *= 0.65; } },
  { id: "bag", kind: "cargo", name: "Insulated bag", price: 20, desc: "+12% time on every order", apply: (f) => { f.timeMul *= 1.12; } },
  // silly
  { id: "underglow", kind: "silly", name: "LED underglow", price: 40, desc: "+20% tips. Customers love a show", apply: (f) => { f.tipMul *= 1.2; f.underglow = 0xff2bd6; } },
  { id: "dice", kind: "silly", name: "Fuzzy dice", price: 8, desc: "+5% tips", apply: (f) => { f.tipMul *= 1.05; } },
  { id: "spinners", kind: "silly", name: "Spinner rims", price: 35, desc: "+12% tips, −3% grip (worth it)", apply: (f, p) => { f.tipMul *= 1.12; p.mu *= 0.97; } },
  { id: "stripes", kind: "silly", name: "Racing stripes", price: 18, desc: "+3% top speed. Everyone knows stripes are faster", apply: (f, p) => { p.power *= 1.09; } },
  { id: "freshener", kind: "silly", name: "Pine air freshener", price: 10, desc: "Customers rate you +0.3★", apply: (f) => { f.starBonus += 0.3; } },
  { id: "dashcam", kind: "silly", name: "Dash cam", price: 22, desc: "Repairs 30% cheaper (insurance claims)", apply: (f) => { f.repairMul *= 0.7; } },
  { id: "mints", kind: "silly", name: "Bowl of mints", price: 14, desc: "Late deliveries cost one star less", apply: (f) => { f.lateForgive = true; } },
];
export const modById = Object.fromEntries(MODS.map((m) => [m.id, m]));

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

export function makeRun(seed = Date.now() % 100000 + 1, car = "liftback") {
  return { seed, car, day: 1, cash: ECON.signing, cond: 1, ratings: HISTORY(), probation: false, mods: [], offers: [], rerolls: 0, over: null, log: [], earned: 0, R: null };
}
const R = (run) => (run.R ||= rng(run.seed * 31 + run.day * 7 + run.rerolls));

export const carOf = (run) => CARS[run.car] || CARS.liftback;
/** The car payment due after day d's shift: each car has its own curve. */
export const billFor = (run, d) => carOf(run).bill(d);

/** The car's physics and the game rules, with this run's mods applied. */
export function effects(run) {
  // the car first (its physics and what knocks and hard driving cost), then the mods on top
  const car = carOf(run), f = fx0(), p = { ...P, ...car.p };
  if (car.fx.dmgMul) f.dmgMul *= car.fx.dmgMul;
  if (car.fx.spillMul) f.spillMul *= car.fx.spillMul;
  for (const id of run.mods) modById[id].apply(f, p);
  return { fx: f, p };
}

export const repairCost = (run, toCond = 1) => Math.ceil(Math.max(0, toCond - run.cond) * 100 * ECON.repairPerPct * effects(run).fx.repairMul);
export function repair(run, toCond = 1) {
  const cost = repairCost(run, toCond);
  if (cost > run.cash) return false;
  run.cash -= cost; run.cond = Math.max(run.cond, toCond);
  return true;
}

export function rollOffers(run) {
  const pool = MODS.filter((m) => !run.mods.includes(m.id));
  const r = rng(run.seed * 131 + run.day * 17 + run.rerolls * 7919);
  run.offers = [];
  while (run.offers.length < ECON.offers && pool.length) run.offers.push(pool.splice(Math.floor(r() * pool.length), 1)[0].id);
}
export const rerollCost = (run) => ECON.rerollBase + ECON.rerollStep * run.rerolls;
export function reroll(run) {
  const c = rerollCost(run);
  if (c > run.cash) return false;
  run.cash -= c; run.rerolls++;
  rollOffers(run);
  return true;
}
export function buy(run, id) {
  const m = modById[id];
  if (!m || run.mods.includes(id) || m.price > run.cash) return false;
  run.cash -= m.price; run.mods.push(id);
  run.offers = run.offers.filter((o) => o !== id);
  return true;
}

/** Close out a shift: pay, keep the damage and ratings, take the bill. Returns the day's summary. */
export function settleShift(run, shift, car) {
  const bill = billFor(run, run.day);
  run.cash += shift.money; run.earned += shift.money;
  run.cond = car.cond;
  run.ratings = shift.ratings.slice(-SHIFT.memory);
  run.cash -= bill;
  // the rating is judged at the end of the day: under the line is probation, twice running is the end
  const r = avgRating(run.ratings), low = r < SHIFT.deactivate;
  const day = { day: run.day, earned: shift.money, bill, jobs: shift.jobs, cash: run.cash, rating: r, probation: low && !run.probation };
  run.log.push(day);
  if (low && run.probation) run.over = "deactivated";
  else if (run.cash < 0) run.over = "repo";
  run.probation = low;
  if (!run.over) { run.day++; run.rerolls = 0; rollOffers(run); }
  return day;
}

/** A run that can go in localStorage (no functions). */
export const saveRun = (run) => JSON.stringify({ ...run, R: undefined });
export const loadRun = (s) => ({ ...JSON.parse(s), R: null });
