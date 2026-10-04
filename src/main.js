import { buildTrack } from "./track.js";
import { makeCar, stepCar, resetCar, makeTimer, stepTimer, DT } from "./car.js";
import { makeCar2, stepCar2, resetCar2 } from "./car2.js";
import { createInput, loadSettings, saveSettings, MODES } from "./input.js";
import { createRenderer } from "./render.js";

const $ = (id) => document.getElementById(id);
const tr = buildTrack();
const settings = loadSettings();
const input = createInput($("zone"), { drift: $("drift"), brake: $("brake"), pedal: $("pedal") }, settings);
const view = createRenderer($("c"), tr);

const LAPS_KEY = "tr.laps.v1";
let history = [];
try { history = JSON.parse(localStorage.getItem(LAPS_KEY) || "[]"); } catch {}
const saveHistory = () => { try { localStorage.setItem(LAPS_KEY, JSON.stringify(history.slice(-200))); } catch {} };

let car, timer, rec, ghost, prevSteer = 0, inp = { steer: 0, drift: false, brake: false };
let prev = null, running = false, acc = 0, last = performance.now(), toastT = 0;
const events = [];

// lap times and ghosts are kept per car and steering scheme
const keyOf = (model, mode) => `${model}:${mode}`;
const lapKey = (l) => keyOf(l.model || "arcade", l.mode);
const curKey = () => keyOf(settings.model, settings.mode);

function newRun() {
  car = settings.model === "pedals" ? makeCar2(tr) : makeCar(tr);
  timer = makeTimer(); rec = []; prevSteer = 0;
  ghost = bestGhost[curKey()] || null;
  applyModel();
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
  if (car.model === "pedals") stepCar2(car, inp, tr); else stepCar(car, inp, tr);
  rec.push(car.x, car.z, car.h);
  const lap = stepTimer(timer, car, tr, prevSteer, inp.steer);
  prevSteer = inp.steer;
  for (const e of car.events) events.push(e);
  if (lap) onLap(lap);
}

function onLap(lap) {
  const key = curKey();
  const prevBest = bestFor(key);
  const entry = { model: settings.model, mode: settings.mode, time: lap.time, off: lap.off, walls: lap.walls, jerk: lap.jerk, at: Date.now() };
  history.push(entry); saveHistory();
  const lapRec = rec; rec = [];
  if (prevBest == null || lap.time < prevBest) bestGhost[key] = lapRec;
  ghost = bestGhost[key];
  const d = prevBest == null ? null : lap.time - prevBest;
  toast(prevBest == null || d < 0 ? `${fmt(lap.time)}${d != null ? `  ${d.toFixed(2)}` : ""}` : `${fmt(lap.time)}  +${d.toFixed(2)}`);
  $("delta").textContent = d == null ? "" : (d < 0 ? "" : "+") + d.toFixed(2);
  $("delta").className = d == null ? "" : d < 0 ? "good" : "bad";
}

const bestFor = (key) => history.filter((l) => lapKey(l) === key).reduce((b, l) => (b == null || l.time < b ? l.time : b), null);
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
function toast(s) { $("toast").textContent = s; $("toast").classList.add("show"); toastT = 1.6; }

const TIER_CSS = ["#ffe07a", "#4fd6ff", "#ff9a2e", "#d36bff"];
function hud(c) {
  const t = (timer.tick - timer.lapStart) / 60;
  $("now").textContent = fmt(t);
  $("last").textContent = "last " + (timer.last ? fmt(timer.last.time) : "–");
  const b = bestFor(curKey());
  $("best").textContent = "best " + (b == null ? "–" : fmt(b));
  $("lapn").textContent = `LAP ${timer.laps.length + 1}`;
  $("steerbar").querySelector("i").style.left = `${50 + inp.steer * 50}%`;
  $("kmh").firstChild.textContent = `${Math.round(Math.hypot(c.vx, c.vz) * 3.6)} `;
  const span = $("charge").firstElementChild;
  span.style.width = c.drifting ? `${Math.min(1, c.charge / 2.6) * 100}%` : c.boost > 0 ? "100%" : "0%";
  span.style.background = c.boost > 0 ? TIER_CSS[1] : TIER_CSS[c.tier];
  $("boostfx").style.opacity = c.boost > 0 ? Math.min(1, c.boost * 2) : 0;
  if (c.model === "pedals") {
    $("pbT").style.width = `${(inp.throttle || 0) * 100}%`;
    $("pbB").style.width = `${(inp.brake || 0) * 100}%`;
    // weight: 50% marker = static balance (54% front); further left = more on the nose
    $("wbar").firstElementChild.style.left = `${Math.max(0, Math.min(100, 50 - (c.loadF - 0.54) * 250))}%`;
    const st = input.state, mark = $("pedal").querySelector("i");
    mark.style.display = st.pedPtr !== null ? "block" : "none";
    mark.style.top = `${st.ped * 100}%`;
  }
}

// show the controls for the chosen car
function applyModel() {
  const pedals = settings.model === "pedals";
  $("pedal").style.display = pedals ? "" : "none";
  $("pedal").style.height = settings.pedalH + "px";
  $("drift").style.display = $("brake").style.display = pedals ? "none" : "";
  $("charge").style.display = pedals ? "none" : "";
  $("pedhud").style.display = pedals ? "" : "none";
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
    Object.assign(rail.style, { display: "block", width: 2 * R + "px", left: -R + "px",
      background: `linear-gradient(90deg, rgba(255,255,255,.35) ${50 - settings.dragDead * 50}%, rgba(255,255,255,.12) ${50 - settings.dragDead * 50}% ${50 + settings.dragDead * 50}%, rgba(255,255,255,.35) ${50 + settings.dragDead * 50}%)` });
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
    boost: car.boost > 0, boostTier: 1, off: car.off, brake: inp.brake > 0.1, smoke: car.model === "pedals",
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
const MODEL_NAME = { pedals: "Pedals", arcade: "Arcade" };
const HELP = {
  pedals: "Right thumb on the strip: top is gas, bottom is brake, the yellow band is both at once. Lift off mid-corner to tighten your line, brake into a corner to rotate the car, careful with full gas in slow corners (the rear steps out). Keys: A/D steer, W gas, S brake (both together works), Esc menu.",
  arcade: "Hold DRIFT while turning, let go once the sparks change color for a boost (yellow → blue → orange → purple). Keys: A/D steer, Space drift, S brake, Esc menu.",
};
function renderMenu() {
  document.querySelectorAll(".seg").forEach((b) => b.classList.toggle("sel", b.dataset.model === settings.model));
  $("help").textContent = HELP[settings.model];
  $("modes").innerHTML = MODES.map((m) => `<button class="mode ${settings.mode === m ? "sel" : ""}" data-m="${m}"><b>${MODE_INFO[m][0]}</b><span>${MODE_INFO[m][1]}</span></button>`).join("");
  $("opt-drag").style.display = settings.mode === "drag" ? "" : "none";
  $("opt-tilt").style.display = settings.mode === "tilt" ? "" : "none";
  $("dragRange").value = settings.dragRange; $("dragRangeV").textContent = settings.dragRange + " px";
  $("dragDead").value = settings.dragDead; $("dragDeadV").textContent = Math.round(settings.dragDead * 100) + "%";
  $("dragCurve").value = settings.dragCurve; $("dragCurveV").textContent = settings.dragCurve === 1 ? "linear" : "×" + settings.dragCurve.toFixed(1);
  $("opt-pedal").style.display = settings.model === "pedals" ? "" : "none";
  $("pedalH").value = settings.pedalH; $("pedalHV").textContent = settings.pedalH + " px";
  $("tiltLock").value = settings.tiltLock; $("tiltLockV").textContent = settings.tiltLock + "°";
  $("tiltInvert").checked = settings.tiltInvert;
  $("modename").textContent = `${MODEL_NAME[settings.model]} · ${MODE_INFO[settings.mode][0]}`.toUpperCase();
  $("zonehint").textContent = settings.mode === "tilt" ? "hold to brake" : settings.mode === "drag" ? "slide to steer" : "stick";
  // lap table: best per car + scheme, then the recent laps
  const rows = history.slice(-12).reverse();
  const keys = [...new Set(history.map(lapKey))];
  const best = Object.fromEntries(keys.map((k) => [k, bestFor(k)]));
  const label = (k) => { const [mo, me] = k.split(":"); return `${MODEL_NAME[mo]} · ${MODE_INFO[me][0]}`; };
  const summary = keys.map((k) => {
    const ls = history.filter((l) => lapKey(l) === k);
    const avg = ls.reduce((s, l) => s + l.time, 0) / ls.length;
    return `<tr><td><b>${label(k)}</b></td><td>${ls.length} laps</td><td class="best">${fmt(best[k])}</td><td>${fmt(avg)}</td><td>${(ls.reduce((s, l) => s + l.off, 0) / ls.length * 100).toFixed(0)}%</td><td>${(ls.reduce((s, l) => s + l.walls, 0) / ls.length).toFixed(1)}</td></tr>`;
  }).join("");
  $("laps").innerHTML = history.length
    ? `<tr><th>Scheme</th><th></th><th>Best</th><th>Average</th><th>Off road</th><th>Walls</th></tr>${summary}
       <tr><th colspan="6" style="text-align:left;padding-top:12px">Recent laps</th></tr>
       ${rows.map((l) => `<tr><td>${label(lapKey(l))}</td><td></td><td class="${l.time === best[lapKey(l)] ? "best" : ""}">${fmt(l.time)}</td><td></td><td>${(l.off * 100).toFixed(0)}%</td><td>${l.walls}</td></tr>`).join("")}`
    : "";
}
document.querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => {
  if (settings.model === b.dataset.model) return;
  settings.model = b.dataset.model; saveSettings(settings);
  newRun(); renderMenu();
}));
$("modes").addEventListener("click", async (e) => {
  const b = e.target.closest(".mode");
  if (!b) return;
  settings.mode = b.dataset.m; saveSettings(settings);
  ghost = bestGhost[curKey()] || null;
  $("msg").textContent = "";
  if (settings.mode === "tilt") {
    const err = await input.enableTilt();
    $("msg").textContent = err || "Hold the phone how you'll race, then press RACE (that sets the center).";
  }
  renderMenu();
});
for (const [id, key] of [["dragRange", "dragRange"], ["dragDead", "dragDead"], ["dragCurve", "dragCurve"], ["pedalH", "pedalH"], ["tiltLock", "tiltLock"]]) {
  $(id).addEventListener("input", (e) => { settings[key] = +e.target.value; saveSettings(settings); renderMenu(); applyModel(); });
}
$("tiltInvert").addEventListener("change", (e) => { settings.tiltInvert = e.target.checked; saveSettings(settings); });
$("recenter").addEventListener("click", () => { input.recenter(); $("msg").textContent = "Centered."; });
$("clear").addEventListener("click", () => { if (confirm("Clear all lap times?")) { history = []; saveHistory(); for (const k in bestGhost) delete bestGhost[k]; renderMenu(); } });
$("restart").addEventListener("click", () => { newRun(); start(); });
$("go").addEventListener("click", start);
$("pause").addEventListener("click", pause);
addEventListener("keydown", (e) => {
  if (e.code === "Escape") running ? pause() : start();
  if (e.code === "KeyR" && running) (car.model === "pedals" ? resetCar2 : resetCar)(car, tr);
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
