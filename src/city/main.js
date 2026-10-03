// Last Mile: the delivery game loop, HUD, minimap and speed lines.
import { buildCity, X, NB, CURB } from "./map.js";
import { route, nextTurn, speedPlan, allowedSpeed, alongRoute } from "./gps.js";
import { makeCityCar, stepCityCar, resetCityCar } from "./world.js";
import { makeShift, stepShift, rating, avgRating, SHIFT } from "./shift.js";
import { createCityRenderer } from "./render.js";
import { makeRun, effects, settleShift, repairCost, repair, rerollCost, reroll, buy, modById, rollOffers, saveRun, loadRun, ECON } from "./run.js";
import { createInput, loadSettings, saveSettings } from "../input.js";
import { DT } from "../car.js";

const $ = (id) => document.getElementById(id);
const city = buildCity();
const settings = loadSettings();
settings.model = "pedals";
if (settings.mode === "tilt") settings.mode = "drag";
const input = createInput($("zone"), { drift: $("drift"), brake: $("brake"), pedal: $("pedal") }, settings);
const view = createCityRenderer($("c"), city, { night: settings.night !== false });

// the run in progress (saved between sessions) and the best run so far
const RUN_KEY = "lm.run.v1", BEST_KEY = "lm.bestrun.v1";
let run = null, best = { days: 0, earned: 0 };
try { const s = localStorage.getItem(RUN_KEY); if (s) run = loadRun(s); } catch {}
try { best = JSON.parse(localStorage.getItem(BEST_KEY)) || best; } catch {}
const persist = () => { try { run && !run.over ? localStorage.setItem(RUN_KEY, saveRun(run)) : localStorage.removeItem(RUN_KEY); } catch {} };

let car, shift, carP, rt = null, rtT = 0, running = false, inShift = false, acc = 0, last = performance.now(), toastT = 0;
let prev, inp = { steer: 0, throttle: 0, brake: 0 };
const events = [];

function newShift() {
  car = makeCityCar(city);
  if (run) {
    const { fx, p } = effects(run);
    carP = p;
    car.cond = run.cond; car.dmgMul = fx.dmgMul; car.bullbar = fx.bullbar;
    shift = makeShift(city, run.seed * 101 + run.day, { ratings: run.ratings, fx });
    view.setUnderglow(fx.underglow);
    view.resetPoles();
  } else {
    carP = effects(makeRun(1)).p;
    shift = makeShift(city, 1);
  }
  rt = null; prev = snap(car);
  view.snapCamera();
}
const snap = (c) => ({ x: c.x, z: c.z, h: c.h });
const lerpAng = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

function tick() {
  prev = snap(car);
  inp = input.read(DT);
  stepCityCar(car, inp, city, carP);
  for (const e of car.events) events.push(e);
  stepShift(shift, city, car);
  for (const e of shift.events) onShiftEvent(e);
  // the GPS re-routes a few times a second
  const o = shift.order;
  if (o && (++rtT >= 15 || !rt)) {
    rtT = 0;
    // route along the way the car is actually travelling (a slide points the nose elsewhere)
    const sp = Math.hypot(car.vx, car.vz), dirH = sp > 3 ? Math.atan2(car.vx, car.vz) : car.h;
    rt = route(city, car.x, car.z, dirH, o.phase === "pickup" ? o.rest : o.cust, Math.max(0, car.u));
    rt.plan = speedPlan(rt);
    view.setRoute(rt.points, rt.plan);
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
  $("money").textContent = run ? `$${shift.money.toFixed(2)} of $${ECON.bill(run.day)} bill · day ${run.day}` : `$${shift.money.toFixed(2)}`;
  $("money").style.color = run && run.cash + shift.money < ECON.bill(run.day) ? "#ffb0a0" : "";
  $("rating").textContent = `★ ${rating(shift).toFixed(2)}${run && run.probation ? " · PROBATION" : ""}`;
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
  // turn-by-turn: the next manoeuvre and how far
  if (rt && running) {
    const nt = nextTurn(city, rt);
    $("turn").style.display = "flex";
    $("tarrow").textContent = { left: "↰", right: "↱", uturn: "↶", arrive: "◎" }[nt.dir];
    $("tdist").textContent = nt.dist < 15 ? (nt.dir === "arrive" ? "HERE" : "NOW") : `${Math.round(nt.dist / 10) * 10} m`;
    $("tonto").textContent = nt.dir === "arrive" ? (o && o.phase === "pickup" ? o.rest.name : o ? o.cust.label : "") : nt.onto ? `onto ${nt.onto}` : "";
    $("turn").classList.toggle("soon", nt.dist < 45);
  } else $("turn").style.display = "none";
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

// --- minimap: heading-up and centred on the car, about 120 m around it. A static layer of the whole
// district is drawn once at the map's scale, then rotated under the car each frame.
const mapCv = $("map"), mctx = mapCv.getContext("2d"), MS = mapCv.width, VIEW = 125;   // metres from centre to edge
const B = city.bounds, mscale = MS / 2 / VIEW, bx = (x) => (x - B.x0) * mscale, bz = (z) => (z - B.z0) * mscale;
const base = document.createElement("canvas"); base.width = Math.ceil((B.x1 - B.x0) * mscale); base.height = Math.ceil((B.z1 - B.z0) * mscale);
{
  const g = base.getContext("2d");
  g.fillStyle = "#2c3038"; g.fillRect(0, 0, base.width, base.height);
  g.fillStyle = "#7d8088";
  for (const e of city.edges) {
    const w = CURB * 2 * mscale;
    g.fillRect(Math.min(bx(e.ax), bx(e.bx)) - w / 2, Math.min(bz(e.az), bz(e.bz)) - w / 2, Math.abs(bx(e.bx) - bx(e.ax)) + w, Math.abs(bz(e.bz) - bz(e.az)) + w);
  }
  g.fillStyle = "#6dbb55";
  for (const p of [...city.parks, ...city.removed]) g.fillRect(bx(p.x0), bz(p.z0), (p.x1 - p.x0) * mscale, (p.z1 - p.z0) * mscale);
  g.fillStyle = "#666a73";
  for (const p of [...city.lots, ...city.alleys]) g.fillRect(bx(p.x0), bz(p.z0), (p.x1 - p.x0) * mscale, (p.z1 - p.z0) * mscale);
  for (const r of city.restaurants) {
    g.fillStyle = "#" + r.color.toString(16).padStart(6, "0");
    g.beginPath(); g.arc(bx(r.x), bz(r.z), 6, 0, 7); g.fill();
  }
}
function drawMap() {
  const c = MS / 2;
  mctx.save();
  mctx.clearRect(0, 0, MS, MS);
  mctx.beginPath(); mctx.arc(c, c, c, 0, 7); mctx.clip();
  mctx.fillStyle = "#1c1f25"; mctx.fillRect(0, 0, MS, MS);
  // rotate the world so the car's heading points up
  mctx.translate(c, c);
  mctx.rotate(car.h - Math.PI);
  mctx.translate(-bx(car.x), -bz(car.z));
  mctx.drawImage(base, 0, 0);
  if (rt) {
    mctx.strokeStyle = "#28dcff"; mctx.lineWidth = 6; mctx.lineJoin = "round"; mctx.beginPath();
    rt.points.forEach(([x, z], i) => (i ? mctx.lineTo(bx(x), bz(z)) : mctx.moveTo(bx(x), bz(z))));
    mctx.stroke();
  }
  mctx.restore();
  // the destination: on the map if it's in range, otherwise pinned to the rim pointing at it
  const o = shift.order;
  if (o) {
    const p = o.phase === "pickup" ? o.rest : o.cust;
    const dx = p.x - car.x, dz = p.z - car.z, ang = car.h - Math.PI;
    let sx = (dx * Math.cos(ang) - dz * Math.sin(ang)) * mscale, sz = (dx * Math.sin(ang) + dz * Math.cos(ang)) * mscale;
    const r = Math.hypot(sx, sz), lim = c - 10;
    if (r > lim) { sx *= lim / r; sz *= lim / r; }
    mctx.fillStyle = o.phase === "pickup" ? "#ffa31a" : "#3dff7a";
    mctx.beginPath(); mctx.arc(c + sx, c + sz, 9, 0, 7); mctx.fill();
    mctx.strokeStyle = "#fff"; mctx.lineWidth = 3; mctx.stroke();
  }
  // the car: an arrow at the centre, always pointing up
  mctx.fillStyle = "#fff";
  mctx.beginPath(); mctx.moveTo(c, c - 13); mctx.lineTo(c + 9, c + 10); mctx.lineTo(c, c + 5); mctx.lineTo(c - 9, c + 10); mctx.closePath(); mctx.fill();
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
  // before drawing: a freshly re-routed line has no colours yet
  if (rt && running) {
    // colour the line against where the car is now along it (it was laid from where the car was)
    const sCar = alongRoute(rt, car.x, car.z);
    view.colorRoute(Math.hypot(car.vx, car.vz), sCar, (plan, s) => (s < sCar ? Infinity : allowedSpeed(plan, s)));
  }
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

// --- screens: title, garage (between shifts), game over. The controls drawer is always below.
const MODE_INFO = {
  drag: ["Drag", "Thumb down anywhere on the left, slide sideways."],
  stick: ["Stick", "Floating thumbstick."],
};
const money = (v) => `$${v.toFixed(0)}`;
const condBar = (c) => `<div class="bar"><span style="width:${c * 100}%;background:${c > 0.6 ? "#9ee08a" : c > 0.3 ? "#ffd27a" : "#ff7a6a"}"></span></div>`;

function titleScreen() {
  return `<h1>LAST MILE <small>delivery roguelike prototype</small></h1>
    <div class="muted">Pick up at the orange beacon, deliver to the green one: stop inside the circle. Tips drain while the clock runs; drinks spill if you throw the car around. One shift a day, then the car payment comes out, and it goes up every day. Miss it and the car's repossessed. Finish a day with your rating under 4.0 and you're on probation; do it twice running and you're deactivated. The blue line is the GPS; the alleys, the lot and the park are faster, and it doesn't know them.</div>
    <div class="stats"><div><b>${best.days ? `${best.days} days` : "–"}</b><span>BEST RUN</span></div><div><b>${best.earned ? money(best.earned) : "–"}</b><span>MOST EARNED</span></div></div>
    <div class="row">${run && !run.over ? `<button class="go" data-act="continue">CONTINUE · DAY ${run.day}</button> <button class="sm" data-act="newrun">New run</button>` : `<button class="go" data-act="newrun">START RUN</button>`}</div>`;
}

function garageScreen(last) {
  const { fx } = effects(run);
  const fixTo = (t) => repairCost(run, t);
  const r = avgRating(run.ratings);
  const offers = run.offers.map((id) => {
    const m = modById[id];
    return `<div class="mod"><span class="tag ${m.kind}">${m.kind === "perf" ? "PERFORMANCE" : m.kind === "cargo" ? "CARGO" : "STYLE"}</span><b>${m.name}</b><span class="d">${m.desc}</span>
      <button data-act="buy" data-id="${id}" ${m.price > run.cash ? "disabled" : ""}>${money(m.price)}</button></div>`;
  }).join("") || `<div class="muted">Sold out.</div>`;
  return `<h2 class="big">DAY ${run.day} · GARAGE</h2>
    ${last ? `<div class="muted">Yesterday: ${last.jobs} deliveries, earned ${money(last.earned)}, car payment ${money(last.bill)}.</div>` : ""}
    ${run.probation ? `<div style="color:#ffb0a0;font-size:13px;margin:4px 0">⚠ PROBATION: your rating finished under 4.0. Finish today under it again and you're deactivated.</div>` : ""}
    <div class="stats"><div><b>${money(run.cash)}</b><span>CASH</span></div><div><b>${money(ECON.bill(run.day))}</b><span>PAYMENT AFTER TODAY</span></div><div><b>★ ${r.toFixed(2)}</b><span>RATING</span></div></div>
    <div class="repair"><b>Car ${Math.round(run.cond * 100)}%</b> ${condBar(run.cond)}
      ${run.cond < 0.995 ? `<button class="sm" data-act="repair" data-to="${Math.min(1, run.cond + 0.25)}" ${fixTo(Math.min(1, run.cond + 0.25)) > run.cash ? "disabled" : ""}>Patch +25% ${money(fixTo(Math.min(1, run.cond + 0.25)))}</button>
        <button class="sm" data-act="repair" data-to="1" ${fixTo(1) > run.cash ? "disabled" : ""}>Full repair ${money(fixTo(1))}</button>` : `<span class="muted">mint</span>`}
      <span class="muted">${run.cond < 0.6 ? "A beaten car loses power." : ""}${fx.repairMul < 1 ? " Dash cam discount applied." : ""}</span></div>
    <div class="row" style="justify-content:space-between"><b>Shop</b> <button class="sm" data-act="reroll" ${rerollCost(run) > run.cash ? "disabled" : ""}>Reroll ${money(rerollCost(run))}</button></div>
    <div class="shop">${offers}</div>
    ${run.mods.length ? `<div class="chips">${run.mods.map((id) => `<span class="chip">${modById[id].name}</span>`).join("")}</div>` : ""}
    <div class="row"><button class="go" data-act="start">START DAY ${run.day}</button> <button class="sm" data-act="title">Title</button></div>`;
}

function overScreen() {
  const why = run.over === "repo" ? ["REPOSSESSED", "You couldn't make the car payment. The tow truck didn't even honk."]
    : ["DEACTIVATED", "\"We've noticed your recent ratings don't meet our community standards.\""];
  const last = run.log[run.log.length - 1];
  return `<h2 class="big">${why[0]}</h2><div class="muted">${why[1]}</div>
    <div class="stats"><div><b>${run.day}</b><span>DAYS</span></div><div><b>${money(run.earned)}</b><span>EARNED</span></div><div><b>${run.mods.length}</b><span>MODS</span></div>${last ? `<div><b>${money(last.earned)}</b><span>LAST SHIFT</span></div>` : ""}</div>
    <details><summary>Last shift</summary><table><tr><th>Order</th><th>To</th><th>Earned</th><th>Tip</th><th>Stars</th><th>Spilled</th></tr>
    ${shift.log.map((l) => `<tr><td>${l.item}</td><td>${l.to}</td><td>$${l.earned.toFixed(2)}</td><td>$${l.tip.toFixed(2)}</td><td>${l.stars.toFixed(1)}</td><td>${Math.round((1 - l.quality) * 100)}%</td></tr>`).join("")}</table></details>
    <div class="row"><button class="go" data-act="newrun">NEW RUN</button> <button class="sm" data-act="title">Title</button></div>`;
}

let curScreen = "title", lastDay = null;
function show(which) {
  curScreen = which;
  $("screen").innerHTML = which === "garage" ? garageScreen(lastDay) : which === "over" ? overScreen() : which === "pause" ? pauseScreen() : titleScreen();
  renderSettings();
  $("menu").classList.remove("hidden");
}
function pauseScreen() {
  return `<h2 class="big">PAUSED</h2><div class="muted">Day ${run ? run.day : "–"}. The clock's stopped; the customer's patience isn't (it is, actually).</div>
    <div class="row"><button class="go" data-act="resume">RESUME</button> <button class="sm" data-act="abandon">Abandon shift</button></div>`;
}
function renderSettings() {
  $("modes").innerHTML = Object.keys(MODE_INFO).map((m) => `<button class="mode ${settings.mode === m ? "sel" : ""}" data-m="${m}"><b>${MODE_INFO[m][0]}</b><span>${MODE_INFO[m][1]}</span></button>`).join("");
  $("dragRange").value = settings.dragRange; $("dragRangeV").textContent = settings.dragRange + "px";
  $("dragDead").value = settings.dragDead; $("dragDeadV").textContent = Math.round(settings.dragDead * 100) + "%";
  $("dragCurve").value = settings.dragCurve; $("dragCurveV").textContent = "×" + (+settings.dragCurve).toFixed(1);
  $("pedalH").value = settings.pedalH; $("pedalHV").textContent = settings.pedalH + "px";
  $("pedal").style.height = settings.pedalH + "px";
}
$("screen").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "newrun") { run = makeRun(); rollOffers(run); persist(); newShift(); start(); return; }
  if (act === "continue") { lastDay = run.log[run.log.length - 1] || null; show(run.log.length ? "garage" : "title"); if (!run.log.length) { newShift(); start(); } return; }
  if (act === "start") { newShift(); start(); return; }
  if (act === "resume") { start(); return; }
  if (act === "abandon") { shift.over = "abandoned"; running = false; endShift(); return; }
  if (act === "title") { show("title"); return; }
  if (act === "buy") buy(run, b.dataset.id);
  if (act === "reroll") reroll(run);
  if (act === "repair") repair(run, +b.dataset.to);
  persist();
  show("garage");
});
$("modes").addEventListener("click", (e) => {
  const b = e.target.closest(".mode[data-m]");
  if (!b) return;
  settings.mode = b.dataset.m; saveSettings(settings); renderSettings();
});
for (const id of ["dragRange", "dragDead", "dragCurve", "pedalH"]) {
  $(id).addEventListener("input", (e) => { settings[id] = +e.target.value; saveSettings(settings); renderSettings(); });
}
$("pause").addEventListener("click", pause);
addEventListener("keydown", (e) => {
  if (e.code === "Escape") { if (running) pause(); else if (curScreen === "pause") start(); }
  if (e.code === "KeyR" && running) resetCityCar(car, city);
});
document.addEventListener("visibilitychange", () => { if (document.hidden && running) pause(); });

async function start() {
  if (matchMedia("(pointer: coarse)").matches && !document.fullscreenElement) {
    try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); await screen.orientation?.lock?.("landscape"); } catch {}
  }
  $("menu").classList.add("hidden");
  input.release();
  inShift = true; running = true; last = performance.now(); acc = 0;
}
function pause() {
  running = false; input.release();
  show("pause");
}
function endShift() {
  running = false; inShift = false;
  if (!run) { show("title"); return; }
  lastDay = settleShift(run, shift, car);
  if (run.day > best.days || run.earned > best.earned) {
    best = { days: Math.max(best.days, run.over ? run.day : run.day - 1), earned: Math.max(best.earned, run.earned) };
    try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch {}
  }
  persist();
  show(run.over ? "over" : "garage");
}

addEventListener("resize", () => { view.resize(); sizeLines(); });
view.resize(); sizeLines();
newShift();
show("title");
requestAnimationFrame(loop);

window.__lm = { get car() { return car; }, get shift() { return shift; }, city, input, settings, start, info: () => view.info() };
