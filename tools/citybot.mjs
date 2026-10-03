// A courier bot: follows the GPS line with pure pursuit and plans its speed for the turns ahead.
// Checks the city is drivable and the shift loop works, and gives a baseline for what "following
// the GPS" earns. usage: node tools/citybot.mjs [shifts] [--why]
import { buildCity } from "../src/city/map.js";
import { route } from "../src/city/gps.js";
import { makeCityCar, stepCityCar } from "../src/city/world.js";
import { makeShift, stepShift, rating } from "../src/city/shift.js";
import { P } from "../src/car2.js";

const args = process.argv.slice(2);
const shifts = +args.find((a) => /^\d+$/.test(a)) || 1;
const why = args.includes("--why");
const city = buildCity();
console.log(`city: ${city.edges.length} street edges, ${city.buildings.length} buildings, ${city.poles.length} lampposts, ${city.trees.length} trees, ${city.parkedCars.length} parked cars, ${city.addresses.length} addresses`);

for (let n = 0; n < shifts; n++) {
  const car = makeCityCar(city), sh = makeShift(city, 1 + n);
  let rt = null, rtT = 0, walls = 0, poles = 0, resets = 0, tick = 0;
  while (!sh.over) {
    stepShift(sh, city, car);
    for (const e of sh.events) {
      if (e.type === "delivered" && why) console.log(`  delivered ${e.item} to ${e.to}: $${e.earned.toFixed(2)} (tip ${e.tip.toFixed(2)}) ${"*".repeat(e.stars)} late ${e.late.toFixed(1)}s quality ${(e.quality * 100).toFixed(0)}%`);
    }
    const o = sh.order;
    if (!o) continue;
    const target = o.phase === "pickup" ? o.rest : o.cust;
    if (!rt || tick - rtT > 15) { rt = route(city, car.x, car.z, car.h, target, Math.max(0, car.u)); rtT = tick; }
    // pure pursuit along the polyline
    const s = Math.hypot(car.vx, car.vz), look = 6 + s * 0.5;
    let px = target.x, pz = target.z, acc = 0, found = false, turnAt = Infinity, turnAng = 0;
    const pts = rt.points;
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az) || 1e-6;
      const t = Math.max(0, Math.min(1, ((car.x - ax) * (bx - ax) + (car.z - az) * (bz - az)) / (L * L)));
      const d = Math.hypot(car.x - (ax + (bx - ax) * t), car.z - (az + (bz - az) * t));
      if (d < bestD) { bestD = d; bestI = i; }
    }
    for (let i = bestI; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
      const startD = i === bestI ? Math.hypot(car.x - ax, car.z - az) : 0;
      if (!found && acc + L - startD > look) {
        const f = (look - acc + startD) / L;
        px = ax + (bx - ax) * f; pz = az + (bz - az) * f; found = true;
      }
      acc += L - startD;
      if (i + 2 < pts.length && turnAt === Infinity) {
        const [cx, cz] = pts[i + 2];
        const a1 = Math.atan2(bx - ax, bz - az), a2 = Math.atan2(cx - bx, cz - bz);
        const ang = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
        if (ang > 0.3) { turnAt = acc - (i === bestI ? 0 : 0); turnAng = ang; }
      }
    }
    const remaining = acc;
    const ang = Math.atan2(px - car.x, pz - car.z);
    const err = Math.atan2(Math.sin(car.h - ang), Math.cos(car.h - ang));
    const steer = Math.max(-1, Math.min(1, err * 2.5));
    // speed: slow for turns (a 90 degree corner ~ 9 m/s) and for the stop at the end
    const careful = o.kind === "drink" && o.phase === "dropoff" ? 0.75 : 1;   // carrying drinks: gentler
    const vTurn = (turnAng > 0 ? 9 + (Math.PI - turnAng) * 3 : 40) * careful;
    const brakeG = 0.7 * P.brakeMax * 9.81 * careful;
    let vt = Math.min(40, Math.sqrt(vTurn * vTurn + 2 * brakeG * Math.max(0, turnAt - 4)), Math.sqrt(2 * brakeG * Math.max(0, remaining - 2)));
    if (o.inZone) vt = 0;
    const inp = {
      steer,
      throttle: Math.max(0, Math.min(1, (vt - s) / 3 + 0.2)) * (Math.abs(car.slipR) > 0.1 ? 0.4 : 1),
      brake: s > vt + 0.5 ? Math.min(1, (s - vt) / 4 + 0.2) : vt === 0 ? 1 : 0,
    };
    if (vt === 0 && s < 0.6) inp.brake = 0.3;   // don't hold it so long that reverse engages
    stepCityCar(car, inp, city);
    tick++;
    for (const e of car.events) {
      if (e.type === "wall") { walls++; if (why) console.log(`  wall ${e.speed.toFixed(1)} m/s at (${car.x.toFixed(0)}, ${car.z.toFixed(0)})`); }
      if (e.type === "pole") poles++;
      if (e.type === "reset") { resets++; if (why) console.log(`  reset at (${car.x.toFixed(0)}, ${car.z.toFixed(0)})`); }
    }
  }
  const lates = sh.log.filter((l) => l.late > 0).length;
  console.log(`shift ${n + 1}: ${sh.over}, ${sh.jobs} deliveries, $${sh.money.toFixed(2)}, rating ${rating(sh).toFixed(2)}, late ${lates}, walls ${walls}, poles ${poles}, resets ${resets}, condition ${(car.cond * 100).toFixed(0)}%`);
}
