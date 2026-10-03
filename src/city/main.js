// Last Mile: the delivery game loop, HUD, minimap and speed lines.
import { buildCity, X, NB, CURB } from "./map.js";
import { route } from "./gps.js";
import { makeCityCar, stepCityCar, resetCityCar } from "./world.js";
import { makeShift, stepShift, rating, SHIFT } from "./shift.js";
import { createCityRenderer } from "./render.js";
import { createInput, loadSettings, saveSettings } from "../input.js";
import { DT } from "../car.js";

const $ = (id) => document.getElementById(id);
const city = buildCity();
const settings = loadSettings();
settings.model = "pedals";
if (settings.mode === "tilt") settings.mode = "drag";
const input = createInput($("zone"), { drift: $("drift"), brake: $("brake"), pedal: $("pedal") }, settings);
const view = createCityRenderer($("c"), city);

const BEST_KEY = "lm.best.v1";
let best = 0;
try { best = +localStorage.getItem(BEST_KEY) || 0; } catch {}

let car, shift, rt = null, rtT = 0, running = false, started = false, acc = 0, last = performance.now(), toastT = 0;
let prev, inp = { steer: 0, throttle: 0, brake: 0 };
const events = [];

function newShift() {
  car = makeCityCar(city);
  shift = makeShift(city, (Date.now() & 0xffff) + 1);
  rt = null; prev = snap(car);
  view.snapCamera();
}
const snap = (c) => ({ x: c.x, z: c.z, h: c.h });
const lerpAng = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

function tick() {
  prev = snap(car);
  inp = input.read(DT);
  stepCityCar(car, inp, city);
  for (const e of car.events) events.push(e);
  stepShift(shift, city, car);
  for (const e of shift.events) onShiftEvent(e);
  // the GPS re-routes a few times a second
  const o = shift.order;
  if (o && (++rtT >= 15 || !rt)) {
    rtT = 0;
    rt = route(city, car.x, car.z, car.h, o.phase === "pickup" ? o.rest : o.cust);
    view.setRoute(rt.points);
  }
  if (shift.over) endShift();
}

function onShiftEvent(e) {
  if (e.type === "order") { rt = null; toast(`NEW ORDER`, `${e.order.item} from ${e.order.rest.name}`); }
  if (e.type === "pickup") { rt = null; toast("PICKED UP", `→ ${e.order.cust.label}`); }
  if (e.type === "delivered") {
    toast(`+$${e.earned.toFixed(2)}`, `${"★".repeat(e.stars)}${"☆".repeat(5 - e.stars)}  ${e.late > 0 ? `${e.late.toFixed(0)}s late` : `tip $${e.tip.toFixed(2)}`}${e.quality < 0.99 ? `  · ${Math.round((1 - e.quality) * 100)}% spilled` : ""}`);
  }
}

function toast(big, small = "") {
  $("toast").innerHTML = `${big}${small ? `<small>${small}</small>` : ""}`;
  $("toast").classList.add("show"); toastT = 1.8;
}
const fmt = (t) => `${t < 0 ? "-" : ""}${Math.floor(Math.abs(t) / 60)}:${String(Math.floor(Math.abs(t) % 60)).padStart(2, "0")}`;

function hud() {
  const o = shift.order;
  $("clock").textContent = fmt(Math.max(0, SHIFT.length - shift.t));
  $("money").textContent = `$${shift.money.toFixed(2)} · ${shift.jobs} delivered`;
  $("rating").textContent = `★ ${rating(shift).toFixed(2)}`;
  $("rating").style.color = rating(shift) < 4.3 ? "#ff8a7a" : "#ffe07a";
  if (o) {
    const pick = o.phase === "pickup";
    $("ophase").textContent = pick ? `PICK UP · ${o.item.toUpperCase()}` : `DELIVER · ${o.item.toUpperCase()}`;
    $("ophase").className = "phase " + o.phase;
    $("owhere").textContent = pick ? o.rest.name : o.cust.label;
    $("otime").textContent = o.left >= 0 ? fmt(o.left) : `LATE ${fmt(-o.left)}`;
    $("otime").className = o.left < 0 ? "late" : o.left < 15 ? "warn" : "";
    const tip = o.left > 0 ? 7 * (o.left / o.time) * (1 - o.spill) : 0;
    $("otip").textContent = o.left > 0 ? `tip $${tip.toFixed(2)}` : "no tip";
    $("spill").style.display = o.kind === "drink" ? "flex" : "none";
    $("spill").querySelector(".bar span").style.width = `${(1 - o.spill) * 100}%`;
    $("stopping").firstElementChild.style.width = `${Math.min(1, o.hold / SHIFT.stopHold) * 100}%`;
  }
  const kmh = Math.abs(car.u) * 3.6;
  $("kmh").firstChild.textContent = `${Math.round(kmh)} `;
  $("gear").textContent = car.reverse ? "REVERSE" : "";
  $("pbT").style.width = `${(inp.throttle || 0) * 100}%`;
  $("pbB").style.width = `${(inp.brake || 0) * 100}%`;
  $("wbar").firstElementChild.style.left = `${Math.max(0, Math.min(100, 50 - (car.loadF - 0.54) * 250))}%`;
  const cb = $("cond").querySelector(".bar span");
  cb.style.width = `${car.cond * 100}%`;
  cb.style.background = car.cond > 0.6 ? "#9ee08a" : car.cond > 0.3 ? "#ffd27a" : "#ff7a6a";
  const st = input.state, mark = $("pedal").querySelector("i");
  mark.style.display = st.pedPtr !== null ? "block" : "none";
  mark.style.top = `${st.ped * 100}%`;
}

function knob() {
  const st = input.state, k = $("knob");
  if (st.steerPtr === null) { k.style.display = "none"; return; }
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
    const R = settings.dragRange, dz = settings.dragDead * 50;
    k.style.left = st.ox + "px"; k.style.top = st.y + "px";
    ring.style.display = "none";
    Object.assign(rail.style, { display: "block", width: 2 * R + "px", left: -R + "px",
      background: `linear-gradient(90deg, rgba(255,255,255,.35) ${50 - dz}%, rgba(255,255,255,.12) ${50 - dz}% ${50 + dz}%, rgba(255,255,255,.35) ${50 + dz}%)` });
    dot.style.left = Math.max(-R, Math.min(R, st.x - st.ox)) + "px"; dot.style.top = "0px";
  }
}

// --- minimap: north up. A static layer drawn once, then the route, beacons and the car on top
const mapCv = $("map"), mctx = mapCv.getContext("2d"), MS = mapCv.width;
const B = city.bounds, mscale = MS / (B.x1 - B.x0 - 40), mx = (x) => (x - B.x0 - 20) * mscale, mz = (z) => (z - B.z0 - 20) * mscale;
const base = document.createElement("canvas"); base.width = base.height = MS;
{
  const g = base.getContext("2d");
  g.fillStyle = "#2c3038"; g.fillRect(0, 0, MS, MS);
  g.fillStyle = "#7d8088";
  for (const e of city.edges) {
    const w = CURB * 2 * mscale;
    g.fillRect(Math.min(mx(e.ax), mx(e.bx)) - w / 2, Math.min(mz(e.az), mz(e.bz)) - w / 2, Math.abs(mx(e.bx) - mx(e.ax)) + w, Math.abs(mz(e.bz) - mz(e.az)) + w);
  }
  g.fillStyle = "#6dbb55";
  for (const p of [...city.parks, ...city.removed]) g.fillRect(mx(p.x0), mz(p.z0), (p.x1 - p.x0) * mscale, (p.z1 - p.z0) * mscale);
  g.fillStyle = "#5d6068";
  for (const p of [...city.lots, ...city.alleys]) g.fillRect(mx(p.x0), mz(p.z0), (p.x1 - p.x0) * mscale, (p.z1 - p.z0) * mscale);
  for (const r of city.restaurants) {
    g.fillStyle = "#" + r.color.toString(16).padStart(6, "0");
    g.beginPath(); g.arc(mx(r.x), mz(r.z), 5, 0, 7); g.fill();
  }
}
function drawMap() {
  mctx.drawImage(base, 0, 0);
  if (rt) {
    mctx.strokeStyle = "#28dcff"; mctx.lineWidth = 4; mctx.beginPath();
    rt.points.forEach(([x, z], i) => (i ? mctx.lineTo(mx(x), mz(z)) : mctx.moveTo(mx(x), mz(z))));
    mctx.stroke();
  }
  const o = shift.order;
  if (o) {
    const p = o.phase === "pickup" ? o.rest : o.cust;
    mctx.fillStyle = o.phase === "pickup" ? "#ffa31a" : "#3dff7a";
    mctx.beginPath(); mctx.arc(mx(p.x), mz(p.z), 7, 0, 7); mctx.fill();
    mctx.strokeStyle = "#fff"; mctx.lineWidth = 2; mctx.stroke();
  }
  // the car: an arrow
  mctx.save(); mctx.translate(mx(car.x), mz(car.z)); mctx.rotate(-car.h + Math.PI);
  mctx.fillStyle = "#fff"; mctx.beginPath(); mctx.moveTo(0, -9); mctx.lineTo(6, 7); mctx.lineTo(0, 4); mctx.lineTo(-6, 7); mctx.closePath(); mctx.fill();
  mctx.restore();
}

// --- speed lines: streaks from the screen edges once you're really moving
const lines = $("lines"), lctx = lines.getContext("2d");
let linesDirty = false;
const sizeLines = () => { lines.width = lines.clientWidth; lines.height = lines.clientHeight; };
const streaks = Array.from({ length: 40 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), v: 0.6 + Math.random() }));
function drawLines(speed, dt) {
  const w = lines.width, h = lines.height;
  const k = Math.max(0, Math.min(1, (speed - 22) / 18));
  if (k <= 0 && !linesDirty) return;
  lctx.clearRect(0, 0, w, h);
  linesDirty = k > 0;
  if (k <= 0) return;
  const cx = w / 2, cy = h * 0.45, R = Math.hypot(w, h) / 2;
  lctx.strokeStyle = `rgba(255,255,255,${0.35 * k})`;
  lctx.lineWidth = 2;
  lctx.beginPath();
  for (const s of streaks) {
    s.r += dt * s.v * (1.2 + k * 2.5);
    if (s.r > 1) { s.r = 0.45 + Math.random() * 0.2; s.a = Math.random() * Math.PI * 2; }
    const r0 = R * s.r, r1 = R * (s.r + 0.08 + 0.12 * k);
    lctx.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0 * 0.75);
    lctx.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1 * 0.75);
  }
  lctx.stroke();
}

function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running) {
    acc += dt;
    while (acc >= DT && running) { tick(); acc -= DT; }
  }
  const a = running ? acc / DT : 1, cur = snap(car);
  const o = shift.order;
  const pose = {
    x: prev.x + (cur.x - prev.x) * a, z: prev.z + (cur.z - prev.z) * a, h: lerpAng(prev.h, cur.h, a),
    speed: Math.hypot(car.vx, car.vz), u: car.u, slip: car.slip, drifting: car.drifting, off: car.off, delta: car.delta,
    gLat: car.gLat, gLong: car.gLong, cond: car.cond, reverse: car.reverse,
  };
  view.frame(pose, dt, events, {
    route: running && rt,
    pickup: o && o.phase === "pickup" ? { x: o.rest.x, z: o.rest.z, inZone: o.inZone } : null,
    dropoff: o && o.phase === "dropoff" ? { x: o.cust.x, z: o.cust.z, inZone: o.inZone } : null,
  });
  events.length = 0;
  hud(); knob(); drawMap();
  drawLines(running ? pose.speed : 0, dt);
  if (toastT > 0 && (toastT -= dt) <= 0) $("toast").classList.remove("show");
  requestAnimationFrame(loop);
}

// --- menu
const MODE_INFO = {
  drag: ["Drag", "Thumb down anywhere on the left, slide sideways."],
  stick: ["Stick", "Floating thumbstick."],
};
function renderMenu() {
  $("modes").innerHTML = Object.keys(MODE_INFO).map((m) => `<button class="mode ${settings.mode === m ? "sel" : ""}" data-m="${m}"><b>${MODE_INFO[m][0]}</b><span>${MODE_INFO[m][1]}</span></button>`).join("")
    + `<div class="mode" style="opacity:.8"><b>Best shift</b><span>${best ? `$${best.toFixed(2)}` : "none yet"}</span></div>`;
  const drag = settings.mode === "drag";
  $("dragRange").value = settings.dragRange; $("dragRangeV").textContent = settings.dragRange + "px";
  $("dragDead").value = settings.dragDead; $("dragDeadV").textContent = Math.round(settings.dragDead * 100) + "%";
  $("dragCurve").value = settings.dragCurve; $("dragCurveV").textContent = "×" + (+settings.dragCurve).toFixed(1);
  $("pedalH").value = settings.pedalH; $("pedalHV").textContent = settings.pedalH + "px";
  for (const id of ["dragRange", "dragDead", "dragRangeV", "dragDeadV", "dragCurve", "dragCurveV"]) $(id).style.opacity = drag ? 1 : 0.35;
  $("pedal").style.height = settings.pedalH + "px";
  $("resume").style.display = started && !shift.over ? "" : "none";
  $("go").textContent = started && !shift.over ? "NEW SHIFT" : "START SHIFT";
}
$("modes").addEventListener("click", (e) => {
  const b = e.target.closest(".mode[data-m]");
  if (!b) return;
  settings.mode = b.dataset.m; saveSettings(settings); renderMenu();
});
for (const id of ["dragRange", "dragDead", "dragCurve", "pedalH"]) {
  $(id).addEventListener("input", (e) => { settings[id] = +e.target.value; saveSettings(settings); renderMenu(); });
}
$("go").addEventListener("click", () => { newShift(); start(); });
$("resume").addEventListener("click", start);
$("pause").addEventListener("click", pause);
addEventListener("keydown", (e) => {
  if (e.code === "Escape") running ? pause() : start();
  if (e.code === "KeyR" && running) resetCityCar(car, city);
});
document.addEventListener("visibilitychange", () => { if (document.hidden && running) pause(); });

async function start() {
  if (matchMedia("(pointer: coarse)").matches && !document.fullscreenElement) {
    try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); await screen.orientation?.lock?.("landscape"); } catch {}
  }
  $("menu").classList.add("hidden");
  input.release();
  started = true; running = true; last = performance.now(); acc = 0;
}
function pause() {
  running = false; input.release();
  renderMenu();
  $("menu").classList.remove("hidden");
}
function endShift() {
  running = false;
  const r = rating(shift), lates = shift.log.filter((l) => l.late > 0).length;
  const isBest = shift.money > best;
  if (isBest) { best = shift.money; try { localStorage.setItem(BEST_KEY, String(best)); } catch {} }
  $("summary").style.display = "block";
  $("summary").innerHTML = `<h2>${shift.over === "deactivated" ? "DEACTIVATED" : "SHIFT OVER"}${isBest ? " · new best" : ""}</h2>
    <div>$${shift.money.toFixed(2)} from ${shift.jobs} deliveries · rating ★ ${r.toFixed(2)} · ${lates} late · car ${Math.round(car.cond * 100)}%</div>
    ${shift.over === "deactivated" ? `<div class="muted">"We've noticed your recent ratings don't meet our community standards."</div>` : ""}
    <details><summary>Deliveries</summary><table><tr><th>Order</th><th>To</th><th>Earned</th><th>Tip</th><th>Stars</th><th>Spilled</th></tr>
    ${shift.log.map((l) => `<tr><td>${l.item}</td><td>${l.to}</td><td>$${l.earned.toFixed(2)}</td><td>$${l.tip.toFixed(2)}</td><td>${"★".repeat(l.stars)}</td><td>${Math.round((1 - l.quality) * 100)}%</td></tr>`).join("")}</table></details>`;
  renderMenu();
  $("menu").classList.remove("hidden");
}

addEventListener("resize", () => { view.resize(); sizeLines(); });
view.resize(); sizeLines();
newShift();
renderMenu();
requestAnimationFrame(loop);

window.__lm = { get car() { return car; }, get shift() { return shift; }, city, input, settings, start, info: () => view.info() };
