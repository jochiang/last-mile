// City sanity: nothing solid on a carriageway, every address and restaurant reachable from every
// other, lampposts off the road. usage: node tools/citycheck.mjs
import { buildCity, CURB } from "../src/city/map.js";
import { pointAt } from "../src/city/edges.js";
import { placeDistance, route } from "../src/city/gps.js";

const city = buildCity();
let bad = 0;
const hit = (x, z, r) => {
  let o2 = null;
  city.near(x, z, r, (o) => {
    if (o.kind === "pole") return;
    if (o.r !== undefined ? Math.hypot(o.x - x, o.z - z) < o.r + r : x > o.x0 - r && x < o.x1 + r && z > o.z0 - r && z < o.z1 + r) o2 = o;
  });
  return o2;
};
for (const e of city.edges) {
  for (let s = 0; s <= e.len; s += 1) {
    const q = pointAt(e, s);
    for (let w = -CURB + 1; w <= CURB - 1; w += 1) {
      const o = hit(q.x - q.dz * w, q.z + q.dx * w, 0.3);
      if (o) { bad++; if (bad < 12) console.log(`solid on ${e.name} (edge ${e.id}) s=${s.toFixed(0)} w=${w}: ${o.kind} at ${(o.x ?? o.x0).toFixed(1)},${(o.z ?? o.z0).toFixed(1)}`); }
    }
  }
}
console.log(`colliders on carriageways: ${bad}`);
const poleBad = city.poles.filter((p) => city.edges.some((e) => { const { project } = { project: null }; return false; }));
// lampposts inside any carriageway
import("../src/city/edges.js").then(({ project }) => {
  const inRoad = city.poles.filter((p) => city.edges.some((e) => project(e, p.x, p.z).d < CURB - 0.3));
  console.log(`lampposts in a carriageway: ${inRoad.length}`, inRoad.slice(0, 5).map((p) => `${p.x.toFixed(0)},${p.z.toFixed(0)}`).join(" "));
  // reachability: every restaurant to every address
  let worst = 0, inf = 0;
  for (const r of city.restaurants) for (const a of city.addresses) { const d = placeDistance(city, r, a); if (!isFinite(d)) inf++; worst = Math.max(worst, d); }
  console.log(`unreachable pairs: ${inf}, longest trip ${worst.toFixed(0)} m`);
  const lens = city.addresses.map((a) => placeDistance(city, city.restaurants[0], a)).sort((a, b) => a - b);
  console.log(`pizza → addresses p10/p50/p90: ${lens[Math.floor(lens.length * 0.1)].toFixed(0)}/${lens[Math.floor(lens.length * 0.5)].toFixed(0)}/${lens[Math.floor(lens.length * 0.9)].toFixed(0)} m`);
});
