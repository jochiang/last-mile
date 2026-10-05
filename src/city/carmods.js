// What the mods look like on the car (user, 2026-10-04: "more immersive if they see what they're
// modding"). decorate() dresses a player car built from a model (models.js / render.js modelCar):
// it finds anchors on the model (glass, wheels, bag, the paint) and adds parts or changes the paint.
// Call it on a freshly built car (at the origin, unrotated). tickMods() spins the spinners.

import * as THREE from "three";

const lam = (hex, emissive = 0) => new THREE.MeshLambertMaterial({ color: hex, flatShading: true, emissive: new THREE.Color(hex).multiplyScalar(emissive) });
const CHROME = 0xe6ebf2, BAR = 0x2a2d33;

function anchors(g) {
  g.updateMatrixWorld(true);
  const body = g.userData.body;
  const out = { paint: [], glass: null, bag: null, hubs: [], full: new THREE.Box3() };
  body.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.material.name;
    if (n === "paint") out.paint.push(o);
    if (n === "glass" && (!out.glass || /glass|wind|cab/.test(o.name))) out.glass = o;
    if (n === "bag") out.bag = o;
    else out.full.expandByObject(o);
  });
  g.traverse((o) => { if (o.isMesh && o.material.name === "hub") out.hubs.push(o); });
  out.glassBox = out.glass ? new THREE.Box3().setFromObject(out.glass) : null;
  return out;
}

// stripes and a carbon bonnet are painted on in the shader, in the model's own coordinates
function paintShader(mesh, { stripe, carbon, hoodZ, stripeCol }) {
  const m = mesh.material;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uStripe: { value: stripe ? 1 : 0 }, uCarbon: { value: carbon ? 1 : 0 }, uHoodZ: { value: hoodZ }, uStripeCol: { value: new THREE.Color(stripeCol) } });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLoc;\nvarying vec3 vLocN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLoc = position;\nvLocN = normal;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLoc;\nvarying vec3 vLocN;\nuniform float uStripe;\nuniform float uCarbon;\nuniform float uHoodZ;\nuniform vec3 uStripeCol;\nfloat modMask = 0.0;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        // twin stripes over everything but the flanks; a black bonnet in front of the windscreen
        if (uStripe > 0.5 && abs(vLocN.x) < 0.6 && abs(abs(vLoc.x) - 0.17) < 0.07) { diffuseColor.rgb = uStripeCol; modMask = 1.0; }
        if (uCarbon > 0.5 && vLoc.z > uHoodZ && vLocN.y > 0.35) { diffuseColor.rgb = vec3(0.06, 0.06, 0.07); modMask = 1.0; }`)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 1.0 - modMask * 0.9;");
  };
  m.customProgramCacheKey = () => `paint-${stripe ? 1 : 0}${carbon ? 1 : 0}-${hoodZ.toFixed(2)}`;
  m.needsUpdate = true;
}

/** Dress a car for its mods. preview: one more mod shown as if bought (the shop's try-on). */
export function decorate(g, id, mods, preview = null) {
  if (!g.userData.model) return;
  const has = (k) => mods.includes(k) || preview === k;
  const a = anchors(g), body = g.userData.body, f = a.full;
  const extra = new THREE.Group(); extra.name = "mods";
  body.add(extra);
  g.userData.spinners = [];
  const front = f.max.z, rear = f.min.z;
  // paint: stripes, carbon bonnet (the bonnet is whatever's in front of the windscreen)
  const paintCol = a.paint[0]?.material.color.getHex() ?? 0xffffff;
  const stripeCol = (paintCol & 0xff) + ((paintCol >> 8) & 0xff) + ((paintCol >> 16) & 0xff) > 380 ? 0x15161a : 0xf4f4f0;
  const hoodZ = a.glassBox ? a.glassBox.max.z - 0.05 : front - 1.2;
  for (const p of a.paint) paintShader(p, { stripe: has("stripes"), carbon: has("light"), hoodZ, stripeCol });
  // coilovers: a lower stance
  body.position.y = has("coilovers") ? -0.06 : 0;
  // bull bar: posts and rails across the nose
  if (has("bullbar")) {
    const m = lam(BAR, 0.15), z = front + 0.14;
    for (const x of [-0.42, 0.42]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 6), m); post.position.set(x, 0.58, z); extra.add(post); }
    for (const y of [0.42, 0.86]) { const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.0, 6).rotateZ(Math.PI / 2), m); rail.position.set(0, y, z); extra.add(rail); }
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.2), m); brace.position.set(0, 0.32, front + 0.05); extra.add(brace);
  }
  // ECU remap: twin exhaust tips
  if (has("ecu")) for (const x of [-0.32, 0.32]) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.22, 8).rotateX(Math.PI / 2), lam(CHROME, 0.3));
    tip.position.set(x, 0.3, rear - 0.04); extra.add(tip);
  }
  // inside, hanging from the top of the windscreen: fuzzy dice, a pine tree, a dash cam
  if (a.glassBox) {
    const gb = a.glassBox, gz = gb.max.z - (gb.max.z - gb.min.z) * 0.22, gy = gb.max.y - 0.1;
    if (has("dice")) for (const [x, c] of [[-0.05, 0xff5fb8], [0.06, 0xf4f4f0]]) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), lam(c, 0.35)); d.position.set(x, gy - 0.2, gz); d.rotation.set(0.4, 0.6, 0.2); extra.add(d);
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.16, 0.008), lam(0x222222)); s.position.set(x, gy - 0.08, gz); extra.add(s);
    }
    if (has("freshener")) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 3), lam(0x2fae4a, 0.4)); t.position.set(0.22, gy - 0.18, gz); extra.add(t); }
    if (has("dashcam")) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.07), lam(0x111111)); c.position.set(-0.24, gy - 0.05, gz + 0.04); extra.add(c); }
  }
  // the bag: insulated is silver and a size up
  if (a.bag) {
    a.bag.material = a.bag.material.clone();
    a.bag.material.color.setHex(has("bag") ? 0xc9ced6 : 0xff7a1a);
    a.bag.material.emissive = a.bag.material.color.clone().multiplyScalar(0.18);
    a.bag.scale.setScalar(has("bag") ? 1.12 : 1);
  }
  // wheels: spinner rims, big red brake calipers, yellow-lettered sticky tyres
  for (const pivot of g.userData.wheels) {
    const side = Math.sign(pivot.position.x) || 1, spin = pivot.children[0];
    const r = new THREE.Box3().setFromObject(pivot).getSize(new THREE.Vector3()).y / 2;
    if (has("brakes")) { const cal = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.24), lam(0xe0242a, 0.35)); cal.position.set(side * 0.05, r * 0.32, -r * 0.3); pivot.add(cal); }
    if (has("tyres")) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.8, 0.022, 4, 18).rotateY(Math.PI / 2), lam(0xffd23a, 0.5)); ring.position.x = side * 0.145; spin.add(ring); }
    if (has("spinners")) {
      // three chrome blades that keep turning when the car stops
      const sp = new THREE.Group(); sp.position.x = side * 0.16;
      for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, r * 1.3, 0.07), lam(CHROME, 0.35)); b.rotation.x = (k * Math.PI) / 3; sp.add(b); }
      pivot.add(sp); g.userData.spinners.push(sp);
    }
  }
  for (const h of a.hubs) { h.material = h.material.clone(); h.userData.hex ??= h.material.color.getHex(); h.material.color.setHex(has("spinners") ? CHROME : h.userData.hex); }   // the car's own wheels (gold on the rally hatch) unless spinners
  g.userData.preview = preview;
}

export function tickMods(g, dt) {
  for (const sp of g.userData.spinners || []) sp.rotation.x += dt * 5;
}
