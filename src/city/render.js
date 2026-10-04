// The district, low-poly and flat-shaded: one merged static mesh (streets, markings, sidewalks,
// buildings with floor bands, parks, lots, alleys, props), lampposts that can be knocked over,
// the GPS line, pickup/drop-off beacons, the car, and a chase camera tuned to sell speed.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { X, NB, CURB, LINE, PITCH } from "./map.js";

const C = {
  sky: 0xbfe3ff, asphalt: 0x4b4e56, sidewalk: 0xb8b3a8, curb: 0xd8d4cb, dash: 0xf2d24b, white: 0xf4f4f4,
  lot: 0x5d6068, alley: 0x3f4248, grass: 0x6dbb55, path: 0xd8c08a, window: 0x34445a, roof: 0x6d6a66,
  dumpster: 0x2f7a4f, trunk: 0x7a5233, leaf: 0x3a9a4a, leaf2: 0x52ad55, water: 0x5ec8f0, stone: 0xc9c4b8,
  pole: 0x30343c, lamp: 0xfff2b0,
};

const tmpC = new THREE.Color();
function box(x0, y0, z0, x1, y1, z1, hex, top = hex) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).toNonIndexed();
  const n = g.attributes.position.count, col = new Float32Array(n * 3), nrm = g.attributes.normal;
  for (let v = 0; v < n; v++) {
    tmpC.setHex(nrm.getY(v) > 0.5 ? top : hex);
    col[v * 3] = tmpC.r; col[v * 3 + 1] = tmpC.g; col[v * 3 + 2] = tmpC.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.deleteAttribute("uv");
  return g;
}
const flat = (x0, z0, x1, z1, y, hex) => box(x0, y - 0.01, z0, x1, y, z1, hex);
function colored(g, hex) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  tmpC.setHex(hex);
  for (let v = 0; v < n; v++) { col[v * 3] = tmpC.r; col[v * 3 + 1] = tmpC.g; col[v * 3 + 2] = tmpC.b; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.deleteAttribute("uv");
  return g;
}

function buildStatic(city, night) {
  const P = [];
  const b = city.bounds;
  P.push(flat(b.x0, b.z0, b.x1, b.z1, 0, C.asphalt));
  // sidewalks: every non-park block gets a slab to the curb with a raised lip
  for (let r = 0; r < NB; r++) for (let c = 0; c < NB; c++) {
    const x0 = X(c) + CURB, x1 = X(c + 1) - CURB, z0 = X(r) + CURB, z1 = X(r + 1) - CURB;
    if (city.parks.some((p) => p.r === r && p.c === c)) continue;
    P.push(flat(x0, z0, x1, z1, 0.03, C.sidewalk));
    for (const [a0, b0, a1, b1] of [[x0, z0, x1, z0 + 0.3], [x0, z1 - 0.3, x1, z1], [x0, z0, x0 + 0.3, z1], [x1 - 0.3, z0, x1, z1]]) P.push(box(a0, 0, b0, a1, 0.14, b1, C.curb));
  }
  // the outer sidewalk in front of the edge buildings
  const E0 = city.inner.x0, E1 = city.inner.x1;
  const SW = LINE - CURB;
  for (const [x0, z0, x1, z1] of [[E0, E0, E1, E0 + SW], [E0, E1 - SW, E1, E1], [E0, E0, E0 + SW, E1], [E1 - SW, E0, E1, E1]]) P.push(flat(x0, z0, x1, z1, 0.03, C.sidewalk));
  for (const l of city.lots) {
    P.push(flat(l.x0, l.z0, l.x1, l.z1, 0.045, C.lot));
    for (const car of city.parkedCars) P.push(flat(car.x0 - 0.35, car.z0 - 0.2, car.x0 - 0.2, car.z1 + 0.2, 0.05, C.white));
  }
  for (const a of city.alleys) P.push(flat(a.x0, a.z0, a.x1, a.z1, 0.045, C.alley));
  // parks: grass, diagonal paths, the fountain
  for (const p of city.parks) {
    P.push(flat(p.x0, p.z0, p.x1, p.z1, 0.04, C.grass));
    const cx0 = X(p.c), cz0 = X(p.r);
    for (const [ax, az, bx, bz] of [[cx0, cz0, cx0 + PITCH, cz0 + PITCH], [cx0 + PITCH, cz0, cx0, cz0 + PITCH]]) {
      const len = Math.hypot(bx - ax, bz - az), g = new THREE.BoxGeometry(3, 0.01, len).rotateY(Math.atan2(bx - ax, bz - az)).translate((ax + bx) / 2, 0.05, (az + bz) / 2);
      P.push(colored(g, C.path));
    }
  }
  for (const r of city.removed) P.push(flat(r.x0, r.z0, r.x1, r.z1, 0.04, C.grass));
  for (const n of city.deadNodes) {
    P.push(colored(new THREE.CylinderGeometry(4.6, 4.8, 0.7, 14).translate(n.x, 0.35, n.z), C.stone));
    P.push(colored(new THREE.CylinderGeometry(4.0, 4.0, 0.1, 14).translate(n.x, 0.68, n.z), C.water));
    P.push(colored(new THREE.CylinderGeometry(0.6, 0.9, 2.6, 8).translate(n.x, 1.6, n.z), C.stone));
    P.push(colored(new THREE.CylinderGeometry(0.15, 0.15, 1.4, 6).translate(n.x, 3.4, n.z), C.water));
  }
  // lane markings: a dashed centre line, stop lines and crosswalks at every live intersection
  for (const e of city.edges) {
    const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len, h = Math.atan2(dx, dz);
    for (let s = LINE + 2; s < e.len - LINE - 2; s += 6) {
      P.push(colored(new THREE.BoxGeometry(0.18, 0.01, 3).rotateY(h).translate(e.ax + dx * (s + 1.5), 0.02, e.az + dz * (s + 1.5)), C.dash));
      // white lane lines either side: more stripes flicking past
      for (const w of [-CURB / 2, CURB / 2]) P.push(colored(new THREE.BoxGeometry(0.14, 0.01, 2).rotateY(h).translate(e.ax + dx * (s + 1) - dz * w, 0.02, e.az + dz * (s + 1) + dx * w), C.white));
    }
    for (const [s, sgn] of [[LINE + 0.5, 1], [e.len - LINE - 0.5, -1]]) {
      // zebra stripes across the road just outside the intersection
      for (let w = -CURB + 0.6; w < CURB - 0.4; w += 1.2) {
        P.push(colored(new THREE.BoxGeometry(0.6, 0.01, 2.4).rotateY(h).translate(e.ax + dx * (s - sgn * 0.2) - dz * w, 0.02, e.az + dz * (s - sgn * 0.2) + dx * w), C.white));
      }
    }
  }
  // buildings: walls, a darker band per floor (windows), a roof cap, sometimes roof clutter
  let seed = 11;
  const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const bd of city.buildings) {
    P.push(box(bd.x0, 0, bd.z0, bd.x1, bd.h, bd.z1, bd.color, C.roof));
    // by day, a darker band per floor; at night the windows are their own lit mesh (buildWindows)
    if (!night) for (let f = 0; f < bd.floors; f++) {
      const y = f * 3.2 + 1.0;
      P.push(box(bd.x0 - 0.06, y, bd.z0 - 0.06, bd.x1 + 0.06, y + 1.3, bd.z1 + 0.06, f === 0 ? 0x2a3442 : C.window));
    }
    P.push(box(bd.x0 - 0.15, bd.h, bd.z0 - 0.15, bd.x1 + 0.15, bd.h + 0.5, bd.z1 + 0.15, bd.color, C.roof));
    if (R() < 0.45) {
      const w = Math.min(bd.x1 - bd.x0, bd.z1 - bd.z0) * 0.3, cx = bd.x0 + (bd.x1 - bd.x0) * (0.3 + R() * 0.4), cz = bd.z0 + (bd.z1 - bd.z0) * (0.3 + R() * 0.4);
      P.push(box(cx - w / 2, bd.h, cz - w / 2, cx + w / 2, bd.h + 2 + R() * 3, cz + w / 2, 0x8d8a85));
    }
  }
  for (const car of city.parkedCars) {
    P.push(box(car.x0, 0.25, car.z0, car.x1, 0.95, car.z1, car.color));
    P.push(box(car.x0 + 0.15, 0.95, car.z0 + 1.0, car.x1 - 0.15, 1.45, car.z1 - 1.2, 0x2a3442));
  }
  for (const d of city.dumpsters) P.push(box(d.x0, 0, d.z0, d.x1, 1.4, d.z1, C.dumpster, 0x245e3d));
  for (const t of city.trees) {
    P.push(colored(new THREE.CylinderGeometry(0.22 * t.s, 0.3 * t.s, 2.2 * t.s, 6).translate(t.x, 1.1 * t.s, t.z), C.trunk));
    P.push(colored(new THREE.IcosahedronGeometry(1.9 * t.s, 0).translate(t.x, 3.2 * t.s, t.z), t.s > 1.1 ? C.leaf : C.leaf2));
  }
  // restaurant fronts: an awning in the brand colour
  for (const r of city.restaurants) {
    const [rr, cc] = r.block, mx = (X(cc) + X(cc + 1)) / 2, mz = (X(rr) + X(rr + 1)) / 2;
    const f = r.face, W = 8;
    if (f === "N") P.push(box(mx - W, 3.2, X(rr) + LINE - 2, mx + W, 3.5, X(rr) + LINE, r.color));
    if (f === "S") P.push(box(mx - W, 3.2, X(rr + 1) - LINE, mx + W, 3.5, X(rr + 1) - LINE + 2, r.color));
    if (f === "W") P.push(box(X(cc) + LINE - 2, 3.2, mz - W, X(cc) + LINE, 3.5, mz + W, r.color));
    if (f === "E") P.push(box(X(cc + 1) - LINE, 3.2, mz - W, X(cc + 1) - LINE + 2, 3.5, mz + W, r.color));
  }
  return new THREE.Mesh(mergeGeometries(P), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

// Night windows: every floor of every face cut into ~4.5 m panes, some lit warm or cool, the rest
// dark. Unlit material, so they glow without lights.
function buildWindows(city) {
  const pos = [], col = [];
  let seed = 23;
  const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const LIT = [0xffd27a, 0xffe6b0, 0xbfe0ff, 0xffb86b], DARK = 0x161c2a;
  const quad = (ax, az, bx, bz, y0, y1, hex) => {
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
    tmpC.setHex(hex);
    for (let k = 0; k < 6; k++) col.push(tmpC.r, tmpC.g, tmpC.b);
  };
  for (const bd of city.buildings) {
    const o = 0.07;
    // each face, walked so its front faces outward
    const faces = [[bd.x0, bd.z1 + o, bd.x1, bd.z1 + o], [bd.x1 + o, bd.z1, bd.x1 + o, bd.z0], [bd.x1, bd.z0 - o, bd.x0, bd.z0 - o], [bd.x0 - o, bd.z0, bd.x0 - o, bd.z1]];
    const busy = R();   // some buildings are mostly lit, some mostly dark
    for (let f = 0; f < bd.floors; f++) {
      const y0 = f * 3.2 + 1.0, y1 = y0 + 1.3;
      for (const [ax, az, bx, bz] of faces) {
        const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 4.5));
        for (let k = 0; k < n; k++) {
          const f0 = k / n + 0.06 / n, f1 = (k + 1) / n - 0.06 / n;
          const lit = R() < 0.18 + busy * 0.4 || (f === 0 && R() < 0.5);
          quad(ax + (bx - ax) * f0, az + (bz - az) * f0, ax + (bx - ax) * f1, az + (bz - az) * f1, y0, y1, lit ? LIT[Math.floor(R() * LIT.length)] : DARK);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }));
}

// a soft round glow for light pools, headlights and underglow
function glowTexture(stretch = false) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const g = cv.getContext("2d");
  const grd = stretch ? g.createLinearGradient(0, 128, 0, 0) : g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(stretch ? 1 : 0.45, stretch ? "rgba(255,255,255,0)" : "rgba(255,255,255,.45)"); if (!stretch) grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  if (stretch) {
    // fade the sides of the headlight beam too
    const side = g.createLinearGradient(0, 0, 128, 0);
    side.addColorStop(0, "rgba(0,0,0,1)"); side.addColorStop(0.3, "rgba(0,0,0,0)"); side.addColorStop(0.7, "rgba(0,0,0,0)"); side.addColorStop(1, "rgba(0,0,0,1)");
    g.globalCompositeOperation = "destination-out"; g.fillStyle = side; g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(cv);
}

function signMesh(r) {
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = 128;
  const g = cv.getContext("2d");
  g.fillStyle = "#" + r.color.toString(16).padStart(6, "0"); g.fillRect(0, 0, 512, 128);
  g.strokeStyle = "#fff"; g.lineWidth = 10; g.strokeRect(5, 5, 502, 118);
  g.fillStyle = "#fff"; g.font = "900 84px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(r.sign, 256, 68);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
  const [rr, cc] = r.block, mx = (X(cc) + X(cc + 1)) / 2, mz = (X(rr) + X(rr + 1)) / 2;
  const off = LINE - 0.1;
  if (r.face === "N") { m.position.set(mx, 5.4, X(rr) + off); m.rotation.y = Math.PI; }
  if (r.face === "S") { m.position.set(mx, 5.4, X(rr + 1) - off); }
  if (r.face === "W") { m.position.set(X(cc) + off, 5.4, mz); m.rotation.y = -Math.PI / 2; }
  if (r.face === "E") { m.position.set(X(cc + 1) - off, 5.4, mz); m.rotation.y = Math.PI / 2; }
  return m;
}

function chevronTexture() {
  const cv = document.createElement("canvas"); cv.width = 64; cv.height = 64;
  const g = cv.getContext("2d");
  g.fillStyle = "rgba(200,200,200,0.55)"; g.fillRect(0, 0, 64, 64);
  g.fillStyle = "rgba(255,255,255,0.95)";
  g.beginPath(); g.moveTo(10, 8); g.lineTo(32, 30); g.lineTo(54, 8); g.lineTo(54, 24); g.lineTo(32, 46); g.lineTo(10, 24); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// --- the three player cars, low-poly, facing +z. userData: body (leans), wheels (steer/spin), the size.
function buildPlayerCar(id) {
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const lam = (hex) => new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
  const add = (w, h, d, hex, x, y, z, rx = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(hex)); m.position.set(x, y, z); m.rotation.x = rx; body.add(m); return m; };
  const BLACK = 0x17181c, GLASS = 0x1e2a38;
  let len, wid, wr, wz, lampY, bag;
  if (id === "hauler") {
    len = 4.9; wid = 2.0; wr = 0.42; wz = 1.65; lampY = 0.85;
    const SILVER = 0xb9c3cc;
    add(2.0, 1.45, 4.3, SILVER, 0, 1.15, -0.3);            // the box
    add(2.0, 0.65, 0.75, SILVER, 0, 0.72, 2.07);            // a short nose
    add(2.0, 0.5, 0.9, GLASS, 0, 1.25, 1.6, -0.55);         // the steep windscreen
    add(2.03, 0.55, 3.5, GLASS, 0, 1.55, -0.55);            // the window band
    add(2.04, 0.05, 1.2, BLACK, 0, 1.0, 0.2);               // the sliding door's runner
    add(2.04, 0.25, 4.6, 0x30343a, 0, 0.45, -0.1);          // bumpers and cladding
    for (const x of [-0.75, 0.75]) add(0.08, 0.08, 3.2, BLACK, x, 1.93, -0.4);   // roof rails
    bag = [0, 2.2, -0.6];
  } else if (id === "roadster") {
    len = 3.9; wid = 1.72; wr = 0.36; wz = 1.2; lampY = 0.62;
    const RED = 0xd8262f;
    add(1.72, 0.48, 3.9, RED, 0, 0.55, 0);                  // the body
    add(1.5, 0.25, 1.3, BLACK, 0, 0.75, -0.35);             // the cockpit, open
    add(1.5, 0.42, 0.06, GLASS, 0, 1.0, 0.45, -0.45);       // the windscreen
    for (const x of [-0.4, 0.4]) add(0.08, 0.35, 0.08, BLACK, x, 0.98, -0.95);   // roll hoops
    // pop-up headlights: up (it's always night)
    for (const x of [-0.55, 0.55]) { add(0.42, 0.16, 0.34, RED, x, 0.88, 1.35); add(0.38, 0.13, 0.03, 0xfff6d8, x, 0.88, 1.53); }
    add(1.74, 0.16, 0.25, BLACK, 0, 0.36, 1.9);             // the grin
    bag = [0.38, 0.95, -0.35];                              // no roof: it rides in the passenger seat
  } else {
    // the liftback: white with a black glasshouse, roof and hatch
    len = 4.3; wid = 1.9; wr = 0.38; wz = 1.35; lampY = 0.66;
    const WHITE = 0xf1f1ee;
    add(1.9, 0.62, 4.3, WHITE, 0, 0.62, 0);                 // the body
    add(1.62, 0.5, 1.5, BLACK, 0, 1.17, 0.15);              // the glasshouse and roof
    add(1.62, 0.08, 1.75, BLACK, 0, 1.11, -1.3, -0.3);      // the hatch, sloping to the tail
    add(1.62, 0.4, 0.06, BLACK, 0, 1.1, 1.0, -0.6);         // the windscreen
    add(1.94, 0.22, 0.3, BLACK, 0, 0.38, 2.05);             // bumpers
    add(1.94, 0.22, 0.3, BLACK, 0, 0.38, -2.05);
    add(0.5, 0.02, 1.4, BLACK, 0, 0.94, 1.35);              // a bonnet stripe
    bag = [0, 1.8, -0.1];
  }
  const box = new THREE.Mesh(new THREE.BoxGeometry(id === "roadster" ? 0.7 : 1.1, id === "roadster" ? 0.55 : 0.75, id === "roadster" ? 0.7 : 1.0), lam(0xff7a1a));
  box.position.set(...bag); body.add(box);
  const wheels = [];
  for (const [x, z] of [[-wid / 2, wz], [wid / 2, wz], [-wid / 2, -wz], [wid / 2, -wz]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, wr, z); g.add(pivot);
    pivot.add(new THREE.Mesh(new THREE.CylinderGeometry(wr, wr, 0.3, 8).rotateZ(Math.PI / 2), lam(0x1c1d22)));
    wheels.push(pivot);
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(wid + 0.5, len + 0.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.position.y = 0.06; g.add(shadow);
  // the camera sits higher and further back behind the tall van, so the road ahead stays visible
  g.userData = { body, wheels, len, wid, lampY, camUp: id === "hauler" ? 1.0 : 0, camBack: id === "hauler" ? 1.2 : id === "roadster" ? -0.4 : 0 };
  return g;
}

export function createCityRenderer(canvas, city, { night = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  // night (user, 2026-10-03): the dark and the fog hide how small the district is, and glowing
  // things (underglow, neon, beacons, the GPS line) read best in the dark
  const SKY = night ? 0x0b1124 : C.sky;
  scene.background = new THREE.Color(SKY);
  scene.fog = night ? new THREE.Fog(SKY, 35, 230) : new THREE.Fog(SKY, 90, 330);
  scene.add(night ? new THREE.HemisphereLight(0x5a6aa0, 0x1a1c22, 0.75) : new THREE.HemisphereLight(0xeaf4ff, 0x5a5f55, 1.5));
  const sun = night ? new THREE.DirectionalLight(0x9fb0ff, 0.45) : new THREE.DirectionalLight(0xfff4e0, 1.7);
  sun.position.set(-60, 140, 90);
  scene.add(sun);
  scene.add(buildStatic(city, night));
  if (night) scene.add(buildWindows(city));
  for (const r of city.restaurants) scene.add(signMesh(r));
  const add = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false };

  // lampposts: one instanced mesh; knocked-over ones topple and stay down
  const poleGeo = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.1, 0.14, 5.5, 6).translate(0, 2.75, 0), C.pole),
    colored(new THREE.BoxGeometry(0.12, 0.12, 1.4).translate(0, 5.4, 0.6), C.pole),
    colored(new THREE.BoxGeometry(0.4, 0.18, 0.6).translate(0, 5.3, 1.25), C.lamp),
  ]);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), city.poles.length);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e3 = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  city.poles.forEach((p, i) => {
    // the arm reaches over the road: face the nearest street centreline
    const gx = Math.round((p.x - X(0)) / PITCH) * PITCH + X(0), gz = Math.round((p.z - X(0)) / PITCH) * PITCH + X(0);
    p.yaw = Math.abs(p.x - gx) < Math.abs(p.z - gz) ? (p.x > gx ? -Math.PI / 2 : Math.PI / 2) : (p.z > gz ? Math.PI : 0);
    p.fall = 0;
    m4.compose(v3.set(p.x, 0, p.z), q4.setFromEuler(e3.set(0, p.yaw, 0)), s3);
    poles.setMatrixAt(i, m4);
  });
  scene.add(poles);
  const falling = new Set();
  // at night: glowing lamp heads, and a pool of light on the road under each
  let heads = null, pools = null;
  if (night) {
    const headGeo = new THREE.BoxGeometry(0.42, 0.2, 0.62).translate(0, 5.2, 1.25);
    heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xfff0c0 }), city.poles.length);
    pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xa08048, ...add, polygonOffset: true, polygonOffsetFactor: -1 }), city.poles.length);
    city.poles.forEach((p, i) => {
      m4.compose(v3.set(p.x, 0, p.z), q4.setFromEuler(e3.set(0, p.yaw, 0)), s3);
      heads.setMatrixAt(i, m4);
      // the pool sits under the lamp's head, out over the road
      m4.compose(v3.set(p.x + Math.sin(p.yaw) * 1.6, 0.09, p.z + Math.cos(p.yaw) * 1.6), q4.identity(), s3);
      pools.setMatrixAt(i, m4);
    });
    pools.frustumCulled = heads.frustumCulled = false;
    scene.add(heads, pools);
  }
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  // the player's car: one of three models (cars.js), rebuilt when a run picks one
  let car = null, glow = null, glowHex = null;
  function setPlayerCar(id) {
    if (car) scene.remove(car);
    car = buildPlayerCar(id);
    const L = car.userData.len / 2;
    // lights: headlamps and tail lamps that glow, a beam on the road ahead at night, and underglow (a mod)
    for (const x of [-0.62, 0.62]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.15, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
      hl.position.set(x, car.userData.lampY, L + 0.02); car.userData.body.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.05), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
      tl.position.set(x, car.userData.lampY + 0.05, -L - 0.02); car.userData.body.add(tl);
    }
    if (night) {
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(9, 22).rotateX(-Math.PI / 2).translate(0, 0.1, 10.5 + L),
        new THREE.MeshBasicMaterial({ map: glowTexture(true), color: 0x8a8060, ...add }));
      car.add(beam);
    }
    glow = new THREE.Mesh(new THREE.PlaneGeometry(car.userData.wid * 2.9, car.userData.len * 1.9).rotateX(-Math.PI / 2).translate(0, 0.11, 0),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff2bd6, ...add }));
    glow.visible = !!glowHex; if (glowHex) glow.material.color.setHex(glowHex);
    car.add(glow);
    scene.add(car);
  }
  setPlayerCar("liftback");

  // beacons: a tall translucent column you can see over the buildings, and a ring on the road
  function beacon(hex) {
    const g = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 70, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    col.position.y = 35;
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.2, 6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.position.y = 0.07;
    const fill = new THREE.Mesh(new THREE.CircleGeometry(6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.18, depthWrite: false }));
    fill.position.y = 0.06;
    g.add(col, ring, fill);
    g.visible = false;
    g.userData = { col, ring, fill };
    scene.add(g);
    return g;
  }
  const pickBeacons = [beacon(0xffa31a), beacon(0xffa31a), beacon(0xffa31a)], dropBeacon = beacon(0x3dff7a);
  // a floating tag over each offer: what it is, what it pays, how far it goes
  const tags = pickBeacons.map((b) => {
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 96;
    // a constant size on screen, so it reads from across the district
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, fog: false, sizeAttenuation: false }));
    sp.scale.set(0.2, 0.075, 1); sp.position.y = 8; sp.renderOrder = 5;
    b.add(sp);
    return { cv, sp };
  });
  function setOffers(offers) {
    pickBeacons.forEach((b, i) => {
      const of = offers[i], t = tags[i];
      b.userData.surge = !!(of && of.surge);
      if (!of) return;
      const g = t.cv.getContext("2d");
      g.clearRect(0, 0, 256, 96);
      g.fillStyle = of.surge ? "rgba(120,20,95,.85)" : "rgba(16,21,28,.82)";
      g.beginPath(); g.roundRect(4, 4, 248, 88, 16); g.fill();
      g.fillStyle = "#fff"; g.font = "800 30px system-ui, sans-serif"; g.textAlign = "center";
      g.fillText(`${{ food: "🍕", drink: "🥤", cake: "🎂" }[of.kind]} $${of.est.toFixed(0)}${of.surge ? " SURGE" : ""}`, 128, 42);
      g.font = "600 22px system-ui, sans-serif"; g.fillStyle = "#cfe0ff";
      g.fillText(`${of.rest.sign} · ${Math.round(of.dist / 10) * 10} m`, 128, 76);
      t.sp.material.map.needsUpdate = true;
    });
  }

  // the GPS line
  const gpsMat = new THREE.MeshBasicMaterial({ map: chevronTexture(), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  const gps = new THREE.Mesh(new THREE.BufferGeometry(), gpsMat);
  gps.frustumCulled = false;
  scene.add(gps);
  // the line is cut into 2 m pieces with a distance per vertex, so it can be coloured by the speed plan
  let routeS = null, plan = null;
  function setRoute(points, speedPlan) {
    const pos = [], uv = [], ss = [], W = 0.75;
    let along = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const nx = -(bz - az) / L * W, nz = (bx - ax) / L * W, y = 0.08;
      const n = Math.max(1, Math.ceil(L / 2));
      for (let k = 0; k < n; k++) {
        const f0 = k / n, f1 = (k + 1) / n;
        const px = ax + (bx - ax) * f0, pz = az + (bz - az) * f0, qx = ax + (bx - ax) * f1, qz = az + (bz - az) * f1;
        const s0 = along + L * f0, s1 = along + L * f1, u0 = s0 / 2.2, u1 = s1 / 2.2;
        pos.push(px + nx, y, pz + nz, px - nx, y, pz - nz, qx + nx, y, qz + nz, qx + nx, y, qz + nz, px - nx, y, pz - nz, qx - nx, y, qz - nz);
        uv.push(0, -u0, 1, -u0, 0, -u1, 0, -u1, 1, -u0, 1, -u1);
        ss.push(s0, s0, s1, s1, s0, s1);
      }
      along += L;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    // rgba: the alpha hides the stretch under and behind the car (see colorRoute)
    g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(ss.length * 4).fill(0), 4));
    gps.geometry.dispose();
    gps.geometry = g;
    routeS = ss; plan = speedPlan;
  }
  // blue: keep going; yellow: ease off; red: you're too fast for what's ahead, brake by here
  const BLUE = new THREE.Color(0x28dcff), YELLOW = new THREE.Color(0xffd23a), RED = new THREE.Color(0xff3b30), mix = new THREE.Color();
  function colorRoute(speed, sCar, allowed) {
    if (!routeS || !plan) return;
    const col = gps.geometry.attributes.color;
    for (let i = 0; i < routeS.length; i++) {
      // start just past the front bumper and fade in over a few metres
      const vis = Math.max(0, Math.min(1, (routeS[i] - sCar - 2.6) / 3));
      const over = speed - allowed(plan, routeS[i]);
      if (over > 1) mix.copy(RED);
      else if (over > -4) mix.copy(YELLOW).lerp(RED, Math.max(0, (over + 4) / 5));
      else mix.copy(BLUE).lerp(YELLOW, Math.max(0, (over + 8) / 4));
      col.setXYZW(i, mix.r, mix.g, mix.b, vis);
    }
    col.needsUpdate = true;
  }

  // particles: tyre smoke, sparks off walls, lamppost debris
  const MAXP = 500, pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3);
  const parts = Array.from({ length: MAXP }, () => ({ life: 0 }));
  let pNext = 0;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const dot = document.createElement("canvas"); dot.width = dot.height = 32;
  const dctx = dot.getContext("2d"), grd = dctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.5, "rgba(255,255,255,.75)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  dctx.fillStyle = grd; dctx.fillRect(0, 0, 32, 32);
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.5, vertexColors: true, map: new THREE.CanvasTexture(dot), transparent: true, depthWrite: false }));
  points.frustumCulled = false;
  scene.add(points);
  function emit(x, y, z, vx, vy, vz, hex, life, grav = 9) {
    const i = pNext; pNext = (pNext + 1) % MAXP;
    Object.assign(parts[i], { x, y, z, vx, vy, vz, life, grav });
    tmpC.setHex(hex); pCol[i * 3] = tmpC.r; pCol[i * 3 + 1] = tmpC.g; pCol[i * 3 + 2] = tmpC.b;
  }

  // skid marks
  const MAXS = 1400;
  const skid = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.32, 0.7).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x15161a, transparent: true, opacity: 0.4, depthWrite: false }), MAXS);
  skid.frustumCulled = false;
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAXS; i++) skid.setMatrixAt(i, hide);
  let skidNext = 0;
  scene.add(skid);

  const camera = new THREE.PerspectiveCamera(66, 1, 0.3, 500);
  const cam = { x: 0, z: 0, yaw: 0, fov: 66, shake: 0, init: false, dist: 6.4 };
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
  }
  // camera collision: only buildings matter at this height
  function cameraFree(x, z) {
    let free = true;
    city.near(x, z, 0.6, (o) => {
      if (o.kind !== "building" || !free) return;
      if (x > o.x0 - 0.5 && x < o.x1 + 0.5 && z > o.z0 - 0.5 && z < o.z1 + 0.5) free = false;
    });
    return free;
  }

  let roll = 0, pitch = 0, wheelSpin = 0, t = 0;
  function frame(pose, dt, events, view) {
    t += dt;
    const { body, wheels } = car.userData;
    car.position.set(pose.x, 0, pose.z);
    car.rotation.y = pose.h;
    for (const e of events) {
      if (e.type === "wall") {
        cam.shake = Math.min(0.7, e.speed * 0.05);
        for (let k = 0; k < 14; k++) emit(pose.x + Math.sin(pose.h) * 2, 0.6, pose.z + Math.cos(pose.h) * 2, (Math.random() - 0.5) * 8, 2 + Math.random() * 4, (Math.random() - 0.5) * 8, 0xffd060, 0.35);
      }
      if (e.type === "pole") {
        falling.add(e.pole);
        cam.shake = Math.max(cam.shake, 0.25);
        for (let k = 0; k < 10; k++) emit(e.pole.x, 1 + Math.random() * 3, e.pole.z, (Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6, 0xfff2b0, 0.5);
      }
    }
    // body: lean with the slide and the felt g, nose dives under brakes and squats under power
    roll += (Math.max(-0.12, Math.min(0.12, pose.gLat * 0.07)) - roll) * Math.min(1, dt * 10);
    pitch += (Math.max(-0.07, Math.min(0.07, -pose.gLong * 0.045)) - pitch) * Math.min(1, dt * 8);
    body.rotation.z = roll; body.rotation.x = pitch;
    wheelSpin += (pose.u * dt) / 0.38;
    wheels.forEach((w, i) => { w.rotation.y = i < 2 ? pose.delta : 0; w.children[0].rotation.x = wheelSpin; });

    // toppling lampposts
    for (const p of falling) {
      p.fall = Math.min(Math.PI / 2 - 0.05, p.fall + dt * 4);
      const ax = new THREE.Vector3(p.fallZ, 0, -p.fallX).normalize();
      q4.setFromEuler(e3.set(0, p.yaw, 0)).premultiply(new THREE.Quaternion().setFromAxisAngle(ax, p.fall));
      m4.compose(v3.set(p.x, 0, p.z), q4, s3);
      const pi = city.poles.indexOf(p);
      poles.setMatrixAt(pi, m4);
      poles.instanceMatrix.needsUpdate = true;
      if (heads) {   // the lamp goes out
        heads.setMatrixAt(pi, zero); pools.setMatrixAt(pi, zero);
        heads.instanceMatrix.needsUpdate = pools.instanceMatrix.needsUpdate = true;
      }
      if (p.fall >= Math.PI / 2 - 0.05) falling.delete(p);
    }

    // particles
    const fx = Math.sin(pose.h), fz = Math.cos(pose.h), rx = -fz, rz = fx;
    const rear = [[pose.x - fx * 1.35 - rx * 0.95, pose.z - fz * 1.35 - rz * 0.95], [pose.x - fx * 1.35 + rx * 0.95, pose.z - fz * 1.35 + rz * 0.95]];
    if (pose.drifting) for (const [x, z] of rear) emit(x, 0.3, z, (Math.random() - 0.5) * 2 - fx * 2, 0.6 + Math.random(), (Math.random() - 0.5) * 2 - fz * 2, 0xe8e8e8, 0.6, -0.5);
    if (pose.off && pose.speed > 5) for (const [x, z] of rear) emit(x, 0.3, z, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, 0x7a9a4a, 0.5);
    if (pose.cond < 0.35 && Math.random() < 0.5) emit(pose.x + fx * 1.8, 1.0, pose.z + fz * 1.8, (Math.random() - 0.5), 1.5 + Math.random(), (Math.random() - 0.5), 0x555555, 1.2, -1);
    for (let i = 0; i < MAXP; i++) {
      const p = parts[i];
      if (p.life <= 0) { pPos[i * 3 + 1] = -99; continue; }
      p.life -= dt; p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y = Math.max(0.05, p.y + p.vy * dt); p.z += p.vz * dt;
      pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
    if ((pose.drifting || Math.abs(pose.slip) > 0.12) && pose.speed > 5 && !pose.off) {
      q4.setFromAxisAngle(up, pose.h);
      for (const [x, z] of rear) { m4.compose(v3.set(x, 0.06, z), q4, s3); skid.setMatrixAt(skidNext, m4); skidNext = (skidNext + 1) % MAXS; }
      skid.instanceMatrix.needsUpdate = true;
    }

    if (glow.visible) glow.material.opacity = 1;
    // beacons
    const pk = view.pickups || [];
    for (const [b, p] of [[pickBeacons[0], pk[0]], [pickBeacons[1], pk[1]], [pickBeacons[2], pk[2]], [dropBeacon, view.dropoff]]) {
      b.visible = !!p;
      if (!p) continue;
      b.position.set(p.x, 0, p.z);
      if (b !== dropBeacon) { const hex = b.userData.surge ? 0xff3bd0 : 0xffa31a; b.userData.col.material.color.setHex(hex); b.userData.ring.material.color.setHex(hex); b.userData.fill.material.color.setHex(hex); }
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      b.userData.ring.scale.setScalar(1 + pulse * 0.06);
      b.userData.fill.material.opacity = p.inZone ? 0.45 : 0.15 + pulse * 0.08;
      // the column fades as you get close, so it doesn't fill the screen
      const d = Math.hypot(p.x - pose.x, p.z - pose.z);
      b.userData.col.material.opacity = Math.min(0.28, Math.max(0.04, (d - 10) / 120));
    }
    gps.visible = !!view.route;
    gpsMat.map.offset.y = -t * 1.5;   // chevrons flow toward the destination

    // chase camera: low and close; trails the heading; pulls in when a building is in the way
    if (!cam.init) { cam.yaw = pose.h; cam.init = true; }
    let dy = pose.h - cam.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    cam.yaw += dy * Math.min(1, dt * (pose.reverse ? 2 : 6));
    const want = 6.8 + (car.userData.camBack || 0) + pose.speed * 0.035;
    let tx = pose.x - Math.sin(cam.yaw) * want, tz = pose.z - Math.cos(cam.yaw) * want;
    let k = 1;
    for (let s = 1; s >= 0.25; s -= 0.125) {
      const px = pose.x + (tx - pose.x) * s, pz = pose.z + (tz - pose.z) * s;
      if (cameraFree(px, pz)) { k = s; break; }
      k = s;
    }
    cam.dist += (want * k - cam.dist) * Math.min(1, dt * (k < 1 ? 20 : 4));
    tx = pose.x - Math.sin(cam.yaw) * cam.dist; tz = pose.z - Math.cos(cam.yaw) * cam.dist;
    cam.shake = Math.max(0, cam.shake - dt * 2);
    // a little road buzz that grows with speed
    const buzz = Math.max(0, pose.speed - 18) * 0.0018, sh = cam.shake + buzz;
    // high enough to see the road (and the GPS line) over the car, looking well up the street
    camera.position.set(tx + (Math.random() - 0.5) * sh, 3.3 + (car.userData.camUp || 0) + (Math.random() - 0.5) * sh, tz + (Math.random() - 0.5) * sh);
    camera.lookAt(pose.x + Math.sin(cam.yaw) * 12, 0.6, pose.z + Math.cos(cam.yaw) * 12);
    const fov = (camera.aspect < 1 ? 86 : 64) + Math.max(0, pose.speed - 8) * 0.42;
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    dayFrame(dt, t, pose.x, pose.z, Math.sin(pose.h) * pose.speed, Math.cos(pose.h) * pose.speed);
    renderer.render(scene, camera);
  }

  // --- traffic: instanced parts for every NPC car (bodies tinted per car), interpolated between ticks
  const MAXT = 48;
  const tparts = {};
  const inst = (name, geo, mat, perCar = 1) => {
    const m = new THREE.InstancedMesh(geo, mat, MAXT * perCar);
    m.count = 0; m.frustumCulled = false;
    if (mat.vertexColors === false) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXT * perCar * 3).fill(1), 3);
    scene.add(m); tparts[name] = m; return m;
  };
  const lam = () => new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  inst("carBody", new THREE.BoxGeometry(1.9, 0.62, 4.2).translate(0, 0.62, 0), lam());
  inst("carCabin", new THREE.BoxGeometry(1.5, 0.5, 2.0).translate(0, 1.18, -0.3), new THREE.MeshLambertMaterial({ color: 0x1e2733, flatShading: true }));
  inst("vanBody", new THREE.BoxGeometry(2.1, 1.85, 5.1).translate(0, 1.3, 0), lam());
  inst("chassis", new THREE.BoxGeometry(1.95, 0.42, 3.4).translate(0, 0.25, 0), new THREE.MeshLambertMaterial({ color: 0x15161a }));
  inst("head", new THREE.BoxGeometry(0.38, 0.15, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff3d0 }), 2);
  inst("tail", new THREE.BoxGeometry(0.38, 0.15, 0.06), new THREE.MeshBasicMaterial({ color: 0xffffff }), 2);
  const dummy = new THREE.Object3D(), part = new THREE.Matrix4(), cm = new THREE.Matrix4(), tcol = new THREE.Color();
  function drawTraffic(cars, alpha) {
    let nc = 0, nv = 0, nl = 0;
    for (const c of cars.slice(0, MAXT)) {
      const x = c.px + (c.x - c.px) * alpha, z = c.pz + (c.z - c.pz) * alpha;
      const h = c.ph + Math.atan2(Math.sin(c.h - c.ph), Math.cos(c.h - c.ph)) * alpha;
      dummy.position.set(x, 0, z); dummy.rotation.set(0, h, 0); dummy.updateMatrix();
      cm.copy(dummy.matrix);
      const van = c.kind === "van", L = van ? 2.56 : 2.11, ly = van ? 0.8 : 0.66;
      tcol.setHex(c.mode === "wreck" ? 0x3a3a3a : c.color);
      if (van) { tparts.vanBody.setMatrixAt(nv, cm); tparts.vanBody.setColorAt(nv, tcol); nv++; }
      else { tparts.carBody.setMatrixAt(nc, cm); tparts.carBody.setColorAt(nc, tcol); tparts.carCabin.setMatrixAt(nc, cm); nc++; }
      tparts.chassis.setMatrixAt(nc + nv - 1, cm);
      // lights: brake lights flare when they slow down
      const brake = c.mode !== "drive" || c.brake;
      for (const sx of [-0.62, 0.62]) {
        part.makeTranslation(sx, ly, L); tparts.head.setMatrixAt(nl, part.premultiply(cm));
        part.makeTranslation(sx, ly, -L); tparts.tail.setMatrixAt(nl, part.premultiply(cm));
        tparts.tail.setColorAt(nl, tcol.setHex(brake ? 0xff2020 : 0x7a0c0c));
        nl++;
      }
    }
    tparts.carBody.count = tparts.carCabin.count = nc; tparts.vanBody.count = nv; tparts.chassis.count = nc + nv;
    tparts.head.count = tparts.tail.count = nl;
    for (const m of Object.values(tparts)) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  function setUnderglow(hex) { glowHex = hex; glow.visible = !!hex; if (hex) glow.material.color.setHex(hex); }
  // --- the day's conditions: barricades, speed cameras, the surge zone, rain
  let dayGroup = null, rain = null, blinkers = [], camFlash = [];
  const stripe = (() => {
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 16;
    const g = cv.getContext("2d");
    for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? "#f4f4f4" : "#ff6a1a"; g.beginPath(); g.moveTo(k * 16 - 16, 16); g.lineTo(k * 16, 0); g.lineTo(k * 16 + 16, 0); g.lineTo(k * 16, 16); g.fill(); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = THREE.RepeatWrapping; return t;
  })();
  function setDay(plan, barricades) {
    if (dayGroup) { scene.remove(dayGroup); dayGroup.traverse((o) => { o.geometry?.dispose(); }); }
    dayGroup = new THREE.Group(); blinkers = []; camFlash = [];
    // barricades: striped boards on legs, blinking amber lamps, cones scattered behind
    for (const b of barricades) {
      const w = b.x1 - b.x0, d = b.z1 - b.z0, long = Math.max(w, d), alongX = w > d;
      const tex = stripe.clone(); tex.needsUpdate = true; tex.repeat.set(long / 2, 1);
      const board = new THREE.Mesh(new THREE.BoxGeometry(alongX ? long : 0.15, 0.6, alongX ? 0.15 : long), new THREE.MeshBasicMaterial({ map: tex, color: 0xb0b0b0 }));
      board.position.set((b.x0 + b.x1) / 2, 0.9, (b.z0 + b.z1) / 2);
      dayGroup.add(board);
      for (let k = 0; k < long; k += 3) {
        const lx = alongX ? b.x0 + k + 1 : (b.x0 + b.x1) / 2, lz = alongX ? (b.z0 + b.z1) / 2 : b.z0 + k + 1;
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), new THREE.MeshBasicMaterial({ color: 0xffb020 }));
        lamp.position.set(lx, 1.35, lz); dayGroup.add(lamp); blinkers.push({ m: lamp, phase: k * 0.37 });
      }
    }
    for (const e of plan.closed) {
      for (let k = 0; k < 6; k++) {
        const s = 18 + k * 4.5, x = e.ax + ((e.bx - e.ax) * s) / e.len, z = e.az + ((e.bz - e.az) * s) / e.len;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 8), new THREE.MeshBasicMaterial({ color: 0xff6a1a }));
        const off = (k % 2 ? 1 : -1) * 2.5;
        cone.position.set(x + (Math.abs(e.ax - e.bx) < 1 ? off : 0), 0.4, z + (Math.abs(e.ax - e.bx) < 1 ? 0 : off));
        dayGroup.add(cone);
      }
    }
    // speed cameras: a post, a yellow box, a "60" plate; they flash when they catch you
    for (const c of plan.cameras) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.2, 6), new THREE.MeshLambertMaterial({ color: 0x555a63 }));
      post.position.set(c.x, 1.6, c.z);
      const boxm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), new THREE.MeshBasicMaterial({ color: 0xffd23a }));
      boxm.position.set(c.x, 3.4, c.z);
      const cv = document.createElement("canvas"); cv.width = cv.height = 64;
      const g = cv.getContext("2d");
      g.fillStyle = "#fff"; g.beginPath(); g.arc(32, 32, 30, 0, 7); g.fill(); g.strokeStyle = "#e33"; g.lineWidth = 7; g.stroke();
      g.fillStyle = "#111"; g.font = "900 28px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("60", 32, 34);
      const plate = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv) }));
      plate.position.set(c.x, 2.4, c.z); plate.scale.set(0.9, 0.9, 1);
      const flash = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      flash.position.set(c.x, 3.4, c.z);
      dayGroup.add(post, boxm, plate, flash);
      camFlash.push({ c, flash, t: 0 });
    }
    // the surge zone: a pink glow on the ground and pink columns at its corners
    if (plan.surge) {
      const r = plan.surge;
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x24081d, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
      pad.position.set((r.x0 + r.x1) / 2, 0.1, (r.z0 + r.z1) / 2);
      dayGroup.add(pad);
      for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff3bd0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        col.position.set(x, 30, z);
        dayGroup.add(col);
      }
    }
    scene.add(dayGroup);
    // rain: streaks in a box that travels with the camera; the fog closes in
    if (rain) { scene.remove(rain); rain.geometry.dispose(); rain = null; }
    const wet = plan.conds.includes("rain");
    if (scene.fog) scene.fog.far = wet ? (night ? 170 : 240) : night ? 230 : 330;
    if (wet) {
      const N = 900, pos = new Float32Array(N * 6);
      for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 50, y = Math.random() * 18, z = (Math.random() - 0.5) * 50; pos.set([x, y, z, x, y - 0.7, z], i * 6); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9fb8d8, transparent: true, opacity: 0.45 }));
      rain.frustumCulled = false;
      scene.add(rain);
    }
  }
  function flashCamera(c) { const f = camFlash.find((q) => q.c === c); if (f) f.t = 0.35; }
  function dayFrame(dt, t, carX, carZ, vx, vz) {
    for (const b of blinkers) b.m.visible = Math.sin(t * 6 + b.phase) > 0;
    for (const f of camFlash) { f.t = Math.max(0, f.t - dt); f.flash.material.opacity = f.t * 2.4; f.flash.scale.setScalar(1 + (0.35 - f.t) * 4); }
    if (rain) {
      // fall, and stream past with the car's motion; wrap round a box centred on the car
      const a = rain.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i += 6) {
        let x = a[i] - vx * dt * 0.3, y = a[i + 1] - 22 * dt, z = a[i + 2] - vz * dt * 0.3;
        if (y < 0) y += 18;
        if (x - carX > 25) x -= 50; if (x - carX < -25) x += 50;
        if (z - carZ > 25) z -= 50; if (z - carZ < -25) z += 50;
        a[i] = x; a[i + 1] = y; a[i + 2] = z; a[i + 3] = x + vx * 0.02; a[i + 4] = y - 0.7; a[i + 5] = z + vz * 0.02;
      }
      rain.geometry.attributes.position.needsUpdate = true;
    }
  }
  // a new shift: lampposts back up, lights back on
  function resetPoles() {
    city.poles.forEach((p, i) => {
      p.broken = false; p.fall = 0;
      m4.compose(v3.set(p.x, 0, p.z), q4.setFromEuler(e3.set(0, p.yaw, 0)), s3);
      poles.setMatrixAt(i, m4);
      if (heads) { heads.setMatrixAt(i, m4); m4.compose(v3.set(p.x + Math.sin(p.yaw) * 1.6, 0.09, p.z + Math.cos(p.yaw) * 1.6), q4.identity(), s3); pools.setMatrixAt(i, m4); }
    });
    falling.clear();
    poles.instanceMatrix.needsUpdate = true;
    if (heads) heads.instanceMatrix.needsUpdate = pools.instanceMatrix.needsUpdate = true;
  }
  return { resize, frame, setRoute, colorRoute, setUnderglow, setPlayerCar, setOffers, resetPoles, setDay, flashCamera, drawTraffic, snapCamera() { cam.init = false; }, camera, info: () => renderer.info.render };
}
