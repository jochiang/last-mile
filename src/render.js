// Low-poly, flat-shaded scene: the track as ribbons, the car, a ghost of the best lap,
// drift sparks, skid marks, and a chase camera.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ROAD, WALL, KERB } from "./track.js";

const COL = {
  sky: 0x8fd3ff, grass: 0x5fae4e, grass2: 0x55a046, road: 0x4a4d55, line: 0xf2f2f2,
  kerbA: 0xe8463c, kerbB: 0xf5f5f5, gravel: 0xd9c38a, wallA: 0x2f6fd6, wallB: 0xf5f5f5,
  body: 0xff7a1a, cabin: 0x22303f, wheel: 0x1c1d22, trunk: 0x7a5233, leaf: 0x2f8a45, leaf2: 0x3e9b4d,
};

const tmpC = new THREE.Color();
function colored(geo, hex) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  tmpC.setHex(hex);
  for (let i = 0; i < n; i++) { a[i * 3] = tmpC.r; a[i * 3 + 1] = tmpC.g; a[i * 3 + 2] = tmpC.b; }
  geo.setAttribute("color", new THREE.BufferAttribute(a, 3));
  if (geo.index) geo = geo.toNonIndexed();
  geo.deleteAttribute("uv");
  return geo;
}

/** A flat ribbon between lateral offsets a and b, at height y, coloured per segment by col(i). */
function ribbon(tr, a, b, y, col, keep = () => true) {
  const pos = [], cols = [];
  for (let i = 0; i < tr.N; i++) {
    const j = (i + 1) % tr.N;
    if (!keep(i)) continue;
    const p = (k, off) => [tr.x[k] + tr.nx[k] * off, y, tr.z[k] + tr.nz[k] * off];
    const A = p(i, a), B = p(i, b), C = p(j, b), D = p(j, a);
    pos.push(...A, ...B, ...D, ...B, ...C, ...D);   // counter-clockwise from above: faces up
    tmpC.setHex(col(i));
    for (let v = 0; v < 6; v++) cols.push(tmpC.r, tmpC.g, tmpC.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

/** A vertical wall along lateral offset off, from y0 to y1, facing the track. */
function wall(tr, off, y0, y1, col) {
  const pos = [], cols = [];
  for (let i = 0; i < tr.N; i++) {
    const j = (i + 1) % tr.N;
    const p = (k, y) => [tr.x[k] + tr.nx[k] * off, y, tr.z[k] + tr.nz[k] * off];
    const A = p(i, y0), B = p(i, y1), C = p(j, y1), D = p(j, y0);
    if (off > 0) pos.push(...A, ...B, ...D, ...D, ...B, ...C);
    else pos.push(...A, ...D, ...B, ...B, ...D, ...C);
    tmpC.setHex(col(i));
    for (let v = 0; v < 6; v++) cols.push(tmpC.r, tmpC.g, tmpC.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

function buildTrackMesh(tr) {
  const parts = [];
  const tight = (i, side) => tr.curv[i] * side < -1 / 70 || tr.curv[(i + 6) % tr.N] * side < -1 / 70 || tr.curv[(i - 6 + tr.N) % tr.N] * side < -1 / 70;
  const outer = (i, side) => tr.curv[i] * side > 1 / 45;
  // ground: two-tone mowing stripes
  const ground = new THREE.PlaneGeometry(900, 900, 30, 30).rotateX(-Math.PI / 2);
  const gp = ground.attributes.position, gc = [];
  const ng = ground.toNonIndexed();
  for (let t = 0; t < ng.attributes.position.count; t += 3) {
    const x = ng.attributes.position.getX(t);
    tmpC.setHex(Math.floor((x + 450) / 30) % 2 ? COL.grass : COL.grass2);
    for (let v = 0; v < 3; v++) gc.push(tmpC.r, tmpC.g, tmpC.b);
  }
  void gp;
  ng.setAttribute("color", new THREE.Float32BufferAttribute(gc, 3));
  ng.deleteAttribute("uv");
  ng.translate(0, -0.02, -60);
  parts.push(ng);
  parts.push(ribbon(tr, -ROAD, ROAD, 0.02, () => COL.road));
  // edge lines
  parts.push(ribbon(tr, -ROAD + 0.35, -ROAD + 0.6, 0.03, () => COL.line));
  parts.push(ribbon(tr, ROAD - 0.6, ROAD - 0.35, 0.03, () => COL.line));
  // kerbs on the inside of corners, red/white every 3 m; gravel traps on the outside of hard ones
  for (const side of [-1, 1]) {
    const a = side > 0 ? ROAD : -ROAD - KERB, b = side > 0 ? ROAD + KERB : -ROAD;
    parts.push(ribbon(tr, a, b, 0.04, (i) => (Math.floor(i / 3) % 2 ? COL.kerbA : COL.kerbB), (i) => tight(i, side)));
    const g0 = side > 0 ? ROAD + 0.2 : -WALL + 0.3, g1 = side > 0 ? WALL - 0.3 : -ROAD - 0.2;
    parts.push(ribbon(tr, g0, g1, 0.01, () => COL.gravel, (i) => outer(i, side)));
    // the barrier: a low wall of alternating ad boards
    parts.push(wall(tr, side * WALL, 0, 1.1, (i) => (Math.floor(i / 6) % 2 ? COL.wallA : COL.wallB)));
  }
  // start/finish checkers
  for (let r = 0; r < 2; r++) for (let k = 0; k < 14; k++) {
    const g = colored(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), (r + k) % 2 ? 0x111111 : 0xffffff);
    g.translate(-ROAD + 0.5 + k, 0.05, r - 1);
    g.rotateY(tr.heading[0]);
    g.translate(tr.x[0], 0, tr.z[0]);
    parts.push(g);
  }
  // gantry over the line
  for (const side of [-1, 1]) {
    const g = colored(new THREE.BoxGeometry(0.5, 6, 0.5), 0x333a44);
    g.translate(side * (ROAD + 1.5), 3, 0);
    g.rotateY(tr.heading[0]);
    g.translate(tr.x[0], 0, tr.z[0]);
    parts.push(g);
  }
  const beam = colored(new THREE.BoxGeometry(2 * ROAD + 3.5, 1.2, 0.4), 0xffcc22);
  beam.translate(0, 6, 0); beam.rotateY(tr.heading[0]); beam.translate(tr.x[0], 0, tr.z[0]);
  parts.push(beam);
  const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  return m;
}

function buildTrees(tr) {
  // scatter outside the barriers, away from every part of the track
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const spots = [];
  for (let k = 0; k < 600 && spots.length < 260; k++) {
    const x = -280 + rnd() * 560, z = -300 + rnd() * 470;
    let near = Infinity;
    for (let i = 0; i < tr.N; i += 4) near = Math.min(near, Math.hypot(x - tr.x[i], z - tr.z[i]));
    if (near < WALL + 5) continue;
    spots.push([x, z, 0.7 + rnd() * 0.8, rnd()]);
  }
  const parts = [];
  for (const [x, z, s, r] of spots) {
    const trunk = colored(new THREE.CylinderGeometry(0.25 * s, 0.35 * s, 2 * s, 5), COL.trunk).translate(x, s, z);
    const leaf = colored(new THREE.ConeGeometry(2.2 * s, 5 * s, 6), r > 0.5 ? COL.leaf : COL.leaf2).translate(x, 4 * s, z);
    parts.push(trunk, leaf);
  }
  return new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

export function buildCar(color, ghost = false) {
  const g = new THREE.Group();
  const mat = (hex) => ghost
    ? new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.32, depthWrite: false })
    : new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
  const body = new THREE.Group();
  g.add(body);
  const add = (geo, hex, x, y, z, parent = body) => { const m = new THREE.Mesh(geo, mat(hex)); m.position.set(x, y, z); parent.add(m); return m; };
  add(new THREE.BoxGeometry(1.9, 0.55, 4.2), color, 0, 0.55, 0);
  add(new THREE.BoxGeometry(1.5, 0.5, 1.9), COL.cabin, 0, 1.05, -0.3);
  add(new THREE.BoxGeometry(1.9, 0.12, 0.5), 0x222222, 0, 1.15, -2.0);   // spoiler
  add(new THREE.BoxGeometry(0.1, 0.35, 0.1), 0x222222, -0.7, 0.9, -1.95);
  add(new THREE.BoxGeometry(0.1, 0.35, 0.1), 0x222222, 0.7, 0.9, -1.95);
  add(new THREE.BoxGeometry(1.95, 0.18, 0.5), 0xffffff, 0, 0.7, 1.6);   // nose stripe
  const wheels = [];
  for (const [x, z] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.38, z);
    g.add(pivot);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.32, 8).rotateZ(Math.PI / 2), mat(COL.wheel));
    pivot.add(w);
    wheels.push(pivot);
  }
  if (!ghost) {
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.8).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
    shadow.position.y = 0.06;
    g.add(shadow);
  }
  g.userData = { body, wheels };
  return g;
}

const TIER_COL = [0xffe07a, 0x4fd6ff, 0xff9a2e, 0xd36bff];

export function createRenderer(canvas, tr) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COL.sky);
  scene.fog = new THREE.Fog(COL.sky, 160, 420);
  scene.add(new THREE.HemisphereLight(0xdff2ff, 0x4a6b3a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(80, 140, 50);
  scene.add(sun);
  scene.add(buildTrackMesh(tr), buildTrees(tr));

  const car = buildCar(COL.body);
  const ghost = buildCar(0xffffff, true);
  ghost.visible = false;
  scene.add(car, ghost);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 600);
  const cam = { x: 0, y: 0, z: 0, yaw: 0, fov: 70, shake: 0, init: false };

  // drift sparks / smoke: one Points cloud
  const MAXP = 400;
  const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3);
  const parts = Array.from({ length: MAXP }, () => ({ life: 0, x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0 }));
  let pNext = 0;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const dot = document.createElement("canvas"); dot.width = dot.height = 32;
  const dctx = dot.getContext("2d"), grd = dctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.5, "rgba(255,255,255,0.8)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  dctx.fillStyle = grd; dctx.fillRect(0, 0, 32, 32);
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.45, vertexColors: true, map: new THREE.CanvasTexture(dot), transparent: true, depthWrite: false }));
  points.frustumCulled = false;
  scene.add(points);
  function emit(x, y, z, vx, vy, vz, hex, life) {
    const p = parts[pNext]; pNext = (pNext + 1) % MAXP;
    Object.assign(p, { x, y, z, vx, vy, vz, life, max: life });
    tmpC.setHex(hex);
    pCol.set([tmpC.r, tmpC.g, tmpC.b], (pNext === 0 ? MAXP - 1 : pNext - 1) * 3);
  }

  // skid marks: a ring of small dark quads on the road
  const MAXS = 1600;
  const skid = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.32, 0.7).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.45, depthWrite: false }), MAXS);
  skid.frustumCulled = false;
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAXS; i++) skid.setMatrixAt(i, hide);
  let skidNext = 0;
  scene.add(skid);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
  }

  let roll = 0, pitch = 0, hop = 0, wheelSpin = 0;
  /** pose: interpolated car state {x, z, h, speed, steer, slip, drifting, tier, boost, off}; dt: frame time */
  function frame(pose, dt, ghostPose, events) {
    const { body, wheels } = car.userData;
    car.position.set(pose.x, 0, pose.z);
    car.rotation.y = pose.h;
    // body lean from the slide, a little hop when a drift starts
    for (const e of events) {
      if (e.type === "hop") hop = 0.28;
      if (e.type === "wall") cam.shake = Math.min(0.6, e.speed * 0.05);
      if (e.type === "boost") cam.fovKick = 10 + e.tier * 3;
    }
    hop = Math.max(0, hop - dt * 1.6);
    const hy = Math.sin((1 - hop / 0.28) * Math.PI) * (hop > 0 ? 0.35 : 0);
    roll += (Math.max(-0.14, Math.min(0.14, -pose.slip * 0.5 - pose.steer * pose.speed * 0.002)) - roll) * Math.min(1, dt * 8);
    body.rotation.z = roll;
    body.position.y = hy;
    pitch += ((pose.brake ? 0.04 : pose.boost ? -0.035 : 0) - pitch) * Math.min(1, dt * 6);
    body.rotation.x = pitch;
    wheelSpin += pose.speed * dt / 0.38;
    wheels.forEach((w, i) => { w.rotation.y = i < 2 ? -pose.steer * 0.45 : 0; w.children[0].rotation.x = wheelSpin; w.position.y = 0.38 + hy; });

    if (ghostPose) { ghost.visible = true; ghost.position.set(ghostPose.x, 0, ghostPose.z); ghost.rotation.y = ghostPose.h; }
    else ghost.visible = false;

    // particles: sparks off the rear wheels while drifting, dust on the grass
    const fx = Math.sin(pose.h), fz = Math.cos(pose.h), rx = -fz, rz = fx;
    const rearL = [pose.x - fx * 1.35 - rx * 0.95, pose.z - fz * 1.35 - rz * 0.95];
    const rearR = [pose.x - fx * 1.35 + rx * 0.95, pose.z - fz * 1.35 + rz * 0.95];
    if (pose.drifting) {
      const n = pose.tier ? 3 : 1;
      for (let k = 0; k < n; k++) for (const [x, z] of [rearL, rearR]) {
        if (pose.smoke) emit(x, 0.3, z, (Math.random() - 0.5) * 2 - fx * 2, 0.6 + Math.random(), (Math.random() - 0.5) * 2 - fz * 2, 0xe8e8e8, 0.5 + Math.random() * 0.3);
        else emit(x, 0.2, z, (Math.random() - 0.5) * 4 - fx * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 4 - fz * 3, TIER_COL[pose.tier], 0.3 + Math.random() * 0.2);
      }
    }
    if (pose.off && pose.speed > 5) for (const [x, z] of [rearL, rearR]) emit(x, 0.3, z, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, 0xb59a62, 0.6);
    if (pose.boost) emit(pose.x - fx * 2.2, 0.6, pose.z - fz * 2.2, -fx * 6 + (Math.random() - 0.5), 0.5, -fz * 6 + (Math.random() - 0.5), TIER_COL[Math.max(1, pose.boostTier)], 0.25);
    for (let i = 0; i < MAXP; i++) {
      const p = parts[i];
      if (p.life <= 0) { pPos[i * 3 + 1] = -99; continue; }
      p.life -= dt; p.vy -= 9 * dt;
      p.x += p.vx * dt; p.y = Math.max(0.05, p.y + p.vy * dt); p.z += p.vz * dt;
      pPos.set([p.x, p.y, p.z], i * 3);
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;

    // skid marks where the car slides
    if ((pose.drifting || Math.abs(pose.slip) > 0.12) && pose.speed > 6 && !pose.off) {
      q4.setFromAxisAngle(up, pose.h);
      for (const [x, z] of [rearL, rearR]) {
        m4.compose(v3.set(x, 0.035, z), q4, s3);
        skid.setMatrixAt(skidNext, m4);
        skidNext = (skidNext + 1) % MAXS;
      }
      skid.instanceMatrix.needsUpdate = true;
    }

    // chase camera: trails the heading with lag, so a drift shows the car's angle
    if (!cam.init) { cam.yaw = pose.h; cam.x = pose.x; cam.z = pose.z; cam.init = true; }
    let dy = pose.h - cam.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    cam.yaw += dy * Math.min(1, dt * 5);
    const back = 7.2 + pose.speed * 0.03, hgt = 2.7;
    const tx = pose.x - Math.sin(cam.yaw) * back, tz = pose.z - Math.cos(cam.yaw) * back;
    cam.x += (tx - cam.x) * Math.min(1, dt * 14); cam.z += (tz - cam.z) * Math.min(1, dt * 14);
    cam.shake = Math.max(0, cam.shake - dt * 2);
    const sh = cam.shake;
    camera.position.set(cam.x + (Math.random() - 0.5) * sh, hgt + (Math.random() - 0.5) * sh, cam.z + (Math.random() - 0.5) * sh);
    camera.lookAt(pose.x + Math.sin(cam.yaw) * 5, 1.1, pose.z + Math.cos(cam.yaw) * 5);
    cam.fovKick = Math.max(0, (cam.fovKick || 0) - dt * 14);
    const portrait = camera.aspect < 1;
    const fov = (portrait ? 88 : 62) + pose.speed * 0.22 + cam.fovKick;
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  function clearSkids() { for (let i = 0; i < MAXS; i++) skid.setMatrixAt(i, hide); skid.instanceMatrix.needsUpdate = true; }

  return { resize, frame, clearSkids, snapCamera() { cam.init = false; } };
}
