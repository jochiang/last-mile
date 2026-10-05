// Last Mile: the delivery game loop, HUD, minimap and speed lines.
import { buildCity, X, NB, CURB } from "./map.js";
import { route, nextTurn, speedPlan, allowedSpeed, alongRoute } from "./gps.js";
import { makeCityCar, stepCityCar, resetCityCar } from "./world.js";
import { makeShift, stepShift, rating, avgRating, SHIFT } from "./shift.js";
import { createCityRenderer } from "./render.js";
import { createAudio } from "./audio.js";
import { createMusic, loadSamples } from "./music.js";
import { dayPlan, applyPlan, barriers, CONDITIONS } from "./conditions.js";
import { createTraffic } from "./traffic.js";
import { runReport, makeRun, effects, settleShift, repairCost, repair, rerollCost, reroll, buy, modById, rollOffers, saveRun, loadRun, ECON, billFor, carOf, termOf, payoffCost, payOff } from "./run.js";
import { CARS, CAR_ORDER } from "./cars.js";
import { pointAt } from "./edges.js";
import { dist, mph } from "./units.js";
import { createInput, loadSettings, saveSettings } from "../input.js";
import { DT } from "../car.js";

const $ = (id) => document.getElementById(id);
const city = buildCity();
const settings = loadSettings();
settings.model = "pedals";
if (settings.mode === "tilt") settings.mode = "drag";
if (!settings.pedalMode) settings.pedalMode = "float";
const input = createInput($("zone"), { drift: $("drift"), brake: $("brake"), pedal: $("pedal"), pedzone: $("pedzone") }, settings);
const audio = createAudio();
if (settings.volume === undefined) settings.volume = 0.8;
if (!settings.music) settings.music = "synthwave";
if (settings.motion === undefined) settings.motion = true;
if (settings.musicVol === undefined) settings.musicVol = 0.7;
let music = null, musicTrack = null;
// the score starts with the first START (browsers need a tap before audio); switching tracks restarts it
function syncMusic() {
  if (!audio.ready) return;
  if (!music) {
    music = createMusic(audio.ctx, audio.out);
    loadSamples(audio.ctx, `${import.meta.env.BASE_URL}audio/drums/`).then((sm) => music.setSamples(sm));
  }
  if (settings.music !== musicTrack) { musicTrack = settings.music; settings.music === "off" ? music.stop() : music.play(settings.music, settings.musicVol); }
  music.setVolume(settings.musicVol);
}
const traffic = createTraffic(city, 7);
const view = createCityRenderer($("c"), city, { night: settings.night !== false });

// the run in progress (saved between sessions) and the best run so far
const RUN_KEY = "lm.run.v1", BEST_KEY = "lm.bestrun.v1";
let run = null, best = { days: 0, earned: 0, paid: {} };   // paid: car id → fewest days to pay it off
try { const s = localStorage.getItem(RUN_KEY); if (s) run = loadRun(s); } catch {}
try { best = { ...best, ...JSON.parse(localStorage.getItem(BEST_KEY)) }; } catch {}
const persist = () => { try { run && !run.over ? localStorage.setItem(RUN_KEY, saveRun(run)) : localStorage.removeItem(RUN_KEY); } catch {} };

let announced = "";
let car, shift, carP, rt = null, rtT = 0, running = false, inShift = false, acc = 0, last = performance.now(), toastT = 0;
let prev, inp = { steer: 0, throttle: 0, brake: 0 };
const events = [];

function newShift() {
  car = makeCityCar(city);
  const { fx, p } = effects(run || makeRun(1));
  // the day's plan: order types, conditions, the clock (conditions.js)
  const plan = dayPlan(city, run ? run.seed : 1, run ? run.day : 1);
  applyPlan(city, plan, fx, p);
  carP = p;
  if (run) { car.cond = run.cond; car.dmgMul = fx.dmgMul; car.bullbar = fx.bullbar; }
  shift = makeShift(city, run ? run.seed * 101 + run.day : 1, { ratings: run ? run.ratings : undefined, fx, plan });
  shift.condStart = car.cond;
  view.setPlayerCar(run ? run.car || "liftback" : "liftback", run ? run.mods : []);
  audio.setPitch(carOf(run || {}).audio.pitch);
  view.setUnderglow(fx.underglow);
  view.resetPoles();
  view.setDay(plan, barriers(plan));
  traffic.reset(car, plan.traffic);
  audio.setRain(plan.conds.includes("rain"));
  $("conds").textContent = plan.conds.map((c) => CONDITIONS[c].name.toUpperCase()).join(" · ");
  rt = null; prev = snap(car);
  view.snapCamera();
}
const snap = (c) => ({ x: c.x, z: c.z, h: c.h });
const KIND_ICON = { food: "🍕", drink: "🥤", cake: "🎂", catering: "🍱", lunch: "🥪" };
const DROP_CSS = ["#3dff7a", "#c58cff"];   // drop-off 1 green, 2 violet (beacons, card, minimap)
const lerpAng = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

function tick() {
  prev = snap(car);
  inp = input.read(DT);
  stepCityCar(car, inp, city, carP);
  traffic.step(car, carP, shift.plan.traffic);   // after the car moves: impacts change its velocity
  for (const e of car.events) events.push(e);
  for (const e of traffic.events) {
    // horns and other people's crashes, panned by where they are relative to the car
    const dx = e.x - car.x, dz = e.z - car.z, d = Math.hypot(dx, dz);
    const pan = Math.max(-1, Math.min(1, (dx * -Math.cos(car.h) + dz * Math.sin(car.h)) / Math.max(8, d) * 1.4));
    if (e.type === "honk" && d < 60) audio.sfx("horn", pan, Math.max(0.2, 1 - d / 60));
    if (e.type === "crash" && !e.player && d < 70) audio.sfx("thump", e.speed * Math.max(0.15, 1 - d / 70));
  }
  stepShift(shift, city, car);
  for (const e of shift.events) onShiftEvent(e);
  // the GPS re-routes a few times a second
  const o = shift.order;
  if ((o || shift.offers.length) && (++rtT >= 15 || !rt)) {
    rtT = 0;
    // route along the way the car is actually travelling (a slide points the nose elsewhere)
    const sp = Math.hypot(car.vx, car.vz), dirH = sp > 3 ? Math.atan2(car.vx, car.vz) : car.h;
    // with an order: to the customer. Choosing: to the nearest offer (you can drive to any of them)
    let dest = null;
    if (o) {
      // carrying: the drop-off with the least time to spare (time left minus the drive there)
      let best = Infinity;
      for (const d of o.drops.filter((x) => !x.done)) {
        const r = route(city, car.x, car.z, dirH, d.cust, Math.max(0, car.u));
        const spare = d.left - r.length / shift.plan.pace;
        if (spare < best) { best = spare; dest = d.cust; }
      }
    } else {
      let best = Infinity;
      for (const of of shift.offers) { const r = route(city, car.x, car.z, dirH, of.rest, Math.max(0, car.u)); if (r.length < best) { best = r.length; dest = of.rest; } }
    }
    rt = route(city, car.x, car.z, dirH, dest, Math.max(0, car.u), rt);
    rt.dest = dest;
    rt.plan = speedPlan(rt);
    view.setRoute(rt.points, rt.plan);
  }
  if (shift.over) endShift();
}

function onShiftEvent(e) {
  if (e.type === "offers") { rt = null; toast(`${e.offers.length} NEW ORDERS`, "Drive to the one you want"); audio.sfx("ping"); view.setOffers(e.offers); }
  if (e.type === "pickup") {
    rt = null; audio.sfx("pickup"); view.setOffers([]);
    const ds = e.order.drops;
    toast(ds.length > 1 ? "PICKED UP · 2 ORDERS" : `PICKED UP · ${ds[0].item}`, ds.length > 1 ? "Deliver both, in either order" : `→ ${ds[0].cust.label}${ds[0].surge ? " · SURGE ×1.5" : ""}${e.order.premium ? " · PREMIUM" : ""}`);
  }
  if (e.type === "fine") {
    toast("SPEED CAMERA −$6", `${mph(e.speed)} mph in a 35`);
    audio.sfx("shutter"); view.flashCamera(e.cam);
    $("flash").classList.add("on"); setTimeout(() => $("flash").classList.remove("on"), 60);
  }
  if (e.type === "delivered") {
    audio.sfx("kaching");
    if (e.late > 0 || e.stars < 4) audio.sfx("sad");
    if (e.left > 0) setTimeout(() => toast(`${e.left} MORE TO GO`, e.loyalty ? `loyalty +$${e.loyalty.toFixed(2)} · streak ${e.streak}` : ""), 1400);
    toast(`+$${e.earned.toFixed(2)}`, `${"★".repeat(e.stars)}${"☆".repeat(5 - e.stars)}  ${e.late > 0 ? `${e.late.toFixed(0)}s late` : `tip $${e.tip.toFixed(2)}`}${e.quality < 0.99 ? `  · ${Math.round((1 - e.quality) * 100)}% spilled` : ""}`);
  }
}

function toast(big, small = "") {
  $("toast").innerHTML = `${big}${small ? `<small>${small}</small>` : ""}`;
  $("toast").classList.add("show"); toastT = 1.8;
}
const fmt = (t) => `${t < 0 ? "-" : ""}${Math.floor(Math.abs(t) / 60)}:${String(Math.floor(Math.abs(t) % 60)).padStart(2, "0")}`;

// whooshes: passing close to lampposts, parked cars and traffic at speed, on the side you pass them
const passed = new Map();
function whooshes(speed) {
  if (speed < 11) return;
  const fx = Math.sin(car.h), fz = Math.cos(car.h), rx = -Math.cos(car.h), rz = Math.sin(car.h), now = performance.now();
  const check = (key, x, z) => {
    const dx = x - car.x, dz = z - car.z, along = dx * fx + dz * fz, lat = dx * rx + dz * rz;
    if (Math.abs(along) > 1.5 || Math.abs(lat) > 4.8 || Math.abs(lat) < 0.8) return;
    if (now - (passed.get(key) || 0) < 1500) return;
    passed.set(key, now);
    audio.sfx("whoosh", Math.sign(lat) * Math.min(1, Math.abs(lat) / 2.5), Math.min(1.3, (speed - 9) / 22) * (1.2 - Math.abs(lat) / 6));
  };
  city.near(car.x, car.z, 5, (o) => {
    if (o.kind === "pole" && !o.broken) check(o, o.x, o.z);
    else if (o.kind === "car" || o.kind === "tree") check(o, o.x0 !== undefined ? (o.x0 + o.x1) / 2 : o.x, o.z0 !== undefined ? (o.z0 + o.z1) / 2 : o.z);
  });
  for (const c of traffic.cars) if (Math.abs(c.x - car.x) < 7 && Math.abs(c.z - car.z) < 7) check(c, c.x, c.z);
  if (passed.size > 400) passed.clear();
}

function hud() {
  const o = shift.order;
  $("clock").textContent = fmt(Math.max(0, SHIFT.length - shift.t));
  $("money").textContent = run ? `$${shift.money.toFixed(2)} of $${billFor(run, run.day)} bill · day ${run.day}/${termOf(run)}` : `$${shift.money.toFixed(2)}`;
  $("money").style.color = run && run.cash + shift.money < billFor(run, run.day) ? "#ffb0a0" : "";
  $("rating").textContent = `★ ${rating(shift).toFixed(2)}${run && run.probation ? (rating(shift) < SHIFT.deactivate ? " · PROBATION: finish above 4.00" : " · PROBATION: above 4.00 ✓") : ""}`;
  $("rating").style.color = rating(shift) < 4.3 ? "#ff8a7a" : "#ffe07a";
  $("offers").style.display = o ? "none" : "block";
  $("orderbody").style.display = o ? "block" : "none";
  if (!o) {
    $("ophase").textContent = "CHOOSE AN ORDER"; $("ophase").className = "phase pickup";
    $("owhere").textContent = "Stop at any orange beacon";
    $("offers").innerHTML = shift.offers.map((of) => `<div class="offer${of.inZone ? " here" : ""}${of.premium ? " premium" : ""}"><span>${of.premium ? "★ " : ""}${KIND_ICON[of.kind] || "📦"} ${of.rest.sign}${of.stacked ? " ×2" : ""}${of.premium ? ' <i class="prem">PREMIUM</i>' : ""}</span><span>${dist(of.dist)}</span><b>$${of.est.toFixed(0)}${of.surge ? ' <i>SURGE</i>' : ""}</b></div>`).join("");
    const held = shift.offers.find((of) => of.hold > 0);
    $("stopping").firstElementChild.style.width = held ? `${Math.min(1, held.hold / SHIFT.stopHold) * 100}%` : "0%";
  }
  if (o) {
    const ds = o.drops, open = ds.filter((d) => !d.done);
    $("ophase").textContent = ds.length > 1 ? `DELIVER · ${open.length} OF ${ds.length} LEFT` : `DELIVER · ${ds[0].item.toUpperCase()}${o.premium ? " · PREMIUM" : ""}`;
    $("ophase").className = "phase dropoff";
    $("owhere").textContent = ds.length > 1 ? "" : ds[0].cust.label;
    // one row a drop-off: its number (beacon colour), what it is, where, its clock, its tip, its spill
    $("drops").innerHTML = ds.map((d, i) => {
      if (d.done) return "";
      const tip = d.left > 0 ? SHIFT.tipMax * (d.left / d.time) * (1 - d.spill) * shift.fx.tipMul * (d.premium ? SHIFT.premiumTip : 1) : 0;
      const spillable = d.kind === "drink" || d.fragile;
      return `<div class="drop"><b class="n n${i}">${i + 1}</b><span class="w">${KIND_ICON[d.kind] || "📦"} ${ds.length > 1 ? d.cust.label : ""}</span>
        <span class="t ${d.left < 0 ? "late" : d.left < 15 ? "warn" : ""}">${d.left >= 0 ? fmt(d.left) : "LATE " + fmt(-d.left)}</span><span class="tip">${d.left > 0 ? "$" + tip.toFixed(2) : "no tip"}</span>
        ${spillable ? `<span class="sp"><span style="width:${(1 - d.spill) * 100}%"></span></span>` : ""}</div>`;
    }).join("");
    const held = open.find((d) => d.hold > 0);
    $("stopping").firstElementChild.style.width = held ? `${Math.min(1, held.hold / SHIFT.stopHold) * 100}%` : "0%";
  }
  // turn-by-turn: the next manoeuvre and how far
  if (rt && running) {
    const nt = nextTurn(city, rt);
    $("turn").style.display = "flex";
    $("tarrow").textContent = { left: "↰", right: "↱", uturn: "↶", arrive: "◎" }[nt.dir];
    $("tdist").textContent = nt.dist < 15 ? (nt.dir === "arrive" ? "HERE" : "NOW") : dist(nt.dist);
    $("tonto").textContent = nt.dir === "arrive" ? (rt.dest?.label || rt.dest?.name || "") : nt.onto ? `onto ${nt.onto}` : "";
    $("turn").classList.toggle("soon", nt.dist < 45);
    // a chime once per turn as it comes up, panned to the side you'll turn to
    if (nt.at && nt.dist < 45 && nt.dist > 8) {
      const key = `${Math.round(nt.at[0])},${Math.round(nt.at[1])}`;
      if (key !== announced) { announced = key; audio.sfx("turn", nt.dir === "left" ? -0.8 : nt.dir === "right" ? 0.8 : 0); }
    }
  } else $("turn").style.display = "none";
  const kmh = Math.abs(car.u) * 2.23694;   // shown in mph (the name's historical)
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
  // the floating strip follows the thumb; it shows faintly where it'll appear when not held
  if (settings.pedalMode === "float") {
    const pd = $("pedal");
    if (st.pedPtr !== null) { pd.style.left = `${st.pedX - 46}px`; pd.style.top = `${st.pedTop}px`; pd.style.opacity = 1; }
    else { pd.style.left = ""; pd.style.top = ""; pd.style.opacity = 0.25; }
  }
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
  // the lawns outside the bends, then the streets over them (polylines: Broadway, the bends)
  g.fillStyle = "#6dbb55";
  for (const l of city.lawns) {
    g.beginPath(); g.moveTo(bx(l.K[0]), bz(l.K[1]));
    for (let k = 0; k <= 24; k++) { const th = l.th0 + ((l.th1 - l.th0) * k) / 24; g.lineTo(bx(l.cx + 64 * Math.cos(th)), bz(l.cz + 64 * Math.sin(th))); }
    g.fill();
  }
  g.strokeStyle = "#7d8088"; g.lineWidth = CURB * 2 * mscale; g.lineCap = "square"; g.lineJoin = "round";
  for (const e of city.edges) {
    g.beginPath();
    e.pts.forEach(([x, z], i) => (i ? g.lineTo(bx(x), bz(z)) : g.moveTo(bx(x), bz(z))));
    g.stroke();
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
  // today: the surge zone, barricaded streets, cameras
  const plan = shift.plan;
  mctx.fillStyle = "#c9ced6";
  for (const c of traffic.cars) { mctx.beginPath(); mctx.arc(bx(c.x), bz(c.z), 3.2, 0, 7); mctx.fill(); }
  if (plan.surge) { mctx.fillStyle = "rgba(255,59,208,.28)"; mctx.fillRect(bx(plan.surge.x0), bz(plan.surge.z0), (plan.surge.x1 - plan.surge.x0) * mscale, (plan.surge.z1 - plan.surge.z0) * mscale); }
  mctx.strokeStyle = "#ff4a3a"; mctx.lineWidth = 7;
  for (const e of plan.closed || []) { const a = pointAt(e, e.len * 0.2), b = pointAt(e, e.len * 0.8); mctx.beginPath(); mctx.moveTo(bx(a.x), bz(a.z)); mctx.lineTo(bx(b.x), bz(b.z)); mctx.stroke(); }
  mctx.fillStyle = "#ffd23a";
  for (const c of plan.cameras || []) { mctx.beginPath(); mctx.arc(bx(c.cx), bz(c.cz), 5, 0, 7); mctx.fill(); }
  if (rt) {
    mctx.strokeStyle = "#28dcff"; mctx.lineWidth = 6; mctx.lineJoin = "round"; mctx.beginPath();
    rt.points.forEach(([x, z], i) => (i ? mctx.lineTo(bx(x), bz(z)) : mctx.moveTo(bx(x), bz(z))));
    mctx.stroke();
  }
  mctx.restore();
  // the destination: on the map if it's in range, otherwise pinned to the rim pointing at it
  const o = shift.order;
  const marks = o ? o.drops.map((d, i) => [d, i]).filter(([d]) => !d.done).map(([d, i]) => [d.cust, DROP_CSS[i]])
    : shift.offers.map((of) => [of.rest, of.premium ? "#ffd23a" : of.surge ? "#ff3bd0" : "#ffa31a", of.premium]);
  for (const [p, colr, star] of marks) {
    const dx = p.x - car.x, dz = p.z - car.z, ang = car.h - Math.PI;
    let sx = (dx * Math.cos(ang) - dz * Math.sin(ang)) * mscale, sz = (dx * Math.sin(ang) + dz * Math.cos(ang)) * mscale;
    const r = Math.hypot(sx, sz), lim = c - 10;
    if (r > lim) { sx *= lim / r; sz *= lim / r; }
    mctx.fillStyle = colr;
    mctx.beginPath();
    // premium: a big gold star, not a dot
    if (star) for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? 6.5 : 15; mctx.lineTo(c + sx + Math.cos(a) * rr, c + sz + Math.sin(a) * rr); }
    else mctx.arc(c + sx, c + sz, 9, 0, 7);
    mctx.closePath(); mctx.fill();
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
  const k = 0;   // retired 2026-10-05: 3D streaks in the renderer replace this overlay
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
  for (const e of events) {
    if (e.type === "wall") { audio.sfx("thump", e.speed); if (e.speed > 2.5 && shift) shift.hits = (shift.hits || 0) + 1; }
    if (e.type === "pole") audio.sfx("clang");
    if (e.type === "reset") audio.sfx("reset");
  }
  music?.setMix(Math.min(1, pose.speed / 28));   // hats and arps push harder with speed
  if (running) whooshes(pose.speed);
  audio.update({ running, speed: pose.speed, u: car.u, throttle: inp.throttle || 0, brake: inp.brake || 0, slipF: car.slipF, slipR: car.slipR, off: car.off, reverse: car.reverse, cond: car.cond }, dt);
  if (running && o) {
    const open = o.drops.filter((d) => !d.done);
    if (open.length) audio.clock(Math.min(...open.map((d) => d.left)));
    audio.spill(o.drops.reduce((a, d) => a + d.spill, 0));
  }
  view.drawTraffic(traffic.cars, running ? a : 1, traffic.time);
  view.frame(pose, dt, events, {
    route: running && rt,
    pickups: o ? [] : shift.offers.map((of) => ({ x: of.rest.x, z: of.rest.z, inZone: of.inZone })),
    dropoffs: o ? o.drops.map((d) => (d.done ? null : { x: d.cust.x, z: d.cust.z, inZone: d.inZone, left: d.left, kind: d.kind })) : [],
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
    <div class="muted">Pick up at the orange beacon, deliver to the green one: stop inside the circle. Tips drain while the clock runs; drinks spill if you throw the car around. One shift a day, then the car payment comes out, and it goes up every day. Miss it and the car's repossessed; make the last one and the car is yours. Finish a day with your rating under 4.0 and you're on probation; do it twice running and you're deactivated. The blue line is the GPS; the alleys, the lot and the park are faster, and it doesn't know them.</div>
    <div class="stats"><div><b>${best.days ? `${best.days} days` : "–"}</b><span>BEST RUN</span></div><div><b>${best.earned ? money(best.earned) : "–"}</b><span>MOST EARNED</span></div><div><b>${Object.keys(best.paid).length}/${CAR_ORDER.length}</b><span>CARS PAID OFF</span></div></div>
    <div class="row">${run && !run.over ? `<button class="go" data-act="continue">CONTINUE · DAY ${run.day}</button> <button class="sm" data-act="newrun">New run</button>` : `<button class="go" data-act="newrun">START RUN</button>`}</div>`;
}

// what today brings, shown in the garage before the shift
function forecastHtml() {
  const plan = dayPlan(city, run.seed, run.day);
  const newKind = run.day === 2 ? "Drinks: they spill if you throw the car around." : run.day === 4 ? "Cakes from Sugar Rush Bakery: they hate hard braking and knocks." : null;
  const rows = plan.conds.map((c) => {
    const d = CONDITIONS[c];
    return `<div>${d.minDay === run.day ? '<span class="new">NEW</span>' : ""}<b class="${d.good ? "good" : ""}">${d.name}</b>${d.desc}</div>`;
  });
  if (newKind) rows.unshift(`<div><span class="new">NEW</span><b>New orders</b>${newKind}</div>`);
  return `<b>Today</b><div class="forecast">${rows.length ? rows.join("") : "<div>A quiet one. Clear skies, open roads.</div>"}</div>`;
}

function garageScreen(last) {
  const { fx } = effects(run);
  const fixTo = (t) => repairCost(run, t);
  const r = avgRating(run.ratings);
  const offers = run.offers.map((id) => {
    const m = modById[id];
    return `<div class="mod${previewMod === id ? " previewing" : ""}" data-act="preview" data-id="${id}"><span class="tag ${m.kind}">${m.kind === "perf" ? "PERFORMANCE" : m.kind === "cargo" ? "CARGO" : m.kind === "biz" ? "MONEY" : "STYLE"}</span><b>${m.name}</b><span class="d">${m.desc}</span>
      <button data-act="buy" data-id="${id}" ${m.price > run.cash ? "disabled" : ""}>${money(m.price)}</button>${previewMod === id ? '<span class="d" style="color:#ffd27a">Previewing on your car</span>' : ""}</div>`;
  }).join("") || `<div class="muted">Sold out.</div>`;
  const po = payoffCost(run), left = termOf(run) - run.day + 1;
  return `<h2 class="big">DAY ${run.day} OF ${termOf(run)} · GARAGE <small style="font-size:14px;opacity:.7">${carOf(run).name}</small></h2>
    ${last ? `<div class="muted">Yesterday: ${last.jobs} deliveries, earned ${money(last.earned)}, car payment ${money(last.bill)}.</div>` : ""}
    ${run.probation ? `<div style="color:#ffb0a0;font-size:13px;margin:4px 0">⚠ PROBATION: your rating finished under 4.0. Finish today under it again and you're deactivated.</div>` : ""}
    <div class="stats"><div><b>${money(run.cash)}</b><span>CASH</span></div><div><b>${money(billFor(run, run.day))}</b><span>PAYMENT AFTER TODAY</span></div><div><b>★ ${r.toFixed(2)}</b><span>RATING</span></div></div>
    <div class="repair"><b>Loan</b> <span class="muted">${left === 1 ? "Today's payment is the last one." : `${left} payments left, today's included.`}</span>
      <button class="sm" data-act="payoff" ${po > run.cash ? "disabled" : ""}>Pay it off now ${money(po)}</button>
      <span class="muted">${Math.round(ECON.payoffDiscount * 100)}% off for paying early: you skip the interest.</span></div>
    ${forecastHtml()}
    <div class="repair"><b>Car ${Math.round(run.cond * 100)}%</b> ${condBar(run.cond)}
      ${run.cond < 0.995 ? `<button class="sm" data-act="repair" data-to="${Math.min(1, run.cond + 0.25)}" ${fixTo(Math.min(1, run.cond + 0.25)) > run.cash ? "disabled" : ""}>Patch +25% ${money(fixTo(Math.min(1, run.cond + 0.25)))}</button>
        <button class="sm" data-act="repair" data-to="1" ${fixTo(1) > run.cash ? "disabled" : ""}>Full repair ${money(fixTo(1))}</button>` : `<span class="muted">mint</span>`}
      <span class="muted">${run.cond < 0.6 ? "A beaten car loses power." : ""}${fx.repairMul < 1 ? " Dash cam discount applied." : ""}</span></div>
    <div class="row" style="justify-content:space-between"><b>Shop</b> <button class="sm" data-act="reroll" ${rerollCost(run) > run.cash ? "disabled" : ""}>Reroll ${money(rerollCost(run))}</button></div>
    <div class="shop">${offers}</div>
    ${run.mods.length ? `<div class="chips">${run.mods.map((id) => `<span class="chip">${modById[id].name}</span>`).join("")}</div>` : ""}
    <details><summary>Run report so far</summary><textarea id="report" readonly style="width:100%;height:90px;font:11px/1.35 ui-monospace,monospace;background:#0e1116;color:#cfe0ff;border:1px solid #333;border-radius:8px;padding:6px">${runReport(run)}</textarea>
      <div class="row"><button class="sm" data-act="copyreport">Copy report</button> <span class="muted" id="copied"></span></div></details>
    <div class="row"><button class="go" data-act="start">START DAY ${run.day}</button> <button class="sm" data-act="title">Title</button></div>`;
}

function overScreen() {
  const won = run.over === "paid";
  const why = won ? ["PAID OFF", `The ${carOf(run).name.toLowerCase()} is yours${run.paidEarly ? `, ${termOf(run) - run.day + 1} ${termOf(run) - run.day ? "days" : "day"} early` : ""}. The app still takes its 30%.`]
    : run.over === "repo" ? ["REPOSSESSED", "You couldn't make the car payment. The tow truck didn't even honk."]
    : ["DEACTIVATED", "\"We've noticed your recent ratings don't meet our community standards.\""];
  const last = run.log[run.log.length - 1];
  return `<h2 class="big"${won ? ' style="color:#9ee08a"' : ""}>${why[0]}</h2><div class="muted">${why[1]}</div>
    <div class="stats"><div><b>${daysOf(run)}</b><span>DAYS</span></div><div><b>${money(run.earned)}</b><span>EARNED</span></div><div><b>${run.mods.length}</b><span>MODS</span></div>${last ? `<div><b>${money(last.earned)}</b><span>LAST SHIFT</span></div>` : ""}</div>
    <details><summary>Last shift</summary><table><tr><th>Order</th><th>To</th><th>Earned</th><th>Tip</th><th>Stars</th><th>Spilled</th></tr>
    ${shift.log.map((l) => `<tr><td>${l.item}</td><td>${l.to}</td><td>$${l.earned.toFixed(2)}</td><td>$${l.tip.toFixed(2)}</td><td>${l.stars.toFixed(1)}</td><td>${Math.round((1 - l.quality) * 100)}%</td></tr>`).join("")}</table></details>
    <details open><summary>Run report (copy and paste it into the chat for balancing)</summary>
      <textarea id="report" readonly style="width:100%;height:120px;font:11px/1.35 ui-monospace,monospace;background:#0e1116;color:#cfe0ff;border:1px solid #333;border-radius:8px;padding:6px">${runReport(run)}</textarea>
      <div class="row"><button class="sm" data-act="copyreport">Copy report</button> <span class="muted" id="copied"></span></div></details>
    <div class="row"><button class="go" data-act="newrun">NEW RUN</button> <button class="sm" data-act="title">Title</button></div>`;
}

let curScreen = "title", lastDay = null, previewMod = null;
function show(which) {
  curScreen = which;
  music?.setMuffled(true);   // menus and the garage: the music through the wall
  // the garage: the shop becomes a panel on the right, your car on a turntable on the left
  const g = which === "garage" && !!run;
  $("menu").classList.toggle("garage", g);
  document.body.classList.toggle("garage-on", g);
  if (!g) previewMod = null;
  view.showGarage(g, run?.car || "liftback", run?.mods || [], previewMod);
  const keep = $("menu").querySelector(".card").scrollTop;
  $("screen").innerHTML = which === "garage" ? garageScreen(lastDay) : which === "over" ? overScreen() : which === "pause" ? pauseScreen() : which === "cars" ? carsScreen() : titleScreen();
  renderSettings();
  $("menu").classList.remove("hidden");
  if (g) $("menu").querySelector(".card").scrollTop = keep;
}
// pick a car: it sets the run's physics, toughness and payment curve (cars.js)
// the newer cars unlock by paying another one off; ?cars=all unlocks them for testing (not saved)
const ALL_CARS = new URLSearchParams(location.search).get("cars") === "all";
const unlocked = (id) => ALL_CARS || !CARS[id].unlock || !!best.paid[CARS[id].unlock];
function carsScreen() {
  const pips = (n) => `<span style="letter-spacing:2px;color:#ffd27a">${"●".repeat(n)}<span style="opacity:.25">${"●".repeat(5 - n)}</span></span>`;
  const TAG = { hauler: "cargo", kei: "cargo", roadster: "silly", rally: "silly" };
  const cards = CAR_ORDER.map((id) => {
    const c = CARS[id], open = unlocked(id);
    return `<div class="mod"${open ? "" : ' style="opacity:.55"'}><span class="tag ${TAG[id] || "perf"}">${c.kind.toUpperCase()}</span><b>${open ? "" : "🔒 "}${c.name}</b>
      <span class="d">${c.blurb}</span>
      <span class="d">Speed ${pips(c.stats.speed)}<br>Grip ${pips(c.stats.grip)}<br>Toughness ${pips(c.stats.toughness)}<br>Cargo ${pips(c.stats.cargo)}</span>
      <span class="d">Loan: ${c.term} days. Payments $${c.bill(1)} → $${c.bill(Math.ceil(c.term / 2))} → $${c.bill(c.term)}</span>
      ${best.paid[id] ? `<span class="d" style="color:#9ee08a">✓ Paid off in ${best.paid[id]} days</span>` : ""}
      ${open ? `<button data-act="pick" data-car="${id}">DRIVE THIS</button>` : `<button disabled>Pay off the ${CARS[c.unlock].name} to unlock</button>`}</div>`;
  }).join("");
  return `<h2 class="big">PICK YOUR CAR</h2><div class="muted">It's yours for the whole run, payments and all.</div>
    <div class="shop" style="grid-template-columns:repeat(3,1fr)">${cards}</div>
    <div class="row"><button class="sm" data-act="title">Back</button></div>`;
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
  const float = settings.pedalMode === "float";
  document.querySelectorAll(".pm").forEach((b) => b.classList.toggle("sel", b.dataset.pm === settings.pedalMode));
  $("pedzone").style.display = float ? "block" : "none";
  $("pedal").classList.toggle("float", float);
  if (!float) { $("pedal").style.left = ""; $("pedal").style.top = ""; $("pedal").style.opacity = 1; }
  $("volume").value = settings.volume; $("volumeV").textContent = Math.round(settings.volume * 100) + "%";
  document.querySelectorAll(".mu").forEach((b) => b.classList.toggle("sel", b.dataset.mu === settings.music));
  document.querySelectorAll(".mo").forEach((b) => b.classList.toggle("sel", (b.dataset.mo === "1") === settings.motion));
  view.setMotion(settings.motion);
  $("musicVol").value = settings.musicVol; $("musicVolV").textContent = Math.round(settings.musicVol * 100) + "%";
  syncMusic();
  audio.setVolume(settings.volume);
}
$("screen").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]") || e.target.closest(".mod[data-act]");
  if (!b) return;
  const act = b.dataset.act;
  if (act === "newrun") { show("cars"); return; }
  if (act === "pick" && !unlocked(b.dataset.car)) return;
  if (act === "pick") { run = makeRun(undefined, b.dataset.car); rollOffers(run); persist(); newShift(); start(); return; }
  if (act === "continue") { lastDay = run.log[run.log.length - 1] || null; show(run.log.length ? "garage" : "title"); if (!run.log.length) { newShift(); start(); } return; }
  if (act === "start") { newShift(); start(); return; }
  if (act === "resume") { start(); return; }
  if (act === "abandon") { shift.over = "abandoned"; running = false; endShift(); return; }
  if (act === "title") { show("title"); return; }
  if (act === "copyreport") {
    // the clipboard API needs HTTPS; on plain http select the text so the phone's copy menu appears
    const ta = $("report"); ta.focus(); ta.select();
    (navigator.clipboard?.writeText(ta.value) ?? Promise.reject()).then(() => { $("copied").textContent = "Copied"; }, () => { document.execCommand?.("copy"); $("copied").textContent = "Selected: copy it from your phone's menu"; });
    return;
  }
  if (act === "preview") { previewMod = previewMod === b.dataset.id ? null : b.dataset.id; show("garage"); return; }
  if (act === "buy" && buy(run, b.dataset.id)) { audio.sfx("buy"); previewMod = null; }
  if (act === "reroll" && reroll(run)) audio.sfx("tick", false);
  if (act === "repair" && repair(run, +b.dataset.to)) audio.sfx("repair");
  if (act === "payoff" && payOff(run)) { audio.sfx("kaching"); recordBest(); persist(); show("over"); return; }
  persist();
  show("garage");
});
document.querySelectorAll(".pm").forEach((b) => b.addEventListener("click", () => { settings.pedalMode = b.dataset.pm; saveSettings(settings); renderSettings(); }));
$("modes").addEventListener("click", (e) => {
  const b = e.target.closest(".mode[data-m]");
  if (!b) return;
  settings.mode = b.dataset.m; saveSettings(settings); renderSettings();
});
document.querySelectorAll(".mo").forEach((b) => b.addEventListener("click", () => { settings.motion = b.dataset.mo === "1"; saveSettings(settings); renderSettings(); }));
document.querySelectorAll(".mu").forEach((b) => b.addEventListener("click", () => { settings.music = b.dataset.mu; saveSettings(settings); audio.resume(); renderSettings(); }));
for (const id of ["dragRange", "dragDead", "dragCurve", "pedalH", "volume", "musicVol"]) {
  $(id).addEventListener("input", (e) => { settings[id] = +e.target.value; saveSettings(settings); renderSettings(); });
}
$("pause").addEventListener("click", pause);
{
  let dragX = null;
  $("menu").addEventListener("pointerdown", (e) => { if (e.target === $("menu") && curScreen === "garage") { dragX = e.clientX; $("menu").setPointerCapture(e.pointerId); } });
  $("menu").addEventListener("pointermove", (e) => { if (dragX !== null) { view.garageDrag(e.clientX - dragX); dragX = e.clientX; } });
  const end = () => { dragX = null; };
  $("menu").addEventListener("pointerup", end); $("menu").addEventListener("pointercancel", end);
}
addEventListener("keydown", (e) => {
  if (e.code === "Escape") { if (running) pause(); else if (curScreen === "pause") start(); }
  if (e.code === "KeyR" && running) resetCityCar(car, city);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { if (running) pause(); audio.suspend(); }
  else if (audio.ready) audio.resume();
});

async function start() {
  if (matchMedia("(pointer: coarse)").matches && !document.fullscreenElement) {
    try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); await screen.orientation?.lock?.("landscape"); } catch {}
  }
  $("menu").classList.add("hidden");
  // out of the garage: back to the street camera and the HUD
  $("menu").classList.remove("garage"); document.body.classList.remove("garage-on");
  view.showGarage(false); curScreen = "drive";
  input.release();
  audio.resume(); audio.setVolume(settings.volume);
  syncMusic(); music?.setMuffled(false);
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
  recordBest();
  if (run.over === "paid") audio.sfx("kaching");
  persist();
  show(run.over ? "over" : "garage");
}
// days driven (paying off early happens in the garage, before that day's shift)
const daysOf = (run) => (run.over && !run.paidEarly ? run.day : run.day - 1);
function recordBest() {
  const days = daysOf(run);
  best.days = Math.max(best.days, days); best.earned = Math.max(best.earned, run.earned);
  if (run.over === "paid") best.paid[run.car] = Math.min(best.paid[run.car] || Infinity, days);
  try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch {}
}

addEventListener("resize", () => { view.resize(); sizeLines(); });
view.resize(); sizeLines();
newShift();
show("title");
requestAnimationFrame(loop);

window.__lm = { get car() { return car; }, get shift() { return shift; }, city, input, settings, start, info: () => view.info(), audio, view, traffic };
