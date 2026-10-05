// The courier bot's driving, shared by citybot (single shifts) and runbot (whole runs): follows the
// GPS line with pure pursuit and plans its speed for the turns ahead.
// Two policies (2026-10-05, user: "more signal out of the bot with overtaking and a more greedy
// strategy"): smart (default) picks orders by dollars per second, delivers the most urgent drop
// first, picks its own lane by free road ahead (so it overtakes), and slows for speed cameras and with
// fragile cargo; simple (opts.simple) is the old cautious baseline: nearest offer, nearest drop, one lane.
// opts.oncoming also passes in the oncoming lane: over 12 seeds it earned no more and crashed more
// (2026-10-05), so it's off by default.
import { route } from "../src/city/gps.js";
import { buildShortcuts, planRoute } from "./shortcuts.mjs";
import { stepCityCar } from "../src/city/world.js";
import { stepShift } from "../src/city/shift.js";

/** Drive one shift to the end. p: the car's physics (mods applied). log(msg) for --why output. */
const V_EST = 11, STOP_EST = 6;   // the smart bot's guess at its average speed (m/s) and seconds per stop
// lanes, as offsets from the GPS line (which sits between our two lanes; + is right): our inner and
// outer lanes, and the oncoming inner lane for passing
const LANE_OPTS = [-2, 2, -6];
// the sidewalk (kerb at 8 m from the centreline, buildings at 14; the line is at 4): 6 m of paving,
// lampposts along its kerb edge every 16 m
const WALK = 7, POLE_LAT = 4.6;

export function driveShift(city, car, sh, p, log = null, traffic = null, stats = null, opts = {}) {
  // shortcuts (tools/shortcuts.mjs) are opt-in: they didn't pay for the bot (2026-10-05: same jobs with
// empty streets, fewer and more wall hits in day-9 traffic)
  const smart = !opts.simple, useShortcuts = smart && !!opts.shortcuts;
  const shortcuts = useShortcuts ? (city._shortcuts ||= buildShortcuts(city)) : null;
  let lastBestI = 0, shortcutsTaken = 0;
  let rt = null, rtT = 0, walls = 0, poles = 0, resets = 0, tick = 0, chosen = null, laneT = 2, laneOff = 0, passes = 0, laneSince = 0, walks = 0, turnAtLast = Infinity, rightT = 0, turnLeftLast = false, remLast = 0, steerLast = 0;
  const rlen = (target) => route(city, car.x, car.z, car.h, target).length;
  // dollars per second for an offer: what the app advertises over getting there + doing the drops
  const rate = (of) => {
    let d = rlen(of.rest), from = of.rest;
    const ds = of.drops.slice().sort((a, b) => a.dist - b.dist);
    for (const dr of ds) { d += Math.hypot(dr.cust.x - from.x, dr.cust.z - from.z) * 1.25; from = dr.cust; }
    return of.est / (d / V_EST + STOP_EST * (1 + ds.length));
  };
  while (!sh.over) {
    stepShift(sh, city, car);
    for (const e of sh.events) {
      if (e.type === "delivered" && log) log(`  delivered ${e.item} to ${e.to}: $${e.earned.toFixed(2)} (tip ${e.tip.toFixed(2)}) ${"*".repeat(Math.round(e.stars))} late ${e.late.toFixed(1)}s quality ${(e.quality * 100).toFixed(0)}%`);
    }
    // no order yet: take the nearest offer by street distance (a simple policy; a player can do better)
    let o = sh.order, target;
    // carrying: the nearest drop-off still to do (smart: the one whose clock is tightest, if it's tight)
    if (o) {
      const ds = o.drops.filter((d) => !d.done);
      if (smart && ds.length > 1 && tick % 30 === 0) {
        const slack = (d) => d.left - rlen(d.cust) / V_EST;
        const [a, b] = ds.slice().sort((x, y) => slack(x) - slack(y));
        o.next = slack(a) < 20 ? a : rlen(a.cust) <= rlen(b.cust) ? a : b;
      }
      o = smart && o.next && !o.next.done && ds.length > 1 ? o.next : ds.reduce((b, d) => (Math.hypot(d.cust.x - car.x, d.cust.z - car.z) < Math.hypot(b.cust.x - car.x, b.cust.z - car.z) ? d : b));
      target = o.cust; o.phase = "dropoff";
    } else {
      if (!sh.offers.length) continue;
      if (!chosen || !sh.offers.includes(chosen)) chosen = smart ? sh.offers.reduce((b, of) => (rate(of) > rate(b) ? of : b)) : sh.offers.reduce((b, of) => (rlen(of.rest) < rlen(b.rest) ? of : b));
      o = chosen; target = o.rest;
    }
    if (useShortcuts) {
      // with the shortcuts: plan the whole way (maybe via one); re-plan off the shortcut, never on it
      const onShortcut = rt?.caps && (rt.caps[lastBestI] < Infinity || rt.caps[lastBestI + 1] < Infinity);
      if (!rt || rt.target !== target || (!onShortcut && tick - rtT > 15)) {
        const pl = planRoute(city, shortcuts, car, target, Math.max(0, car.u));
        if (pl.sc && pl.sc !== rt?.sc) { shortcutsTaken++; log?.(`  shortcut: ${pl.sc.kind} (${pl.sc.A.x.toFixed(0)},${pl.sc.A.z.toFixed(0)}) → (${pl.sc.B.x.toFixed(0)},${pl.sc.B.z.toFixed(0)})`); }
        rt = { points: pl.pts, caps: pl.caps, sc: pl.sc, target }; rtT = tick;
      }
    } else if (!rt || tick - rtT > 15) { rt = route(city, car.x, car.z, car.h, target, Math.max(0, car.u), rt?.target === target ? rt : null); rt.target = target; rtT = tick; }
    // pure pursuit along the polyline
    const s = Math.hypot(car.vx, car.vz), look = 6 + s * 0.5;
    let px = target.x, pz = target.z, acc = 0, found = false, turnAt = Infinity, turnAng = 0, turnLeft = false;
    const pts = rt.points;
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az) || 1e-6;
      const t = Math.max(0, Math.min(1, ((car.x - ax) * (bx - ax) + (car.z - az) * (bz - az)) / (L * L)));
      const d = Math.hypot(car.x - (ax + (bx - ax) * t), car.z - (az + (bz - az) * t));
      if (d < bestD) { bestD = d; bestI = i; }
    }
    lastBestI = bestI;
    let capV = Infinity, capNear = Infinity;   // shortcut speed caps ahead (dumpsters, parked cars, grass)
    for (let i = bestI; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
      const startD = i === bestI ? Math.hypot(car.x - ax, car.z - az) : 0;
      if (rt.caps && rt.caps[i] < Infinity) { const d0 = i === bestI ? 0 : acc; capNear = Math.min(capNear, d0); capV = Math.min(capV, Math.sqrt(rt.caps[i] ** 2 + 2 * 6 * Math.max(0, d0 - 3))); }
      if (!found && acc + L - startD > look) {
        const f = (look - acc + startD) / L;
        px = ax + (bx - ax) * f; pz = az + (bz - az) * f; found = true;
      }
      acc += L - startD;
      if (i + 2 < pts.length && turnAt === Infinity) {
        const [cx, cz] = pts[i + 2];
        const a1 = Math.atan2(bx - ax, bz - az), a2 = Math.atan2(cx - bx, cz - bz);
        const da = Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)), ang = Math.abs(da);
        if (ang > 0.3) { turnAt = acc; turnAng = ang; turnLeft = da > 0; }
      }
    }
    // smart: into a right turn, aim at the corner itself, not past it (pure pursuit would cut across
    // the kerb into the corner lamppost); it swings in once it's there
    if (smart && process.env.AIM && turnAng > 0.6 && !turnLeft && turnAt < look && turnAt > 1) {
      let want = turnAt + 1, a2 = 0;
      for (let i = bestI; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
        const st = i === bestI ? Math.hypot(car.x - ax, car.z - az) : 0;
        if (a2 + L - st >= want) { const f = (want - a2 + st) / L; px = ax + (bx - ax) * f; pz = az + (bz - az) * f; break; }
        a2 += L - st;
      }
    }
    const remaining = acc; turnAtLast = turnAt; turnLeftLast = turnLeft; remLast = remaining;
    // smart: which lane? where the car sits across the line now, then the lane with the most free road
    if (smart) {
      const [ax, az] = pts[bestI], [bx, bz] = pts[Math.min(bestI + 1, pts.length - 1)], L = Math.hypot(bx - ax, bz - az) || 1;
      const sdx = (bx - ax) / L, sdz = (bz - az) / L, myLat = (car.x - ax) * -sdz + (car.z - az) * sdx;
      const fx = Math.sin(car.h), fz = Math.cos(car.h);
      // turns and stops coming up: back onto the line (it plans the corner and ends at the kerb stop);
      // it straddles both lanes there, so the following check below watches both
      const free = (off) => {
        let room = 140;
        for (const c of traffic?.cars || []) {
          const dx = c.x - car.x, dz = c.z - car.z, along = dx * sdx + dz * sdz, lat = dx * -sdz + dz * sdx + myLat;
          if (Math.abs(lat - off) > 2.4 || along < -7 || along > 140) continue;
          const cv = c.mode === "drive" ? c.v : 0, same = Math.cos(c.h - Math.atan2(sdx, sdz)) > 0;
          if (!same) { if (along > -7) room = Math.min(room, along - 40 - (cv + s) * 2.5); continue; }   // oncoming: needs a big gap
          if (along < 3 && Math.abs(lat - myLat) > 1.5) { room = Math.min(room, -5); continue; }   // alongside us in that lane
          if (cv < s + 2) room = Math.min(room, along - 6 + cv * 2);
        }
        if (off === WALK) {
          // paving all the way? (not a park's grass, nothing parked or barricaded on it)
          for (let a = 4; a < room; a += 4) {
            const qx = car.x + sdx * a + -sdz * (WALK - myLat), qz = car.z + sdz * a + sdx * (WALK - myLat);
            let solid = city.surfaceAt(qx, qz) !== 0;
            if (!solid) city.near(qx, qz, 1.2, (b) => { if (b.kind !== "pole" && b.x0 !== undefined && qx > b.x0 - 1.1 && qx < b.x1 + 1.1 && qz > b.z0 - 1.1 && qz < b.z1 + 1.1) solid = true; });
            if (solid) { room = a - 6; break; }
          }
        }
        return room - (off === -6 ? 25 : off === WALK ? 14 : 0) - (Math.abs(off - laneT) > 0.1 ? 8 : 0);
      };
      // getting on or off the sidewalk crosses the lamppost line: only where there's a gap
      const poleGap = () => !city.poles.some((q) => {
        if (q.broken) return false;
        const dx = q.x - car.x, dz = q.z - car.z, along = dx * sdx + dz * sdz, lat = dx * -sdz + dz * sdx + myLat;
        return Math.abs(lat - POLE_LAT) < 1.2 && along > -2 && along < 6 + s * 0.9;
      });
      // ...unless the line itself is blocked (a wreck, a queue): then go round
      const settle = (Math.min(turnAt, remaining) < 35 + s * 1.5 && free(0) > 12) || capNear < 30;   // (and on or near a shortcut)
      if (tick % 6 === 0) {
        const prevT = laneT;
        // a turn can be taken from the sidewalk
        if (settle) laneT = laneT === WALK && free(WALK) > 12 && remaining > turnAt && capNear > 30 ? WALK : 0;
        else if (!(laneT === -6 && tick - laneSince < 90 && free(-6) > 0)) {   // once out passing, finish the pass
          const own = (opts.noPass ? [2] : opts.noWalk ? [-2, 2] : [-2, 2, WALK]).reduce((b, o2) => (free(o2) > free(b) ? o2 : b), opts.noPass ? 2 : laneT === -6 ? -2 : laneT);
          // the oncoming lane only when both of ours are blocked close ahead and it's wide open
          laneT = !opts.noPass && opts.oncoming && free(own) < 15 && free(-6) > 45 && s > 4 ? -6 : own;
        }
        // on/off the sidewalk only through a gap in the lampposts (else stay put and try again)
        if ((laneT === WALK) !== (prevT === WALK) && !poleGap()) laneT = prevT;
        if (laneT === WALK && prevT !== WALK) walks++;
        if (laneT !== prevT) laneSince = tick;
        if (laneT === -6 && prevT !== -6) passes++;
      }
      laneOff += Math.max(-0.12, Math.min(0.12, laneT - laneOff));   // ~7 m/s sideways at most
      const [qx, qz] = pts[Math.min(bestI + 1, pts.length - 1)], [rx0, rz0] = pts[bestI];
      const qL = Math.hypot(qx - rx0, qz - rz0) || 1;
      px += (-(qz - rz0) / qL) * laneOff; pz += ((qx - rx0) / qL) * laneOff;
    }
    const ang = Math.atan2(px - car.x, pz - car.z);
    const err = Math.atan2(Math.sin(car.h - ang), Math.cos(car.h - ang));
    const steer = Math.max(-1, Math.min(1, err * 2.5)); steerLast = steer;
    // speed: slow for turns and for the stop at the end; gentler with drinks aboard
    const carrying = (sh.order?.drops || []).filter((d) => !d.done);
    const fragile = smart && carrying.some((d) => d.fragile);
    const careful = (o.kind === "drink" && o.phase === "dropoff") || (smart && carrying.some((d) => d.kind === "drink")) ? 0.75 : fragile ? 0.85 : 1;
    // smart corners harder (~14 m/s through a 90, the car can take more) and brakes later
    // (rights are tight round the kerb, lefts swing wide across the junction)
    const vTurn = (turnAng > 0 ? (smart && !process.env.SLOWTURN ? (turnLeft ? 9 + (Math.PI - turnAng) * 3 : 7.5 + (Math.PI - turnAng) * 2) : 7 + (Math.PI - turnAng) * 2) : 40) * careful;
    // cakes and catering trays hate lengthwise g: brake gently with them aboard
    const brakeG = fragile ? 0.55 * 9.81 : (smart ? +(process.env.BRK || 0.7) : 0.7) * p.brakeMax * 9.81 * careful;
    let vt = Math.min(40, capV, Math.sqrt(vTurn * vTurn + 2 * brakeG * Math.max(0, turnAt - 4)), Math.sqrt(2 * brakeG * Math.max(0, remaining - 2)));
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
          // smart: NPCs give way to a car already in the junction, so only one too close to stop counts
          const near = smart ? 9 + (cv * cv) / 8 : 10 + cv * 2.2;
          return cv > 1.5 && toward > 0 && Math.hypot(dx, dz) < near && Math.abs(Math.sin(c.h - car.h)) > 0.7;
        });
        if (busy) { vt = Math.min(vt, Math.max(0, toNode - 13) * 1.2); if (stats) stats.why = "yield"; }
      }
      const fx = Math.sin(car.h), fz = Math.cos(car.h), rx = -fz, rz = fx, look = 8 + s * 1.5;
      for (const c of traffic.cars) {
        const dx = c.x - car.x, dz = c.z - car.z, along = dx * fx + dz * fz, lat = dx * rx + dz * rz;
        if (along > 0 && along < look && Math.abs(lat) < (smart ? (Math.abs(laneOff) < 1 ? 3.2 : 2.3) : 2.6)) {
          const cv = c.mode === "drive" ? c.v : 0;
          const lim = Math.max(0, along - 7) * 1.0 + cv * 0.8;
          if (lim < vt) { vt = lim; if (stats) stats.why = c.mode === "drive" ? "following" : "wreck ahead"; }
        }
      }
    }
    // smart: under the limit past speed cameras (it can see them coming)
    if (smart && !sh.fx.noFines) for (const c of sh.plan.cameras) {
      const dx = c.cx - car.x, dz = c.cz - car.z, along = dx * Math.sin(car.h) + dz * Math.cos(car.h);
      if (Math.hypot(dx, dz) < 70 && along > -12) vt = Math.min(vt, Math.max(14, Math.sqrt(14 * 14 + 2 * brakeG * Math.max(0, along - 14))));
    }
    if (o.inZone) vt = 0;
    const inp = {
      steer,
      throttle: Math.max(0, Math.min(fragile ? 0.45 : 1, (vt - s) / 3 + 0.2)) * (Math.abs(car.slipR) > 0.1 ? 0.4 : 1),
      brake: s > vt + 0.5 ? Math.min(fragile ? 0.45 : 1, (s - vt) / 4 + 0.2) : vt === 0 ? (fragile ? 0.45 : 1) : 0,
    };
    if (vt === 0 && s < 0.6) inp.brake = 0.3;   // don't hold it so long that reverse engages
    if (stats) { const k = (s < 1 ? "" : s < 5 ? "slow:" : "move:") + (o.inZone ? "zone" : stats.why || "other"); stats[k] = (stats[k] || 0) + 1; stats.why = null; stats.ticks = (stats.ticks || 0) + 1; stats.dist = (stats.dist || 0) + s / 60; stats.top = Math.max(stats.top || 0, s); }
    stepCityCar(car, inp, city, p);
    if (traffic) traffic.step(car, p, sh.plan.traffic);
    tick++;
    for (const e of car.events) {
      if (e.type === "wall") { walls++; if (stats) stats[e.car ? "hitCar" : "hitWall"] = (stats[e.car ? "hitCar" : "hitWall"] || 0) + 1; log?.(`  ${e.car ? "car" : "wall"} ${e.speed.toFixed(1)} m/s at (${car.x.toFixed(0)}, ${car.z.toFixed(0)}) lane ${laneT}`); }
      if (e.type === "pole") { poles++; log?.(`  pole ${e.speed.toFixed(1)} m/s at (${car.x.toFixed(0)}, ${car.z.toFixed(0)}) lane ${laneT} off ${laneOff.toFixed(1)} turnAt ${turnAtLast.toFixed(0)} left ${turnLeftLast} rem ${remLast.toFixed(0)} steer ${steerLast.toFixed(2)}`); }
      if (e.type === "reset") { resets++; log?.(`  reset at (${car.x.toFixed(0)}, ${car.z.toFixed(0)})`); }
    }
  }
  return { walls, poles, resets, passes, walks, shortcuts: shortcutsTaken };
}
