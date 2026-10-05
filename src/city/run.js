// A run: one shift a day until the car's paid off (the win: the last payment of its loan, or
// paying off the rest early in the garage), or you can't make a payment, or the app deactivates you.
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
  payoffDiscount: 0.2,                   // paying the loan off early skips this much of what's left (the interest)
};

// fx: what mods change. p: the car's physics (a copy of P).
const fx0 = () => ({ tipMul: 1, timeMul: 1, spillMul: 1, starBonus: 0, lateForgive: false, dmgMul: 1, repairMul: 1, bullbar: false, underglow: null, loyalty: false, stackMul: 1, stackPay: 1, offers: 3 });

export const MODS = [
  // performance
  { id: "tyres", kind: "perf", name: "Sticky tires", price: 30, desc: "+10% grip", apply: (f, p) => { p.mu *= 1.1; p.muOff *= 1.1; } },
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
  // money-makers: the late game needs income that grows (2026-10-04)
  { id: "loyalty", kind: "biz", name: "Loyalty sticker", price: 30, desc: "+$0.50 per on-time delivery in a row (up to +$4)", apply: (f) => { f.loyalty = true; } },
  { id: "bundle", kind: "biz", name: "Bundle app", price: 28, desc: "Stacked orders (×2) much more often, and they pay 15% more", apply: (f) => { f.stackMul *= 2.75; f.stackPay *= 1.15; } },
  { id: "apppremium", kind: "biz", name: "App Premium", price: 24, desc: "A fourth order on the map to choose from", apply: (f) => { f.offers = 4; } },
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

export const termOf = (run) => carOf(run).term || 14;
/** Paying off the loan before today's shift: every payment left (today's included), less the interest. */
export function payoffCost(run) {
  let left = 0;
  for (let d = run.day; d <= termOf(run); d++) left += billFor(run, d);
  return Math.ceil(left * (1 - ECON.payoffDiscount));
}
export function payOff(run) {
  const c = payoffCost(run);
  if (c > run.cash || run.over) return false;
  run.cash -= c; run.over = "paid"; run.paidEarly = true;
  return true;
}

/** The car's physics and the game rules, with this run's mods applied. */
export function effects(run) {
  // the car first (its physics and what knocks and hard driving cost), then the mods on top
  const car = carOf(run), f = fx0(), p = { ...P, ...car.p };
  for (const k of ["dmgMul", "spillMul", "tipMul"]) if (car.fx[k]) f[k] *= car.fx[k];
  for (const k of ["bullbar", "noFines", "rainGrip"]) if (car.fx[k] !== undefined) f[k] = car.fx[k];
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
  // what happened, for the run report (balancing from real runs)
  const L = shift.log, n = Math.max(1, L.length);
  const day = {
    day: run.day, earned: shift.money, bill, jobs: shift.jobs, cash: run.cash, rating: r, probation: low && !run.probation,
    conds: shift.plan?.conds || [], traffic: shift.plan?.traffic || 0, late: L.filter((l) => l.late > 0).length,
    stars: L.reduce((a, l) => a + l.stars, 0) / n, spilled: L.reduce((a, l) => a + (1 - l.quality), 0) / n,
    tips: L.reduce((a, l) => a + l.tip, 0), fines: shift.fines || 0, hits: shift.hits || 0, condStart: shift.condStart ?? 1, condEnd: car.cond,
    mods: run.mods.slice(), kinds: L.map((l) => l.kind?.[0] || "?").join(""),
  };
  run.log.push(day);
  if (low && run.probation) run.over = "deactivated";
  else if (run.cash < 0) run.over = "repo";
  else if (run.day >= termOf(run)) run.over = "paid";   // the last payment: the car's yours
  run.probation = low;
  if (!run.over) { run.day++; run.rerolls = 0; rollOffers(run); }
  return day;
}

/** A plain-text summary of a run, one line per day, for pasting into a balancing chat. */
export function runReport(run) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const head = `Last Mile run · car ${run.car || "liftback"} · seed ${run.seed} · ${run.over ? `ended day ${run.day} (${run.over === "paid" && run.paidEarly ? "paid off early" : run.over})` : `day ${run.day}`} · earned $${run.earned.toFixed(0)} · mods: ${run.mods.join(", ") || "none"}`;
  const rows = run.log.map((d) => [
    `d${d.day}`, (d.conds || []).join("+") || "-", `${d.traffic ?? "?"}cars`, `$${(d.earned ?? 0).toFixed(0)}/$${d.bill}`, `${d.jobs}jobs`,
    `late${d.late ?? "?"}`, `★${(d.stars ?? 0).toFixed(1)}`, `spill${pct(d.spilled ?? 0)}`, `tips$${(d.tips ?? 0).toFixed(0)}`,
    `hits${d.hits ?? "?"}`, `fines$${d.fines ?? 0}`, `car${pct(d.condStart ?? 1)}→${pct(d.condEnd ?? 1)}`, `cash$${d.cash.toFixed(0)}`, `rating${(d.rating ?? 0).toFixed(2)}`, d.kinds || "",
  ].join(" "));
  return [head, ...rows].join("\n");
}

/** A run that can go in localStorage (no functions). */
export const saveRun = (run) => JSON.stringify({ ...run, R: undefined });
export const loadRun = (s) => ({ ...JSON.parse(s), R: null });
