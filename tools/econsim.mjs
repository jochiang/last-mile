// The economy without the driving (2026-10-05, user: runs take an hour+; "look at how distances are
// distributed and fares/power ups to see if we can just walk it forward based on a few assumptions").
// The game's own shift code runs every tick (offers, clocks, tips, ratings, premium and stacked orders,
// conditions, bills, mods, the payoff) but the car teleports: each leg takes
//   route distance / speed + a stop's worth of seconds,
// where speed is a driver profile's, slowed by traffic and a beaten car. Damage and spills are per-day
// and per-drop rates. Driver profiles are assumptions, calibrated against real runs (see PROFILES).
//
// usage: node tools/econsim.mjs [--runs N] [--car id|all] [--profile you|bot|NAME] [--set K=V ...]
//        [--policy greedy|nearest|random] [--dist] [--days] [--json]
//   --set SHIFT.premiumChance=0.15, ECON.payoffDiscount=0.3, PROFILE.v=16 ... (what-ifs)
//   --dist: distributions of trip distances and fares by day; --days: per-day means (earned vs bill)
import { buildCity } from "../src/city/map.js";
import { placeDistance } from "../src/city/gps.js";
import { makeShift, stepShift, SHIFT, avgRating } from "../src/city/shift.js";
import { makeRun, effects, settleShift, repairCost, repair, buy, modById, billFor, payOff, termOf, ECON, rollOffers } from "../src/city/run.js";
import { dayPlan, applyPlan } from "../src/city/conditions.js";
import { CARS, CAR_ORDER } from "../src/city/cars.js";
import { DT } from "../src/car.js";

// Driver profiles. v: average speed along the route (m/s, corners included) on empty streets;
// stop: seconds a stop costs (slowing, the hold, pulling away); traffic: speed lost per traffic car;
// dmg: % condition lost per day on the base car at 0 traffic, plus dmgPerCar per traffic car (before
// the car's and the mods' damage multipliers); spill: the mean spill on a drink or fragile drop.
export const PROFILES = {
  // the user's hauler run (2026-10-05 report): ~7 drops/day flat from day 4 to 12 while traffic went
  // 11 → 38 cars (traffic barely slows them); ~25%/day damage in the hauler (×0.6) early, rising with
  // traffic; spill ~10% over all drops (so ~25% on the ones that spill). v is fitted (--calibrate).
  you: { v: 16, stop: 6, traffic: 0.002, dmg: 30, dmgPerCar: 1.0, spill: 0.25 },
  // the smart bot (tools/runbot.mjs): ~5.5 drops/shift on empty streets, ~2 at day-9 traffic
  bot: { v: 12.5, stop: 7, traffic: 0.018, dmg: 25, dmgPerCar: 1.2, spill: 0.3 },
};
// performance mods make you a bit quicker (an assumption: a few % each)
const PERF = { tyres: 0.03, ecu: 0.03, brakes: 0.02, stripes: 0.01, coilovers: 0.01, light: 0.02 };
// each car's pace relative to the liftback (an assumption from carcompare + feel)
const CAR_PACE = { liftback: 1, hauler: 0.9, roadster: 0.95, kei: 0.85, interceptor: 1.05, rally: 1.05 };
const PRIORITY = ["loyalty", "bundle", "apppremium", "dice", "freshener", "cups", "underglow", "spinners", "bag", "mints", "dashcam", "bullbar", "coilovers", "tyres", "brakes", "ecu", "stripes", "light"];

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const runs = +arg("--runs", 200), carArg = arg("--car", "liftback"), profName = arg("--profile", "you");
// how orders are chosen: greedy ($/s, takes every premium it sensibly can), nearest (the closest
// restaurant), random (whatever)
const policy = arg("--policy", "greedy");
const PROFILE = { ...(PROFILES[profName] || PROFILES.you) };
// what-ifs: --set SHIFT.x=1 / ECON.x=1 / PROFILE.x=1 (repeatable)
for (let i = 0; i < args.length; i++) if (args[i] === "--set") {
  const [k, v] = args[i + 1].split("="), [obj, key] = k.split(".");
  ({ SHIFT, ECON, PROFILE })[obj][key] = +v;
}

const city = buildCity();
let rngState = 12345;
const rand = () => ((rngState = (rngState * 16807) % 2147483647) / 2147483647);
const FAR = { x: 1e5, z: 1e5 };

/** One shift, driving abstracted. Returns stats; the shift object is the game's own. */
function simShift(run, prof, distLog) {
  const { fx, p } = effects(run);
  const plan = dayPlan(city, run.seed, run.day);
  applyPlan(city, plan, fx, p);
  const sh = makeShift(city, run.seed * 101 + run.day, { ratings: run.ratings, fx, plan });
  const car = { x: city.start.x, z: city.start.z, vx: 0, vz: 0, gLat: 0, gLong: 0, events: [], cond: run.cond };
  let at = { x: car.x, z: car.z };
  const perf = run.mods.reduce((a, m) => a + (PERF[m] || 0), 0);
  const speed = () => prof.v * (CAR_PACE[run.car] ?? 1) * (1 + perf) * (0.85 + 0.15 * car.cond) / (1 + prof.traffic * plan.traffic);
  const wait = (secs) => { for (let t = 0; t < secs && !sh.over; t += DT) stepShift(sh, city, car); };
  // travel somewhere: the clock runs while you're away from every zone, then you arrive and stop
  const go = (dest) => {
    const d = placeDistance(city, at, dest);
    car.x = FAR.x; car.z = FAR.z;
    wait(d / speed() + prof.stop * 0.6);
    car.x = dest.x; car.z = dest.z; at = dest;
    return d;
  };
  const stopHere = (done) => { for (let k = 0; k < 120 && !sh.over && !done(); k++) stepShift(sh, city, car); };
  stepShift(sh, city, car);
  while (!sh.over) {
    if (!sh.order) {
      if (!sh.offers.length) { stepShift(sh, city, car); continue; }
      // greedy: advertised dollars per second, getting there included
      const rate = (of) => of.est / ((placeDistance(city, at, of.rest) + of.drops.reduce((a, d) => a + d.dist, 0)) / speed() + prof.stop * (1 + of.drops.length));
      const near = (o) => -placeDistance(city, at, o.rest);
      const score = policy === "nearest" ? near : policy === "random" ? () => rand() : rate;
      const sc = sh.offers.map((o) => [o, score(o)]), of = sc.reduce((b, x) => (x[1] > b[1] ? x : b))[0];
      distLog?.push({ day: run.day, toRest: placeDistance(city, at, of.rest), dists: of.drops.map((d) => d.dist), est: of.est, premium: of.premium, stacked: of.stacked });
      go(of.rest);
      stopHere(() => !!sh.order);
      continue;
    }
    // the tightest clock first if it's tight, else the nearest
    const ds = sh.order.drops.filter((d) => !d.done);
    const eta = (d) => placeDistance(city, at, d.cust) / speed();
    const tight = ds.filter((d) => d.left - eta(d) < 15);
    const d = (tight.length ? tight : ds).reduce((b, x) => (eta(x) < eta(b) ? x : b));
    go(d.cust);
    if (sh.over) break;
    if (d.kind === "drink" || d.fragile) d.spill = Math.min(1, d.spill + rand() * 2 * prof.spill * sh.fx.spillMul);
    const before = sh.jobs;
    stopHere(() => sh.jobs > before);
  }
  // the day's knocks
  const dmg = (prof.dmg + prof.dmgPerCar * plan.traffic) / 100 * fx.dmgMul * (0.6 + 0.8 * rand());
  car.cond = Math.max(0, run.cond - dmg);
  sh.condStart = run.cond;
  return { sh, car, plan };
}

function garage(run) {
  if (payOff(run)) return;
  if (run.cond < 0.95 && repairCost(run, 1) < run.cash * 0.5) repair(run, 1);
  else if (run.cond < 0.7) { const per = repairCost(run, 1) / (1 - run.cond); repair(run, Math.min(1, run.cond + Math.floor((run.cash * 0.5) / per * 100) / 100)); }
  const reserve = billFor(run, run.day) * 0.5;
  for (const id of PRIORITY) if (run.offers.includes(id) && modById[id].price <= run.cash - reserve) buy(run, id);
}

function simRun(carId, seed, prof, distLog) {
  const run = makeRun(seed, carId);
  rollOffers(run);
  const days = [];
  while (!run.over && run.day <= 30) {
    const { sh, car } = simShift(run, prof, distLog);
    const d = settleShift(run, sh, car);
    days.push({ ...d, mods: run.mods.length });
    if (!run.over) garage(run);
  }
  return { run, days };
}

// --- run it
const cars = carArg === "all" ? CAR_ORDER : [carArg];
const out = {};
for (const carId of cars) {
  const distLog = args.includes("--dist") ? [] : null;
  const res = [];
  for (let k = 0; k < runs; k++) { rngState = 1000 + k * 7919; res.push(simRun(carId, 1000 + k * 37, PROFILE, distLog)); }
  const ends = res.map((r) => r.run.over), N = res.length;
  const count = (w) => ends.filter((e) => e === w).length;
  const lastDay = res.map((r) => (r.run.over === "paid" && r.run.paidEarly ? r.run.day - 1 : r.run.day));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const hist = {};
  for (let k = 0; k < N; k++) { const key = `${String(lastDay[k]).padStart(2)} ${ends[k]}`; hist[key] = (hist[key] || 0) + 1; }
  console.log(`\n${CARS[carId].name} (term ${termOf(res[0].run)}), ${policy} orders, profile ${profName} ${JSON.stringify(PROFILE)}, ${N} runs`);
  console.log(`  paid off ${((100 * count("paid")) / N).toFixed(0)}% (early ${((100 * res.filter((r) => r.run.paidEarly).length) / N).toFixed(0)}%) · repo ${((100 * count("repo")) / N).toFixed(0)}% · deactivated ${((100 * count("deactivated")) / N).toFixed(0)}% · mean last day ${mean(lastDay).toFixed(1)}`);
  console.log("  how runs end: " + Object.entries(hist).sort().map(([k, v]) => `d${k.trim()} ${v}`).join(", "));
  if (args.includes("--days")) {
    console.log("  day  runs  earned  bill  jobs  tips  late  rating  cash   car   mods");
    for (let d = 1; d <= 16; d++) {
      const rows = res.map((r) => r.days.find((x) => x.day === d)).filter(Boolean);
      if (!rows.length) break;
      const m = (f) => mean(rows.map(f));
      console.log(`  ${String(d).padStart(3)}  ${String(rows.length).padStart(4)}  ${m((x) => x.earned).toFixed(0).padStart(6)}  ${m((x) => x.bill).toFixed(0).padStart(4)}  ${m((x) => x.jobs).toFixed(1).padStart(4)}  ${m((x) => x.tips).toFixed(0).padStart(4)}  ${m((x) => x.late).toFixed(1).padStart(4)}  ${m((x) => x.rating).toFixed(2).padStart(6)}  ${m((x) => x.cash).toFixed(0).padStart(5)}  ${(m((x) => x.condEnd) * 100).toFixed(0).padStart(3)}%  ${m((x) => x.mods).toFixed(1).padStart(4)}`);
    }
  }
  if (distLog) {
    console.log("  offers taken: day  n  to-restaurant  drop distance (p10/p50/p90)  advertised $ (p50)  premium  stacked");
    const q = (a, f) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0; };
    for (let d = 1; d <= 16; d++) {
      const rows = distLog.filter((x) => x.day === d);
      if (!rows.length) break;
      const dd = rows.flatMap((x) => x.dists);
      console.log(`  ${String(d).padStart(3)}  ${String(rows.length).padStart(4)}  ${mean(rows.map((x) => x.toRest)).toFixed(0).padStart(5)} m  ${q(dd, 0.1).toFixed(0)}/${q(dd, 0.5).toFixed(0)}/${q(dd, 0.9).toFixed(0)} m  $${q(rows.map((x) => x.est), 0.5).toFixed(0)}  ${((100 * rows.filter((x) => x.premium).length) / rows.length).toFixed(0)}%  ${((100 * rows.filter((x) => x.stacked).length) / rows.length).toFixed(0)}%`);
    }
  }
  out[carId] = { paid: count("paid") / N, repo: count("repo") / N, deactivated: count("deactivated") / N, meanLastDay: mean(lastDay) };
}
if (args.includes("--json")) console.log(JSON.stringify(out));
