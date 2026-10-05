// The Blender-built cars (art/cars.py → public/models/cars/*.glb), loaded once and adapted to the
// game: materials swapped for the game's (flat Lambert, shiny paint and glass; glowing lamps), wheels wrapped so they can
// steer and spin, and the traffic models merged into one geometry per material for instancing.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const IDS = ["liftback", "hauler", "roadster", "kei", "interceptor", "rally", "sedan", "van"];
const base = import.meta.env?.BASE_URL ?? "/";

export function loadCarModels() {
  const loader = new GLTFLoader();
  return Promise.all(IDS.map((id) => loader.loadAsync(`${base}models/cars/${id}.glb`).then((g) => [id, g.scene]).catch(() => [id, null])))
    .then((pairs) => Object.fromEntries(pairs.filter(([, s]) => s)));
}

const hexOf = (m) => (m.userData?.game_color ?? m.color?.getHex() ?? 0xffffff);
/** The game's material for a model material, by its name. tint: paint is white, tinted per instance. */
export function gameMaterial(m, { tint = false } = {}) {
  const name = m.name || "";
  let out;
  if (name === "lamp_head") out = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  else if (name === "lamp_tail") out = new THREE.MeshBasicMaterial({ color: tint ? 0xffffff : 0xff2a2a });
  // paint, glass and hubs are shiny (they reflect the night: scene.environment, render.js nightEnv)
  else if (name === "paint") out = new THREE.MeshStandardMaterial({ color: tint ? 0xffffff : hexOf(m), flatShading: true, metalness: 0.45, roughness: 0.3 });
  else if (name === "glass") out = new THREE.MeshStandardMaterial({ color: hexOf(m), flatShading: true, metalness: 0.7, roughness: 0.08 });
  else if (name === "hub") out = new THREE.MeshStandardMaterial({ color: hexOf(m), flatShading: true, metalness: 0.9, roughness: 0.25 });
  else out = new THREE.MeshLambertMaterial({ color: hexOf(m), flatShading: true });
  out.name = name;   // kept so mods can find the paint, the hubs, the bag
  return out;
}

/** A player car from a model: { group, body, wheels: [FL, FR, RL, RR] pivots, len, wid }. */
export function playerFromModel(scene) {
  const root = scene.clone(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = gameMaterial(o.material);
    // a little self-light, so your car keeps its colour at night (less on the paint, which the
    // headlights, streetlamps and reflections now light)
    if (!o.material.isMeshBasicMaterial) o.material.emissive = o.material.color.clone().multiplyScalar(o.material.name === "paint" ? 0.08 : 0.18);
  });
  const body = root.getObjectByName("body") || root;
  // wrap each wheel: pivot (steers, about y) > spinner (rolls, about x) > the wheel as modelled
  const wheels = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"].map((n) => {
    const w = root.getObjectByName(n);
    const pivot = new THREE.Group(), spin = new THREE.Group();
    pivot.position.copy(w.position);
    w.parent.add(pivot); pivot.add(spin);
    w.position.set(0, 0, 0); spin.add(w);
    return pivot;
  });
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
  return { group: root, body, wheels, len: size.z, wid: size.x };
}

/** A traffic model merged into one geometry per material: [{ name, geometry }]. */
export function partsFromModel(scene) {
  scene.updateMatrixWorld(true);
  const byMat = new Map();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    const name = o.material.name || "paint";
    if (!byMat.has(name)) byMat.set(name, { name, src: o.material, geos: [] });
    byMat.get(name).geos.push(g);
  });
  return [...byMat.values()].map((p) => ({ name: p.name, src: p.src, geometry: mergeGeometries(p.geos) }));
}
