// A courier bot: follows the GPS line with pure pursuit and plans its speed for the turns ahead.
// Checks the city is drivable and the shift loop works, and gives a baseline for what "following
// the GPS" earns. usage: node tools/citybot.mjs [shifts] [--why]
import { buildCity } from "../src/city/map.js";
import { makeCityCar } from "../src/city/world.js";
import { makeShift, rating } from "../src/city/shift.js";
import { driveShift } from "./driver.mjs";
import { P } from "../src/car2.js";

const args = process.argv.slice(2);
const shifts = +args.find((a) => /^\d+$/.test(a)) || 1;
const why = args.includes("--why");
const city = buildCity();
console.log(`city: ${city.edges.length} street edges, ${city.buildings.length} buildings, ${city.poles.length} lampposts, ${city.trees.length} trees, ${city.parkedCars.length} parked cars, ${city.addresses.length} addresses`);

for (let n = 0; n < shifts; n++) {
  const car = makeCityCar(city), sh = makeShift(city, 1 + n);
  const { walls, poles, resets } = driveShift(city, car, sh, P, why ? console.log : null);
  const lates = sh.log.filter((l) => l.late > 0).length;
  console.log(`shift ${n + 1}: ${sh.over}, ${sh.jobs} deliveries, $${sh.money.toFixed(2)}, rating ${rating(sh).toFixed(2)}, late ${lates}, walls ${walls}, poles ${poles}, resets ${resets}, condition ${(car.cond * 100).toFixed(0)}%`);
}
