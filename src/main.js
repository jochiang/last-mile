import { buildTrack } from "./track.js";
import { makeCar, stepCar, resetCar, makeTimer, stepTimer, DT } from "./car.js";
import { createInput, loadSettings, saveSettings, MODES } from "./input.js";
import { createRenderer } from "./render.js";

const $ = (id) => document.getElementById(id);
const tr = buildTrack();
const settings = loadSettings();
const input = createInput($("zone"), { drift: $("drift"), brake: $("brake") }, settings);
const view = createRenderer($("c"), tr);

const LAPS_KEY = "tr.laps.v1";
let history = [];
try { history = JSON.parse(localStorage.getItem(LAPS_KEY) || "[]"); } catch {}
const saveHistory = () => { try { localStorage.setItem(LAPS_KEY, JSON.stringify(history.slice(-200))); } catch {} };

let car, timer, rec, ghost, prevSteer = 0, inp = { steer: 0, drift: false, brake: false };
let prev = null, running = false, acc = 0, last = performance.now(), toastT = 0;
const events = [];

function newRun() {
  car = makeCar(tr); timer = makeTimer(); rec = []; prevSteer = 0;
  ghost = bestGhost[settings.mode] || null;
  prev = snap(car);
  view.clearSkids(); view.snapCamera();
}
const bestGhost = {};   // per mode, this session: the best lap's recorded path

function snap(c) {
  return { x: c.x, z: c.z, h: c.h, speed: Math.hypot(c.vx, c.vz) };
}
const lerpAng = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

function tick() {
  prev = snap(car);
  inp = input.read(DT);
  stepCar(car, inp, tr);
  rec.push(car.x, car.z, car.h);
  const lap = stepTimer(timer, car, tr, prevSteer, inp.steer);
  prevSteer = inp.steer;
  for (const e of car.events) events.push(e);
  if (lap) onLap(lap);
}

function onLap(lap) {
  const mode = settings.mode;
  const prevBest = bestFor(mode);
  const entry = { mode, time: lap.time, off: lap.off, walls: lap.walls, jerk: lap.jerk, at: Date.now() };
  history.push(entry); saveHistory();
  const lapRec = rec; rec = [];
  if (prevBest == null || lap.time < prevBest) bestGhost[mode] = lapRec;
  ghost = bestGhost[mode];
  const d = prevBest == null ? null : lap.time - prevBest;
  toast(prevBest == null || d < 0 ? `${fmt(lap.time)}${d != null ? `  ${d.toFixed(2)}` : ""}` : `${fmt(lap.time)}  +${d.toFixed(2)}`);
  $("delta").textContent = d == null ? "" : (d < 0 ? "" : "+") + d.toFixed(2);
  $("delta").className = d == null ? "" : d < 0 ? "good" : "bad";
}

const bestFor = (mode) => history.filter((l) => l.mode === mode).reduce((b, l) => (b == null || l.time < b ? l.time : b), null);
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
function toast(s) { $("toast").textContent = s; $("toast").classList.add("show"); toastT = 1.6; }

const TIER_CSS = ["#ffe07a", "#4fd6ff", "#ff9a2e", "#d36bff"];
function hud(c) {
  const t = (timer.tick - timer.lapStart) / 60;
  $("now").textContent = fmt(t);
  $("last").textContent = "last " + (timer.last ? fmt(timer.last.time) : "–");
  const b = bestFor(settings.mode);
  $("best").textContent = "best " + (b == null ? "–" : fmt(b));
  $("lapn").textContent = `LAP ${timer.laps.length + 1}`;
  $("steerbar").querySelector("i").style.left = `${50 + inp.steer * 50}%`;
  $("kmh").firstChild.textContent = `${Math.round(Math.hypot(c.vx, c.vz) * 3.6)} `;
  const span = $("charge").firstElementChild;
  span.style.width = c.drifting ? `${Math.min(1, c.charge / 2.6) * 100}%` : c.boost > 0 ? "100%" : "0%";
  span.style.background = c.boost > 0 ? TIER_CSS[1] : TIER_CSS[c.tier];
  $("boostfx").style.opacity = c.boost > 0 ? Math.min(1, c.boost * 2) : 0;
}

// the thumb indicator: a stick ring, or a rail showing the drag range
function knob() {
  const st = input.state, k = $("knob");
  if (st.steerPtr === null || settings.mode === "tilt") { k.style.display = "none"; return; }
  k.style.display = "block";
  const ring = k.querySelector(".ring"), dot = k.querySelector(".dot"), rail = k.querySelector(".rail");
  if (settings.mode === "stick") {
    k.style.left = st.ox + "px"; k.style.top = st.oy + "px";
    Object.assign(ring.style, { display: "block", width: "120px", height: "120px", left: "-60px", top: "-60px" });
    rail.style.display = "none";
    let dx = st.x - st.ox, dy = st.y - st.oy; const m = Math.hypot(dx, dy);
    if (m > 60) { dx *= 60 / m; dy *= 60 / m; }
    dot.style.left = dx + "px"; dot.style.top = dy + "px";
  } else {
    const R = settings.dragRange;
    k.style.left = st.ox + "px"; k.style.top = st.y + "px";
    ring.style.display = "none";
    Object.assign(rail.style, { display: "block", width: 2 * R + "px", left: -R + "px" });
    dot.style.left = Math.max(-R, Math.min(R, st.x - st.ox)) + "px"; dot.style.top = "0px";
  }
}

function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running) {
    acc += dt;
    while (acc >= DT) { tick(); acc -= DT; }
  }
  const a = running ? acc / DT : 1, cur = snap(car);
  const pose = {
    x: prev.x + (cur.x - prev.x) * a, z: prev.z + (cur.z - prev.z) * a, h: lerpAng(prev.h, cur.h, a),
    speed: cur.speed, steer: inp.steer, slip: car.slip || 0, drifting: car.drifting, tier: car.tier,
    boost: car.boost > 0, boostTier: 1, off: car.off, brake: inp.brake,
  };
  let gp = null;
  if (ghost && running) {
    const k = Math.min(timer.tick - timer.lapStart, ghost.length / 3 - 1) * 3;
    if (k >= 0) gp = { x: ghost[k], z: ghost[k + 1], h: ghost[k + 2] };
  }
  view.frame(pose, dt, gp, events);
  events.length = 0;
  hud(car);
  knob();
  if (toastT > 0 && (toastT -= dt) <= 0) $("toast").classList.remove("show");
  requestAnimationFrame(loop);
}

// --- menu
const MODE_INFO = {
  drag: ["Drag", "Thumb down anywhere on the left, slide sideways. Distance = wheel angle."],
  tilt: ["Tilt", "Turn the phone like a wheel. Left side of the screen brakes."],
  stick: ["Stick", "Classic floating thumbstick. The baseline."],
};
function renderMenu() {
  $("modes").innerHTML = MODES.map((m) => `<button class="mode ${settings.mode === m ? "sel" : ""}" data-m="${m}"><b>${MODE_INFO[m][0]}</b><span>${MODE_INFO[m][1]}</span></button>`).join("");
  $("opt-drag").style.display = settings.mode === "drag" ? "" : "none";
  $("opt-tilt").style.display = settings.mode === "tilt" ? "" : "none";
  $("dragRange").value = settings.dragRange; $("dragRangeV").textContent = settings.dragRange + " px";
  $("tiltLock").value = settings.tiltLock; $("tiltLockV").textContent = settings.tiltLock + "°";
  $("tiltInvert").checked = settings.tiltInvert;
  $("modename").textContent = MODE_INFO[settings.mode][0].toUpperCase();
  $("zonehint").textContent = settings.mode === "tilt" ? "hold to brake" : settings.mode === "drag" ? "slide to steer" : "stick";
  // lap table: best per mode, then the recent laps
  const rows = history.slice(-12).reverse();
  const best = Object.fromEntries(MODES.map((m) => [m, bestFor(m)]));
  const summary = MODES.filter((m) => best[m] != null).map((m) => {
    const ls = history.filter((l) => l.mode === m);
    const avg = ls.reduce((s, l) => s + l.time, 0) / ls.length;
    return `<tr><td><b>${MODE_INFO[m][0]}</b></td><td>${ls.length} laps</td><td class="best">${fmt(best[m])}</td><td>${fmt(avg)}</td><td>${(ls.reduce((s, l) => s + l.off, 0) / ls.length * 100).toFixed(0)}%</td><td>${(ls.reduce((s, l) => s + l.walls, 0) / ls.length).toFixed(1)}</td></tr>`;
  }).join("");
  $("laps").innerHTML = history.length
    ? `<tr><th>Scheme</th><th></th><th>Best</th><th>Average</th><th>Off road</th><th>Walls</th></tr>${summary}
       <tr><th colspan="6" style="text-align:left;padding-top:12px">Recent laps</th></tr>
       ${rows.map((l) => `<tr><td>${MODE_INFO[l.mode][0]}</td><td></td><td class="${l.time === best[l.mode] ? "best" : ""}">${fmt(l.time)}</td><td></td><td>${(l.off * 100).toFixed(0)}%</td><td>${l.walls}</td></tr>`).join("")}`
    : "";
}
$("modes").addEventListener("click", async (e) => {
  const b = e.target.closest(".mode");
  if (!b) return;
  settings.mode = b.dataset.m; saveSettings(settings);
  $("msg").textContent = "";
  if (settings.mode === "tilt") {
    const err = await input.enableTilt();
    $("msg").textContent = err || "Hold the phone how you'll race, then press RACE (that sets the centre).";
  }
  renderMenu();
});
for (const [id, key] of [["dragRange", "dragRange"], ["tiltLock", "tiltLock"]]) {
  $(id).addEventListener("input", (e) => { settings[key] = +e.target.value; saveSettings(settings); renderMenu(); });
}
$("tiltInvert").addEventListener("change", (e) => { settings.tiltInvert = e.target.checked; saveSettings(settings); });
$("recenter").addEventListener("click", () => { input.recenter(); $("msg").textContent = "Centred."; });
$("clear").addEventListener("click", () => { if (confirm("Clear all lap times?")) { history = []; saveHistory(); for (const k in bestGhost) delete bestGhost[k]; renderMenu(); } });
$("restart").addEventListener("click", () => { newRun(); start(); });
$("go").addEventListener("click", start);
$("pause").addEventListener("click", pause);
addEventListener("keydown", (e) => {
  if (e.code === "Escape") running ? pause() : start();
  if (e.code === "KeyR" && running) resetCar(car, tr);
});
document.addEventListener("visibilitychange", () => { if (document.hidden && running) pause(); });

async function start() {
  if (settings.mode === "tilt") {
    const err = await input.enableTilt();
    if (err) { $("msg").textContent = err; return; }
    input.recenter();
  }
  // full screen and landscape on phones (best effort; Android Chrome allows the lock in full screen)
  if (matchMedia("(pointer: coarse)").matches && !document.fullscreenElement) {
    try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); await screen.orientation?.lock?.("landscape"); } catch {}
  }
  if (settings.mode === "tilt") setTimeout(() => input.recenter(), 400);   // after the rotation settles
  $("menu").classList.add("hidden");
  input.release();
  running = true; last = performance.now(); acc = 0;
}
function pause() {
  running = false; input.release();
  renderMenu();
  $("menu").classList.remove("hidden");
}

addEventListener("resize", () => view.resize());
view.resize();
newRun();
renderMenu();
requestAnimationFrame(loop);

// test hooks
window.__tr = { get car() { return car; }, get timer() { return timer; }, input, settings, start, tr };
