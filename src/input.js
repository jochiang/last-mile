// Steering schemes. Each turns raw input into { steer: -1..1, drift, brake }.
//   drag:  thumb down anywhere on the left; sideways distance from where it landed is the wheel
//          angle (position control, like a touchpad). Past full lock the anchor follows the thumb,
//          so reversing is instant.
//   stick: the usual floating stick (rate control), x axis only. The baseline to beat.
//   tilt:  turn the phone like a wheel. Needs HTTPS (a secure context) for the motion sensors.
// Keyboard works in every scheme: A/D or arrows, Space drift, S/Down brake (W/Up gas with pedals).
//
// The pedals car (car2.js) swaps the DRIFT/BRAKE buttons for one pedal strip under the right thumb:
// gas at the top, brake at the bottom, and a band in the middle where both are on (left-foot braking).

export const MODES = ["drag", "tilt", "stick"];
export const SETTINGS_KEY = "tr.settings.v1";

export function loadSettings() {
  // pedalH: the strip's height in px. Short: the thumb rocks between gas and brake (user, 2026-10-03:
  // full-height swipes were "awful")
  // drag defaults borrow the stick's feel (user, 2026-10-02): 60 px throw, a resting zone in the middle
  // pedalMode "float" (default since 2026-10-03, the user's thumb cramped holding the fixed strip):
  // wherever the thumb lands on the right is full gas; sliding down from there eases off, then brakes
  const def = { model: "pedals", mode: "drag", dragRange: 60, dragDead: 0.1, dragCurve: 1.3, pedalH: 150, pedalMode: "float", tiltLock: 22, tiltInvert: false };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (saved.dragDead === undefined) delete saved.dragRange;   // settings from before the drag tuning
    return { ...def, ...saved };
  } catch { return def; }
}
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} }

/** Pedal strip position (0 = top, 1 = bottom) to [throttle, brake]. Gas is full in the top 10% and
 *  eases to half by 38%; 38-60% is the overlap (gas fading out, brake fading in to 30%); brake is
 *  full by 90%. */
export const PEDAL = { gasFull: 0.1, overlap: [0.38, 0.6], brakeFull: 0.9 };
export function pedalMap(p) {
  const [o0, o1] = PEDAL.overlap;
  const thr = p < PEDAL.gasFull ? 1 : p < o0 ? 1 - (0.5 * (p - PEDAL.gasFull)) / (o0 - PEDAL.gasFull) : Math.max(0, (0.5 * (o1 - p)) / (o1 - o0));
  const brk = p < o0 ? 0 : p < o1 ? (0.3 * (p - o0)) / (o1 - o0) : Math.min(1, 0.3 + (0.7 * (p - o1)) / (PEDAL.brakeFull - o1));
  return [thr, brk];
}

const STICK_R = 60, STICK_DEAD = 0.12;

export function createInput(zone, buttons, settings) {
  const st = {
    steerPtr: null, ox: 0, oy: 0, x: 0, y: 0,    // the steering (or tilt-mode brake) thumb
    dragSteer: 0, stickSteer: 0,
    drift: new Set(), brake: new Set(),           // pointer ids holding each button
    keys: new Set(), keySteer: 0, keyThr: 0, keyBrk: 0,
    pedPtr: null, ped: 0, pedTop: 0, pedH: 1,       // the pedal thumb, as a 0..1 position down the strip
    pedX: 0, pedFloat: false,                       // floating: where the strip was put down under the thumb
    tiltRaw: null, tiltCenter: 0, tiltOk: false,
  };

  // --- touch: the steering zone (left side)
  zone.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (settings.mode === "tilt") { st.brake.add(e.pointerId); zone.setPointerCapture(e.pointerId); return; }
    if (st.steerPtr !== null) return;
    st.steerPtr = e.pointerId; st.ox = st.x = e.clientX; st.oy = st.y = e.clientY;
    zone.setPointerCapture(e.pointerId);
  });
  // pointerrawupdate (HTTPS only) arrives as soon as the touch moves instead of once per frame
  const MOVE = "onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove";
  zone.addEventListener(MOVE, (e) => {
    if (e.pointerId !== st.steerPtr) return;
    st.x = e.clientX; st.y = e.clientY;
    if (settings.mode === "drag") {
      const R = settings.dragRange, dx = st.x - st.ox;
      if (Math.abs(dx) > R) st.ox = st.x - Math.sign(dx) * R;   // drag the anchor along past full lock
    }
  });
  const up = (e) => {
    st.brake.delete(e.pointerId);
    if (e.pointerId === st.steerPtr) st.steerPtr = null;
  };
  zone.addEventListener("pointerup", up);
  zone.addEventListener("pointercancel", up);

  // --- touch: drift and brake buttons (right side)
  for (const [el, set] of [[buttons.drift, st.drift], [buttons.brake, st.brake]]) {
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); set.add(e.pointerId); el.setPointerCapture(e.pointerId); el.classList.add("on"); });
    const off = (e) => { set.delete(e.pointerId); if (!set.size) el.classList.remove("on"); };
    el.addEventListener("pointerup", off);
    el.addEventListener("pointercancel", off);
  }

  // --- touch: the pedal strip. Absolute position, so the thumb learns where gas and brake are
  const pedal = buttons.pedal;
  const pedPos = (e) => Math.max(0, Math.min(1, (e.clientY - st.pedTop) / st.pedH));
  pedal.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (st.pedPtr !== null) return;
    const r = pedal.getBoundingClientRect();
    st.pedTop = r.top; st.pedH = r.height;
    st.pedPtr = e.pointerId; st.ped = pedPos(e);
    pedal.setPointerCapture(e.pointerId);
  });
  pedal.addEventListener(MOVE, (e) => { if (e.pointerId === st.pedPtr) st.ped = pedPos(e); });
  const pedUp = (e) => { if (e.pointerId === st.pedPtr) st.pedPtr = null; };
  pedal.addEventListener("pointerup", pedUp);
  pedal.addEventListener("pointercancel", pedUp);

  // --- touch: the floating pedal. The strip is laid under the thumb so that it lands at full gas;
  // sliding up past the top drags the strip along (so coming back down responds at once)
  const pz = buttons.pedzone;
  if (pz) {
    const LAND = 0.06;   // where on the strip the thumb lands: the top, full gas
    pz.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (st.pedPtr !== null || settings.pedalMode !== "float") return;
      st.pedH = settings.pedalH; st.pedTop = e.clientY - LAND * st.pedH; st.pedX = e.clientX;
      st.pedPtr = e.pointerId; st.ped = LAND; st.pedFloat = true;
      pz.setPointerCapture(e.pointerId);
    });
    pz.addEventListener(MOVE, (e) => {
      if (e.pointerId !== st.pedPtr) return;
      let p = (e.clientY - st.pedTop) / st.pedH;
      if (p < LAND) { st.pedTop = e.clientY - LAND * st.pedH; p = LAND; }
      st.ped = Math.min(1, p);
    });
    const pzUp = (e) => { if (e.pointerId === st.pedPtr) { st.pedPtr = null; st.pedFloat = false; } };
    pz.addEventListener("pointerup", pzUp);
    pz.addEventListener("pointercancel", pzUp);
  }

  // --- keyboard
  addEventListener("keydown", (e) => { st.keys.add(e.code); if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault(); });
  addEventListener("keyup", (e) => st.keys.delete(e.code));
  addEventListener("blur", () => st.keys.clear());

  // --- tilt: the phone's roll around the screen's normal, from the gravity direction
  function onOrient(e) {
    if (e.beta == null) return;
    const b = (e.beta * Math.PI) / 180, g = (e.gamma * Math.PI) / 180;
    // world "up" in device coordinates
    const ux = -Math.sin(g) * Math.cos(b), uy = Math.sin(b);
    // into screen coordinates (the screen may be rotated relative to the device)
    const a = (((screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180);
    const sx = ux * Math.cos(a) - uy * Math.sin(a), sy = ux * Math.sin(a) + uy * Math.cos(a);
    const ang = (Math.atan2(-sx, sy) * 180) / Math.PI;   // + = turned clockwise = steer right
    st.tiltRaw = st.tiltRaw == null ? ang : st.tiltRaw + wrapDeg(ang - st.tiltRaw) * 0.6;
    st.tiltOk = true;
  }
  async function enableTilt() {
    if (!window.isSecureContext) return "Tilt needs the HTTPS link (motion sensors are blocked on plain http).";
    try {
      if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== "granted") return "Motion permission was denied.";
      }
    } catch (err) { return "Couldn't get motion permission: " + err.message; }
    removeEventListener("deviceorientation", onOrient);
    addEventListener("deviceorientation", onOrient);
    return null;
  }

  function read(dt) {
    // keyboard: ramp the wheel in and out instead of slamming it
    const kl = st.keys.has("KeyA") || st.keys.has("ArrowLeft"), kr = st.keys.has("KeyD") || st.keys.has("ArrowRight");
    const kt = (kr ? 1 : 0) - (kl ? 1 : 0);
    const rate = kt === 0 ? 9 : Math.sign(kt) !== Math.sign(st.keySteer) ? 12 : 5;
    st.keySteer += Math.max(-rate * dt, Math.min(rate * dt, kt - st.keySteer));

    let touch = 0;
    if (settings.mode === "drag" && st.steerPtr !== null) {
      // a resting zone around where the thumb landed, then a curve: fine near centre, quick to full lock
      const v = Math.min(1, Math.abs(st.x - st.ox) / settings.dragRange), dz = settings.dragDead;
      touch = v <= dz ? 0 : Math.sign(st.x - st.ox) * Math.pow((v - dz) / (1 - dz), settings.dragCurve);
    } else if (settings.mode === "stick" && st.steerPtr !== null) {
      let dx = (st.x - st.ox) / STICK_R, dy = (st.y - st.oy) / STICK_R;
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      const ax = Math.abs(dx);
      touch = ax < STICK_DEAD ? 0 : Math.sign(dx) * (ax - STICK_DEAD) / (1 - STICK_DEAD);
    } else if (settings.mode === "tilt" && st.tiltRaw != null) {
      let deg = wrapDeg(st.tiltRaw - st.tiltCenter) * (settings.tiltInvert ? -1 : 1);
      deg = Math.abs(deg) < 1.2 ? 0 : deg - Math.sign(deg) * 1.2;
      touch = Math.max(-1, Math.min(1, deg / settings.tiltLock));
    }
    const steer = Math.abs(st.keySteer) > Math.abs(touch) ? st.keySteer : touch;
    const kBrk = st.keys.has("KeyS") || st.keys.has("ArrowDown");
    if (settings.model !== "pedals") {
      return { steer, drift: st.drift.size > 0 || st.keys.has("Space"), brake: st.brake.size > 0 || kBrk ? 1 : 0, throttle: 1 };
    }
    // keys squeeze the pedals in over a few frames
    const kThr = st.keys.has("KeyW") || st.keys.has("ArrowUp");
    st.keyThr += Math.max(-8 * dt, Math.min(5 * dt, (kThr ? 1 : 0) - st.keyThr));
    st.keyBrk += Math.max(-8 * dt, Math.min(6 * dt, (kBrk ? 1 : 0) - st.keyBrk));
    let [thr, brk] = st.pedPtr !== null ? pedalMap(st.ped) : [0, 0];
    if (settings.mode === "tilt" && st.brake.size) brk = 1;
    return { steer, drift: false, throttle: Math.max(thr, st.keyThr), brake: Math.max(brk, st.keyBrk) };
  }

  return {
    read,
    enableTilt,
    recenter() { if (st.tiltRaw != null) st.tiltCenter = st.tiltRaw; },
    state: st,
    release() { st.steerPtr = null; st.pedPtr = null; st.drift.clear(); st.brake.clear(); st.keys.clear(); },
  };
}

const wrapDeg = (d) => ((d + 540) % 360) - 180;
