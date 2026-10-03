// Track sanity: length, tightest corners, places where the barriers of two parts of the track
// would overlap. Writes a top-down SVG to the path given (optional).
// usage: node tools/trackcheck.mjs [out.svg]
import { writeFileSync } from "node:fs";
import { buildTrack, ROAD, WALL } from "../src/track.js";

const tr = buildTrack();
let minR = Infinity, minAt = 0;
for (let i = 0; i < tr.N; i++) if (1 / Math.abs(tr.curv[i]) < minR) { minR = 1 / Math.abs(tr.curv[i]); minAt = i; }
console.log(`length ${tr.length.toFixed(0)} m, ${tr.N} samples; tightest radius ${minR.toFixed(1)} m at sample ${minAt}`);
const clash = [];
for (let i = 0; i < tr.N; i += 2) for (let j = i + 2; j < tr.N; j += 2) {
  const arc = Math.min(j - i, tr.N - (j - i));
  if (arc < 60) continue;
  const d = Math.hypot(tr.x[i] - tr.x[j], tr.z[i] - tr.z[j]);
  if (d < 2 * WALL + 4) clash.push([i, j, d]);
}
console.log(clash.length ? `CLASH: ${clash.length} close pairs, e.g. ${clash.slice(0, 5).map(([i, j, d]) => `${i}/${j} ${d.toFixed(1)}m`).join(", ")}` : "no barrier clashes");
// corners: runs with radius under 60 m
let runs = [], cur = null;
for (let i = 0; i < tr.N; i++) {
  const tight = Math.abs(tr.curv[i]) > 1 / 60;
  if (tight && !cur) cur = { a: i, r: Infinity, dir: Math.sign(tr.curv[i]) };
  if (tight) cur.r = Math.min(cur.r, 1 / Math.abs(tr.curv[i]));
  if (!tight && cur) { cur.b = i; runs.push(cur); cur = null; }
}
console.log("corners (r<60):", runs.map((c) => `${c.a}-${c.b} ${c.dir > 0 ? "R" : "L"} r${c.r.toFixed(0)}`).join("  "));
if (process.argv[2]) {
  const pts = (off) => Array.from({ length: tr.N }, (_, i) => `${(tr.x[i] + tr.nx[i] * off).toFixed(1)},${(tr.z[i] + tr.nz[i] * off).toFixed(1)}`).join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-230 -240 460 360" width="920" height="720" style="background:#4a7"><polygon points="${pts(WALL)}" fill="none" stroke="#fff" stroke-width="1"/><polygon points="${pts(-WALL)}" fill="none" stroke="#fff" stroke-width="1"/><polyline points="${pts(0)}" fill="none" stroke="#333" stroke-width="${ROAD * 2}" stroke-linejoin="round"/>${clash.map(([i]) => `<circle cx="${tr.x[i]}" cy="${tr.z[i]}" r="4" fill="red"/>`).join("")}<circle cx="${tr.x[0]}" cy="${tr.z[0]}" r="5" fill="#ff0"/><circle cx="${tr.x[30]}" cy="${tr.z[30]}" r="3" fill="#0ff"/></svg>`;
  writeFileSync(process.argv[2], svg);
}
