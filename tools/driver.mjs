// The courier bot's driving, shared by citybot (single shifts) and runbot (whole runs): follows the
// GPS line with pure pursuit and plans its speed for the turns ahead.
import { route } from "../src/city/gps.js";
import { stepCityCar } from "../src/city/world.js";
import { stepShift } from "../src/city/shift.js";

/** Drive one shift to the end. p: the car's physics (mods applied). log(msg) for --why output. */
export function driveShift(city, car, sh, p, log = null, traffic = null, stats = null) {
  let rt = null, rtT = 0, walls = 0, poles = 0, resets = 0, tick = 0;
  while (!sh.over) {
    stepShift(sh, city, car);
    for (const e of sh.events) {
      if (e.type === "delivered" && log) log(`  delivered ${e.item} to ${e.to}: $${e.earned.toFixed(2)} (tip ${e.tip.toFixed(2)}) ${"*".repeat(Math.round(e.stars))} late ${e.late.toFixed(1)}s quality ${(e.quality * 100).toFixed(0)}%`);
    }
    const o = sh.order;
    if (!o) continue;
    const target = o.phase === "pickup" ? o.rest : o.cust;
    if (!rt || tick - rtT > 15) { rt = route(city, car.x, car.z, car.h, target, Math.max(0, car.u), rt?.target === target ? rt : null); rt.target = target; rtT = tick; }
    // pure pursuit along the polyline
    const s = Math.hypot(car.vx, car.vz), look = 6 + s * 0.5;
    let px = target.x, pz = target.z, acc = 0, found = false, turnAt = Infinity, turnAng = 0;
    const pts = rt.points;
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az) || 1e-6;
      const t = Math.max(0, Math.min(1, ((car.x - ax) * (bx - ax) + (car.z - az) * (bz - az)) / (L * L)));
      const d = Math.hypot(car.x - (ax + (bx - ax) * t), car.z - (az + (bz - az) * t));
      if (d < bestD) { bestD = d; bestI = i; }
    }
    for (let i = bestI; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
      const startD = i === bestI ? Math.hypot(car.x - ax, car.z - az) : 0;
      if (!found && acc + L - startD > look) {
        const f = (look - acc + startD) / L;
        px = ax + (bx - ax) * f; pz = az + (bz - az) * f; found = true;
      }
      acc += L - startD;
      if (i + 2 < pts.length && turnAt === Infinity) {
        const [cx, cz] = pts[i + 2];
        const a1 = Math.atan2(bx - ax, bz - az), a2 = Math.atan2(cx - bx, cz - bz);
        const ang = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
        if (ang > 0.3) { turnAt = acc; turnAng = ang; }
      }
    }
    const remaining = acc;
    const ang = Math.atan2(px - car.x, pz - car.z);
    const err = Math.atan2(Math.sin(car.h - ang), Math.cos(car.h - ang));
    const steer = Math.max(-1, Math.min(1, err * 2.5));
    // speed: slow for turns and for the stop at the end; gentler with drinks aboard
    const careful = o.kind === "drink" && o.phase === "dropoff" ? 0.75 : 1;
    const vTurn = (turnAng > 0 ? 7 + (Math.PI - turnAng) * 2 : 40) * careful;
    const brakeG = 0.7 * p.brakeMax * 9.81 * careful;
    let vt = Math.min(40, Math.sqrt(vTurn * vTurn + 2 * brakeG * Math.max(0, turnAt - 4)), Math.sqrt(2 * brakeG * Math.max(0, remaining - 2)));
    // traffic: don't drive into the car in front (this bot never overtakes: a cautious baseline),
    // and yield at a junction that has traffic in it or crossing toward it
    if (traffic) {
      const node = city.nodes.reduce((b, n) => (Math.hypot(n.x - car.x, n.z - car.z) < Math.hypot(b.x - car.x, b.z - car.z) ? n : b));
      const toNode = Math.hypot(node.x - car.x, node.z - car.z), ahead = (node.x - car.x) * Math.sin(car.h) + (node.z - car.z) * Math.cos(car.h) > 4;
      if (ahead && toNode < 28 && toNode > 10) {
        const busy = traffic.cars.some((c) => {
          const dx = c.x - node.x, dz = c.z - node.z;
          if (Math.abs(dx) < 8.5 && Math.abs(dz) < 8.5) return true;   // in the junction square
          const cv = c.mode === "drive" ? c.v : 0, toward = -(dx * Math.sin(c.h) + dz * Math.cos(c.h));
          return cv > 1.5 && toward > 0 && Math.hypot(dx, dz) < 10 + cv * 2.2 && Math.abs(Math.sin(c.h - car.h)) > 0.7;
        });
        if (busy) { vt = Math.min(vt, Math.max(0, toNode - 13) * 1.2); if (stats) stats.why = "yield"; }
      }
      const fx = Math.sin(car.h), fz = Math.cos(car.h), rx = -fz, rz = fx, look = 8 + s * 1.5;
      for (const c of traffic.cars) {
        const dx = c.x - car.x, dz = c.z - car.z, along = dx * fx + dz * fz, lat = dx * rx + dz * rz;
        if (along > 0 && along < look && Math.abs(lat) < 2.6) {
          const cv = c.mode === "drive" ? c.v : 0;
          const lim = Math.max(0, along - 7) * 1.0 + cv * 0.8;
          if (lim < vt) { vt = lim; if (stats) stats.why = c.mode === "drive" ? "following" : "wreck ahead"; }
        }
      }
    }
    if (o.inZone) vt = 0;
    const inp = {
      steer,
      throttle: Math.max(0, Math.min(1, (vt - s) / 3 + 0.2)) * (Math.abs(car.slipR) > 0.1 ? 0.4 : 1),
      brake: s > vt + 0.5 ? Math.min(1, (s - vt) / 4 + 0.2) : vt === 0 ? 1 : 0,
    };
    if (vt === 0 && s < 0.6) inp.brake = 0.3;   // don't hold it so long that reverse engages
    if (stats) { const k = (s < 1 ? "" : s < 5 ? "slow:" : "move:") + (o.inZone ? "zone" : stats.why || "other"); stats[k] = (stats[k] || 0) + 1; stats.why = null; stats.ticks = (stats.ticks || 0) + 1; }
    stepCityCar(car, inp, city, p);
    if (traffic) traffic.step(car, p, sh.plan.traffic);
    tick++;
    for (const e of car.events) {
      if (e.type === "wall") { walls++; log?.(`  wall ${e.speed.toFixed(1)} m/s at (${car.x.toFixed(0)}, ${car.z.toFixed(0)})`); }
      if (e.type === "pole") poles++;
      if (e.type === "reset") { resets++; log?.(`  reset at (${car.x.toFixed(0)}, ${car.z.toFixed(0)})`); }
    }
  }
  return { walls, poles, resets };
}
