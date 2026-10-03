// The district, low-poly and flat-shaded: one merged static mesh (streets, markings, sidewalks,
// buildings with floor bands, parks, lots, alleys, props), lampposts that can be knocked over,
// the GPS line, pickup/drop-off beacons, the car, and a chase camera tuned to sell speed.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildCar } from "../render.js";
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

function buildStatic(city) {
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
  for (const [x0, z0, x1, z1] of [[E0, E0, E1, E0 + 3], [E0, E1 - 3, E1, E1], [E0, E0, E0 + 3, E1], [E1 - 3, E0, E1, E1]]) P.push(flat(x0, z0, x1, z1, 0.03, C.sidewalk));
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
    for (let f = 0; f < bd.floors; f++) {
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

export function createCityRenderer(canvas, city) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.sky);
  scene.fog = new THREE.Fog(C.sky, 90, 330);
  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x5a5f55, 1.5));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
  sun.position.set(-60, 140, 90);
  scene.add(sun);
  scene.add(buildStatic(city));
  for (const r of city.restaurants) scene.add(signMesh(r));

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

  // the car, with a delivery box on the roof
  const car = buildCar(0x2fa6ff);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.75, 1.0), new THREE.MeshLambertMaterial({ color: 0xff7a1a, flatShading: true }));
  bag.position.set(0, 1.68, -0.4);
  car.userData.body.add(bag);
  scene.add(car);

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
  const pickBeacon = beacon(0xffa31a), dropBeacon = beacon(0x3dff7a);

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
    g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(ss.length * 3).fill(1), 3));
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
      const over = speed - allowed(plan, routeS[i]);
      if (over > 1) mix.copy(RED);
      else if (over > -4) mix.copy(YELLOW).lerp(RED, Math.max(0, (over + 4) / 5));
      else mix.copy(BLUE).lerp(YELLOW, Math.max(0, (over + 8) / 4));
      col.setXYZ(i, mix.r, mix.g, mix.b);
    }
    col.needsUpdate = true;
    void sCar;
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
      poles.setMatrixAt(city.poles.indexOf(p), m4);
      poles.instanceMatrix.needsUpdate = true;
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

    // beacons
    for (const [b, p] of [[pickBeacon, view.pickup], [dropBeacon, view.dropoff]]) {
      b.visible = !!p;
      if (!p) continue;
      b.position.set(p.x, 0, p.z);
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
    const want = 6.8 + pose.speed * 0.035;
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
    camera.position.set(tx + (Math.random() - 0.5) * sh, 3.3 + (Math.random() - 0.5) * sh, tz + (Math.random() - 0.5) * sh);
    camera.lookAt(pose.x + Math.sin(cam.yaw) * 12, 0.6, pose.z + Math.cos(cam.yaw) * 12);
    const fov = (camera.aspect < 1 ? 86 : 64) + Math.max(0, pose.speed - 8) * 0.42;
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  return { resize, frame, setRoute, colorRoute, snapCamera() { cam.init = false; }, camera, info: () => renderer.info.render };
}
