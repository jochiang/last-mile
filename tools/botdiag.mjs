// One shift with the bot, and where its time went (stats buckets) — for debugging the driver.
// usage: node tools/botdiag.mjs [day] [--n seeds] [--simple] [--nopass] [--oncoming] [--nowalk] [--shortcuts] [--notraffic] [--car id] [--why]; SEED=n env
import { buildCity } from "../src/city/map.js";
import { makeCityCar } from "../src/city/world.js";
import { makeShift } from "../src/city/shift.js";
import { makeRun, effects } from "../src/city/run.js";
import { driveShift } from "./driver.mjs";
import { dayPlan, applyPlan } from "../src/city/conditions.js";
import { createTraffic } from "../src/city/traffic.js";

const args = process.argv.slice(2);
const day = +args.find((a) => /^\d+$/.test(a)) || 1, simple = args.includes("--simple");
const carId = args.includes("--car") ? args[args.indexOf("--car") + 1] : "liftback";
const city = buildCity();
const N = args.includes("--n") ? +args[args.indexOf("--n") + 1] : 1, verbose = N === 1;
const tot = { jobs: 0, money: 0, walls: 0, passes: 0, dist: 0 };
for (let k = 0; k < N; k++) {
  const run = makeRun((+process.env.SEED || 1000) + k * 37, carId); run.day = day;
  const { fx, p } = effects(run);
  const plan = dayPlan(city, run.seed, day);
  applyPlan(city, plan, fx, p);
  for (const q of city.poles) q.broken = false;
  const car = makeCityCar(city);
  const sh = makeShift(city, run.seed + day, { ratings: run.ratings, fx, plan });
  const traffic = args.includes("--notraffic") ? null : createTraffic(city, run.seed + day);
  traffic?.reset(car, plan.traffic);
  const stats = {};
  const r = driveShift(city, car, sh, p, verbose && args.includes("--why") ? console.log : null, traffic, stats, { simple, noPass: args.includes("--nopass"), oncoming: args.includes("--oncoming"), noWalk: args.includes("--nowalk"), shortcuts: args.includes("--shortcuts") });
  tot.jobs += sh.jobs; tot.money += sh.money; tot.walls += r.walls; tot.passes += r.passes; tot.walks = (tot.walks || 0) + r.walks; tot.sc = (tot.sc || 0) + r.shortcuts; tot.poles = (tot.poles || 0) + r.poles; tot.dist += stats.dist; tot.hitCar = (tot.hitCar || 0) + (stats.hitCar || 0); tot.hitWall = (tot.hitWall || 0) + (stats.hitWall || 0);
  if (verbose) {
    console.log(`driven ${stats.dist.toFixed(0)} m, average ${(stats.dist / (stats.ticks / 60)).toFixed(1)} m/s, top ${stats.top.toFixed(1)} m/s`);
    console.log(Object.entries(stats).filter(([k]) => !["ticks", "why", "dist", "top", "hitCar", "hitWall"].includes(k)).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / 60).toFixed(0)}s`).join(", "));
  }
}
const f = (v) => (v / N).toFixed(1);
console.log(`day ${day} ${simple ? "simple" : "smart "} ×${N}: ${f(tot.jobs)} jobs, $${f(tot.money)}, ${f(tot.dist)} m, walls ${f(tot.walls)} (cars ${f(tot.hitCar)}, walls ${f(tot.hitWall)}), passes ${f(tot.passes)}, sidewalk ${f(tot.walks)}×, poles ${f(tot.poles)}, shortcuts ${f(tot.sc)}`);
