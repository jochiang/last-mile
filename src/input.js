// Steering schemes. Each turns raw input into { steer: -1..1, drift, brake }.
//   drag:  thumb down anywhere on the left; sideways distance from where it landed is the wheel
//          angle (position control, like a touchpad). Past full lock the anchor follows the thumb,
//          so reversing is instant.
//   stick: the usual floating stick (rate control), x axis only. The baseline to beat.
//   tilt:  turn the phone like a wheel. Needs HTTPS (a secure context) for the motion sensors.
// Keyboard works in every scheme: A/D or arrows, Space drift, S/Down brake.

export const MODES = ["drag", "tilt", "stick"];
export const SETTINGS_KEY = "tr.settings.v1";

export function loadSettings() {
  const def = { mode: "drag", dragRange: 70, tiltLock: 22, tiltInvert: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return def; }
}
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} }

const STICK_R = 60, STICK_DEAD = 0.12;

export function createInput(zone, buttons, settings) {
  const st = {
    steerPtr: null, ox: 0, oy: 0, x: 0, y: 0,    // the steering (or tilt-mode brake) thumb
    dragSteer: 0, stickSteer: 0,
    drift: new Set(), brake: new Set(),           // pointer ids holding each button
    keys: new Set(), keySteer: 0,
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
      const v = (st.x - st.ox) / settings.dragRange;
      touch = Math.abs(v) < 0.03 ? 0 : Math.max(-1, Math.min(1, v));
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
    return {
      steer,
      drift: st.drift.size > 0 || st.keys.has("Space"),
      brake: st.brake.size > 0 || st.keys.has("KeyS") || st.keys.has("ArrowDown"),
    };
  }

  return {
    read,
    enableTilt,
    recenter() { if (st.tiltRaw != null) st.tiltCenter = st.tiltRaw; },
    state: st,
    release() { st.steerPtr = null; st.drift.clear(); st.brake.clear(); st.keys.clear(); },
  };
}

const wrapDeg = (d) => ((d + 540) % 360) - 180;
