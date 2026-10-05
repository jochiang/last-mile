// Traffic soak: NPCs only (a parked observer the traffic gathers around), moved round the city a
// minute at a time. Counts NPC-NPC crashes, cars recycled for being stuck, and average speed.
// usage: node tools/trafficcheck.mjs [minutes] [density]
import { buildCity, X } from "../src/city/map.js";
import { createTraffic } from "../src/city/traffic.js";
import { P } from "../src/car2.js";
import { DT } from "../src/car.js";

const minutes = +(process.argv[2] || 8), density = +(process.argv[3] || 30);
const city = buildCity();
const tr = createTraffic(city, 3);
// observers inside blocks (not on a road): near Broadway's middle, each bend, the park, the edge
const spots = [[X(3) - 20, X(3) - 45], [X(0) + 30, X(0) + 30], [X(6) - 30, X(6) - 30], [X(5) + 33, X(1) - 33], [X(1) - 33, X(5) + 33], [X(4) + 33, X(2) + 33]];
const player = { x: 0, z: 0, vx: 0, vz: 0, h: 0, u: 0, v: 0, events: [], cond: 1 };
let crashes = 0, worst = 0, speedSum = 0, speedN = 0, stuck = 0, wrecks = 0;
const crashAt = {};
for (let m = 0; m < minutes; m++) {
  [player.x, player.z] = spots[m % spots.length];
  tr.reset(player, density);
  for (let t = 0; t < 60 / DT; t++) {
    tr.step(player, P, density);
    for (const e of tr.events) if (e.type === "crash") { crashes++; worst = Math.max(worst, e.speed); const k = `${Math.round(e.x / 10) * 10},${Math.round(e.z / 10) * 10}`; crashAt[k] = (crashAt[k] || 0) + 1; }
    for (const c of tr.cars) { if (c.mode === "drive") { speedSum += c.v; speedN++; } }
  }
  stuck += tr.cars.filter((c) => c.mode === "drive" && c.stuckT > 10).length;
  wrecks += tr.cars.filter((c) => c.mode === "wreck").length;
}
console.log(`${minutes} min at ${density} cars: NPC crashes ${crashes} (${(crashes / minutes).toFixed(1)}/min, worst ${worst.toFixed(1)} m/s), avg speed ${(speedSum / speedN).toFixed(1)} m/s, stuck >10 s at minute ends ${stuck}, wrecks at minute ends ${wrecks}`);
console.log("crash spots (10 m cells):", Object.entries(crashAt).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}×${v}`).join(" "));
