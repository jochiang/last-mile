// Plays whole runs: shifts with the GPS-following courier, then the garage with a simple policy
// (repair to keep the car healthy, buy the best-value mod it can afford). For balancing the
// economy: how many days does "just follow the GPS" last? usage: node tools/runbot.mjs [runs] [--why]
import { buildCity } from "../src/city/map.js";
import { makeCityCar } from "../src/city/world.js";
import { makeShift, rating } from "../src/city/shift.js";
import { makeRun, effects, settleShift, repairCost, repair, buy, modById, billFor } from "../src/city/run.js";
import { driveShift } from "./driver.mjs";
import { dayPlan, applyPlan } from "../src/city/conditions.js";
import { createTraffic } from "../src/city/traffic.js";

const args = process.argv.slice(2);
const runs = +args.find((a) => /^\d+$/.test(a)) || 3;
const why = args.includes("--why");
const city = buildCity();
// what the bot values: money-makers first, then protection
const PRIORITY = ["dice", "freshener", "cups", "underglow", "spinners", "bag", "mints", "dashcam", "bullbar", "coilovers", "tyres", "brakes", "ecu", "stripes", "light"];

const days = [];
const carId = args.includes("--car") ? args[args.indexOf("--car") + 1] : "liftback";
const noTraffic = args.includes("--no-traffic");
for (let n = 0; n < runs; n++) {
  const run = makeRun(1000 + n * 37, carId);
  while (!run.over && run.day <= 30) {
    const { fx, p } = effects(run);
    const plan = dayPlan(city, run.seed, run.day);
    applyPlan(city, plan, fx, p);
    for (const p of city.poles) p.broken = false;   // the city puts its lampposts back overnight
    const car = makeCityCar(city);
    car.cond = run.cond; car.dmgMul = fx.dmgMul; car.bullbar = fx.bullbar;
    const sh = makeShift(city, run.seed + run.day, { ratings: run.ratings, fx, plan });
    const traffic = noTraffic ? null : createTraffic(city, run.seed + run.day);
    traffic?.reset(car, plan.traffic);
    const drove = driveShift(city, car, sh, p, null, traffic);
    const d = settleShift(run, sh, car);
    if (why) console.log(`  day ${d.day} [${plan.conds.join("+") || "-"}, ${plan.traffic} cars]: $${d.earned.toFixed(0)} (${d.jobs} jobs, fines $${sh.fines}), bill $${d.bill}, cash $${run.cash.toFixed(0)}, car ${(run.cond * 100).toFixed(0)}%, rating ${(run.ratings.reduce((a, b) => a + b, 0) / run.ratings.length).toFixed(2)}, walls ${drove.walls}${run.over ? ` -> ${run.over}` : ""}`);
    if (run.over) break;
    // garage: repair to 85% if it's cheap enough, then buy by priority
    if (run.cond < 0.85 && repairCost(run, 0.85) < run.cash * 0.6) repair(run, 0.85);
    for (const id of PRIORITY) if (run.offers.includes(id) && modById[id].price <= run.cash) buy(run, id);
    if (why) console.log(`    garage: car ${(run.cond * 100).toFixed(0)}%, mods [${run.mods.join(", ")}], cash $${run.cash.toFixed(0)}, next bill $${billFor(run, run.day)}`);
  }
  days.push(run.day);
  console.log(`run ${n + 1}: ${run.over || "cap"} on day ${run.day}, earned $${run.earned.toFixed(0)}, mods ${run.mods.length}`);
}
console.log(`days survived: ${days.join(", ")} (mean ${(days.reduce((a, b) => a + b, 0) / days.length).toFixed(1)})`);
