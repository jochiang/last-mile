// The Blender-built cars (art/cars.py → public/models/cars/*.glb), loaded once and adapted to the
// game: materials swapped for the game's (flat Lambert; glowing lamps), wheels wrapped so they can
// steer and spin, and the traffic models merged into one geometry per material for instancing.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const IDS = ["liftback", "hauler", "roadster", "sedan", "van"];
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
  if (name === "lamp_head") return new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  if (name === "lamp_tail") return new THREE.MeshBasicMaterial({ color: tint ? 0xffffff : 0xff2a2a });
  return new THREE.MeshLambertMaterial({ color: tint && name === "paint" ? 0xffffff : hexOf(m), flatShading: true });
}

/** A player car from a model: { group, body, wheels: [FL, FR, RL, RR] pivots, len, wid }. */
export function playerFromModel(scene) {
  const root = scene.clone(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = gameMaterial(o.material);
    // a little self-light on the paint, so your car keeps its colour at night
    if (o.material.isMeshLambertMaterial) o.material.emissive = o.material.color.clone().multiplyScalar(0.18);
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
