// A top-down map of the city as SVG (streets, sidewalks, buildings, parks, lots, alleys, lawns,
// restaurants, traffic lights, street names). usage: node tools/mapsvg.mjs > map.svg
import { buildCity, CURB, LINE } from "../src/city/map.js";
import { pointAt } from "../src/city/edges.js";

const city = buildCity(), B = city.bounds, PAD = 10, S = 4;   // px per metre
const X = (x) => ((x - B.x0 + PAD) * S).toFixed(1), Z = (z) => ((z - B.z0 + PAD) * S).toFixed(1);
const W = (B.x1 - B.x0 + 2 * PAD) * S, H = (B.z1 - B.z0 + 2 * PAD) * S;
const hex = (c) => "#" + c.toString(16).padStart(6, "0");
const poly = (pts, fill, extra = "") => `<polygon points="${pts.map(([x, z]) => `${X(x)},${Z(z)}`).join(" ")}" fill="${fill}" ${extra}/>`;
const rect = (o, fill, extra = "") => `<rect x="${X(o.x0)}" y="${Z(o.z0)}" width="${((o.x1 - o.x0) * S).toFixed(1)}" height="${((o.z1 - o.z0) * S).toFixed(1)}" fill="${fill}" ${extra}/>`;
const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">`, `<rect width="${W}" height="${H}" fill="#2b2e35"/>`];
// lawns, then streets
for (const l of city.lawns) {
  const pts = [l.K];
  for (let k = 0; k <= 24; k++) { const th = l.th0 + ((l.th1 - l.th0) * k) / 24; pts.push([l.cx + (64) * Math.cos(th), l.cz + 64 * Math.sin(th)]); }
  out.push(poly(pts, "#5f9e4c"));
}
const pl = (e) => e.pts.map(([x, z]) => `${X(x)},${Z(z)}`).join(" ");
for (const e of city.edges) out.push(`<polyline points="${pl(e)}" fill="none" stroke="#9a9794" stroke-width="${2 * LINE * S}" stroke-linejoin="round"/>`);   // sidewalk band
for (const e of city.edges) out.push(`<polyline points="${pl(e)}" fill="none" stroke="#4b4e56" stroke-width="${2 * CURB * S}" stroke-linejoin="round" stroke-linecap="square"/>`);
for (const q of city.walks) out.push(poly(q, "#9a9794"));
for (const e of city.edges) out.push(`<polyline points="${pl(e)}" fill="none" stroke="#4b4e56" stroke-width="${2 * CURB * S}" stroke-linejoin="round"/>`);
for (const e of city.edges) out.push(`<polyline points="${pl(e)}" fill="none" stroke="#e8c84a" stroke-width="1.5" stroke-dasharray="10 14"/>`);
// parks, lots, alleys
for (const p of [...city.parks, ...city.removed]) out.push(rect(p, "#6dbb55"));
for (const n of city.deadNodes) out.push(`<circle cx="${X(n.x)}" cy="${Z(n.z)}" r="${4.6 * S}" fill="#5ec8f0" stroke="#c9c4b8" stroke-width="4"/>`);
for (const p of city.lots) out.push(rect(p, "#5d6068"));
for (const c of city.parkedCars) out.push(rect(c, "#8a8f99"));
for (const a of city.alleys) out.push(rect(a, "#3f4248"));
for (const d of city.dumpsters) out.push(rect(d, "#2f7a4f"));
// buildings: height as brightness
for (const b of city.buildings) {
  const k = 0.55 + 0.45 * Math.min(1, b.h / 42), c = b.color, f = (s) => Math.round(((c >> s) & 255) * k);
  const fill = `rgb(${f(16)},${f(8)},${f(0)})`;
  out.push(b.poly ? poly(b.poly, fill, 'stroke="#1c1e23" stroke-width="2"') : rect(b, fill, 'stroke="#1c1e23" stroke-width="2"'));
}
for (const t of city.trees) out.push(`<circle cx="${X(t.x)}" cy="${Z(t.z)}" r="${2.2 * t.s * S}" fill="#3a8a44"/>`);
// traffic lights
for (const s of city.signals) out.push(`<circle cx="${X(s.x)}" cy="${Z(s.z)}" r="7" fill="#ff4a3a" stroke="#111" stroke-width="2"/>`);
// street names: once per street, at the middle of its longest piece
const named = new Map();
for (const e of city.edges) if (!named.has(e.name) || e.len > named.get(e.name).len) named.set(e.name, e);
for (const [name, e] of named) {
  const q = pointAt(e, e.len / 2);
  let ang = (Math.atan2(q.dz, q.dx) * 180) / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
  out.push(`<text x="${X(q.x)}" y="${Z(q.z)}" transform="rotate(${ang.toFixed(0)} ${X(q.x)} ${Z(q.z)})" text-anchor="middle" dominant-baseline="middle" font-size="26" font-weight="700" fill="#fff" stroke="#2b2e35" stroke-width="5" paint-order="stroke">${name}</text>`);
}
// restaurants
for (const r of city.restaurants) {
  out.push(`<circle cx="${X(r.x)}" cy="${Z(r.z)}" r="20" fill="${hex(r.color)}" stroke="#fff" stroke-width="5"/>`);
  out.push(`<text x="${X(r.x)}" y="${(+Z(r.z) - 30).toFixed(0)}" text-anchor="middle" font-size="30" font-weight="900" fill="${hex(r.color)}" stroke="#111" stroke-width="6" paint-order="stroke">${r.sign}</text>`);
}
// north
out.push(`<g transform="translate(${W - 90},90)"><polygon points="0,-50 18,10 0,0 -18,10" fill="#fff"/><text y="45" text-anchor="middle" font-size="34" font-weight="800" fill="#fff">N</text></g>`);
out.push("</svg>");
console.log(out.join("\n"));
