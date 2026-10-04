// Traffic: NPC cars that drive the right-hand lanes of the street graph, turn through intersections
// on curves, take turns at junctions, and brake for whatever's ahead (the player included). Cruising
// they're on rails (cheap); the moment something hits them they become 2D rigid bodies (mass,
// inertia, tyre grip), and car-car contacts, the player's included, are resolved with impulses at
// the contact point, so hits spin them. Afterwards they steer back into a lane, or sit as a wreck.
//
// Directions: a heading h faces (sin h, cos h); the right of travel direction (dx, dz) is (-dz, dx).

import { CURB, LANE_W } from "./map.js";
import { nearestEdge } from "./gps.js";
import { DT } from "../car.js";

const LANES = [LANE_W / 2, LANE_W * 1.5];   // lateral offsets of the inner and outer lanes
const KINDS = {
  car: { m: 1150, ax: 1.3, r: 1.05, len: 4.3, wid: 1.9, h: 1.45, cruise: [9.5, 12.5] },
  van: { m: 2300, ax: 1.7, r: 1.2, len: 5.2, wid: 2.1, h: 2.3, cruise: [8.5, 10.5] },
};
const COLORS = [0xd94b3d, 0x3d7fd9, 0xe8e2d4, 0x2f3137, 0x8a9199, 0xe0b23a, 0x4fa35c, 0x7a4fb0, 0xc8c8c8, 0x5a3a2a];

const right = (dx, dz) => [-dz, dx];

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

export function createTraffic(city, seed = 1) {
  const R = rng(seed * 48271 + 11);
  const cars = [];
  let nextId = 1;
  const inside = new Map();   // node index -> Set of cars currently turning through that junction
  const events = [];

  // --- paths: runs along an edge's lane, and curves through intersections
  const edgeDir = (e, from) => (from === e.a ? 1 : -1);
  function runSeg(e, dir, lane) {
    const [na, nb] = dir > 0 ? [e.a, e.b] : [e.b, e.a];
    const A = city.nodes[na], B = city.nodes[nb];
    const dx = (B.x - A.x) / e.len, dz = (B.z - A.z) / e.len, [rx, rz] = right(dx, dz), off = LANES[lane];
    return { type: "run", e, dir, lane, from: na, to: nb, dx, dz,
      x0: A.x + dx * CURB + rx * off, z0: A.z + dz * CURB + rz * off, x1: B.x - dx * CURB + rx * off, z1: B.z - dz * CURB + rz * off, len: e.len - 2 * CURB };
  }
  function turnSeg(a, b) {
    // from the end of run a to the start of run b, through node a.to
    const P0 = [a.x1, a.z1], P2 = [b.x0, b.z0];
    const cross = a.dx * b.dz - a.dz * b.dx, dot = a.dx * b.dx + a.dz * b.dz;
    let P1;
    if (Math.abs(cross) < 0.1) P1 = dot > 0 ? [(P0[0] + P2[0]) / 2, (P0[1] + P2[1]) / 2] : [P0[0] + a.dx * CURB * 1.6, P0[1] + a.dz * CURB * 1.6];
    else {
      // where the two lane lines meet
      const t = ((P2[0] - P0[0]) * b.dz - (P2[1] - P0[1]) * b.dx) / cross;
      P1 = [P0[0] + a.dx * t, P0[1] + a.dz * t];
    }
    let len = 0, px = P0[0], pz = P0[1];
    for (let k = 1; k <= 8; k++) { const [x, z] = bez(P0, P1, P2, k / 8); len += Math.hypot(x - px, z - pz); px = x; pz = z; }
    // facing +z, left is +x: a left turn has a negative cross product here
    const kind = Math.abs(cross) < 0.1 ? (dot > 0 ? "straight" : "uturn") : cross < 0 ? "left" : "right";
    return { type: "turn", node: a.to, P0, P1, P2, len: Math.max(1, len), kind, fromDir: [a.dx, a.dz] };
  }
  const bez = (P0, P1, P2, t) => { const u = 1 - t; return [u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1]]; };
  const bezDir = (P0, P1, P2, t) => { const u = 1 - t; return [2 * u * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]), 2 * u * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1])]; };

  const release = (c) => { if (c.claim) { inside.get(c.claim.node)?.delete(c); c.claim = null; } };

  // pick where to go at a node: no U-turns unless there's nothing else; never into road works
  function pickNext(e, toNode) {
    const opts = city.nodes[toNode].adj.filter((q) => q.e !== e && !q.e.closed);
    const all = opts.length ? opts : city.nodes[toNode].adj.filter((q) => !q.e.closed);
    const q = all.length ? all[Math.floor(R() * all.length)] : { e, n: e.a === toNode ? e.b : e.a };
    return { e: q.e, dir: edgeDir(q.e, toNode) };
  }
  // the lane a run should use, given the turn at its end (left turns from the inside lane)
  function laneFor(cur, next) {
    const [na, nb] = cur.dir > 0 ? [cur.e.a, cur.e.b] : [cur.e.b, cur.e.a];
    const A = city.nodes[na], B = city.nodes[nb];
    const [nx0, nz0] = next.dir > 0 ? [next.e.ax, next.e.az] : [next.e.bx, next.e.bz];
    const [nx1, nz1] = next.dir > 0 ? [next.e.bx, next.e.bz] : [next.e.ax, next.e.az];
    const dx = B.x - A.x, dz = B.z - A.z, ex = nx1 - nx0, ez = nz1 - nz0;
    const cross = dx * ez - dz * ex;
    return Math.abs(cross) < 1 ? (R() < 0.5 ? 0 : 1) : cross < 0 ? 0 : 1;
  }

  function spawn(px, pz, near = false) {
    const k = R() < 0.18 ? "van" : "car", K = KINDS[k];
    for (let tries = 0; tries < 30; tries++) {
      const e = city.edges[Math.floor(R() * city.edges.length)];
      if (e.closed) continue;
      const dir = R() < 0.5 ? 1 : -1, toNode = dir > 0 ? e.b : e.a;
      const next = pickNext(e, toNode);
      const run = runSeg(e, dir, laneFor({ e, dir }, next));
      if (run.len < 30) continue;
      const t = R() * (run.len - 25);   // not right at a junction: it must have room to decide
      const x = run.x0 + run.dx * t, z = run.z0 + run.dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < (near ? 60 : 45) || d > 170) continue;
      if (cars.some((c) => Math.hypot(c.x - x, c.z - z) < 9)) continue;
      const v = K.cruise[0] + R() * (K.cruise[1] - K.cruise[0]);
      const c = {
        id: nextId++, kind: k, K, color: COLORS[Math.floor(R() * COLORS.length)],
        mode: "drive", seg: run, s: t, next, x, z, h: Math.atan2(run.dx, run.dz), v, cruise: v, waitT: 0, stuckT: 0,
        vx: 0, vz: 0, w: 0, stillT: 0, wreckT: 0, dmg: 0, brake: 0, honkT: 0, px: x, pz: z, ph: 0,
      };
      c.ph = c.h;
      cars.push(c);
      return c;
    }
    return null;
  }

  function advance(c) {
    // move on to the next segment: run -> turn -> run ...
    if (c.seg.type === "run") {
      const nextNext = pickNext(c.next.e, c.next.dir > 0 ? c.next.e.b : c.next.e.a);
      const nrun = runSeg(c.next.e, c.next.dir, laneFor(c.next, nextNext));
      c.seg = turnSeg(c.seg, nrun); c.after = nrun; c.next = nextNext; c.s = 0;
    } else {
      release(c);
      c.seg = c.after; c.after = null; c.s = 0;
    }
  }

  // where a driving car is, on its path, and which way it faces
  function placeOnPath(c) {
    const g = c.seg;
    if (g.type === "run") { c.x = g.x0 + g.dx * c.s; c.z = g.z0 + g.dz * c.s; c.h = Math.atan2(g.dx, g.dz); }
    else {
      const t = Math.min(1, c.s / g.len), [x, z] = bez(g.P0, g.P1, g.P2, t), [tx, tz] = bezDir(g.P0, g.P1, g.P2, t);
      c.x = x; c.z = z; c.h = Math.atan2(tx, tz);
    }
  }

  // right of way: following someone through, or passing opposite straight/right movements, is fine;
  // anything that crosses our path isn't
  function canEnter(g, myKind, player) {
    // never into a junction the player is driving through
    const N = city.nodes[g.to];
    if (player && Math.abs(player.x - N.x) < CURB + 0.5 && Math.abs(player.z - N.z) < CURB + 0.5 && Math.hypot(player.vx, player.vz) > 1) return false;
    const set = inside.get(g.to);
    if (!set || !set.size) return true;
    for (const o of set) {
      if (!o.claim) continue;
      const [ox, oz] = o.claim.fromDir, dot = ox * g.dx + oz * g.dz;
      if (dot > 0.9) continue;                                                       // same approach: following
      if (dot < -0.9 && myKind !== "left" && o.claim.kind !== "left") continue;     // opposite, not crossing
      return false;
    }
    return true;
  }
  // room on the far side: nobody sitting in the first stretch of the lane we're about to take
  function exitClear(c, player) {
    const ne = c.next, nodeTo = c.seg.to;
    const [x0, z0] = ne.dir > 0 ? [ne.e.ax, ne.e.az] : [ne.e.bx, ne.e.bz];
    const N = city.nodes[nodeTo];
    if (Math.hypot(x0 - N.x, z0 - N.z) > 1) return true;
    const dx = ne.dir > 0 ? (ne.e.bx - ne.e.ax) / ne.e.len : (ne.e.ax - ne.e.bx) / ne.e.len, dz = ne.dir > 0 ? (ne.e.bz - ne.e.az) / ne.e.len : (ne.e.az - ne.e.bz) / ne.e.len;
    const ex = N.x + dx * (CURB + 4), ez = N.z + dz * (CURB + 4);
    for (const o of cars) if (o !== c && Math.hypot(o.x - ex, o.z - ez) < 6 && (o.mode !== "drive" || o.v < 2)) return false;
    return true;
  }

  // --- driving: speed for the turn ahead, gaps to whatever's in front, taking turns at junctions
  function drive(c, player) {
    const g = c.seg, fx = Math.sin(c.h), fz = Math.cos(c.h), [rx, rz] = right(fx, fz);
    let target = c.cruise;
    if (g.type === "run") {
      const toEnd = g.len - c.s;
      // turn speed coming up (the next turn is known: c.next)
      const A = city.nodes[g.to], nx = c.next.dir > 0 ? c.next.e.bx - c.next.e.ax : c.next.e.ax - c.next.e.bx, nz = c.next.dir > 0 ? c.next.e.bz - c.next.e.az : c.next.e.az - c.next.e.bz;
      const turning = Math.abs(g.dx * nz - g.dz * nx) > 1;
      void A;
      const vTurn = turning ? 6.5 : c.cruise;
      target = Math.min(target, Math.sqrt(vTurn * vTurn + 2 * 3.5 * Math.max(0, toEnd - 1)));
      // the junction: go only if nothing crossing our path is in it and there's room on the far side
      // a car commits (claims its movement) a few metres out; later arrivals check against claims,
      // so two cars can't both see an empty junction and go in the same instant
      // decide while there's still room to stop (braking distance plus a margin)
      const decide = (c.v * c.v) / 9 + 7;
      if (toEnd < decide && !c.claim) {
        const myKind = turning ? (g.dx * nz - g.dz * nx < 0 ? "left" : "right") : "straight";
        const ok = canEnter(g, myKind, player) && exitClear(c, player);
        // the stop line sits back from the junction so a waiting car's nose stays out of the crossing lanes
        if (!ok) { target = Math.min(target, Math.max(0, (toEnd - 3.2) * 1.3)); c.waitT += DT; }
        else if (toEnd < decide - 1) {
          c.waitT = 0;
          c.claim = { node: g.to, fromDir: [g.dx, g.dz], kind: myKind };
          if (!inside.has(g.to)) inside.set(g.to, new Set());
          inside.get(g.to).add(c);
        }
      }
    }
    // keep a gap to anything ahead in our lane (other cars, the player)
    let gapV = Infinity, playerBlock = false;
    const look = 6 + c.v * 1.6;
    const check = (ox, oz, ov, isPlayer) => {
      const dx = ox - c.x, dz = oz - c.z, along = dx * fx + dz * fz, lat = dx * rx + dz * rz;
      if (along <= 0 || along > look + 4 || Math.abs(lat) > 2.3) return;
      const gap = along - 5.2;
      const v = Math.max(0, gap - 1) * 1.1 + Math.max(0, ov) * 0.9;
      if (v < gapV) { gapV = v; playerBlock = isPlayer; }
    };
    for (const o of cars) if (o !== c) check(o.x, o.z, o.mode === "drive" ? o.v : 0, false);
    // through a curve the straight-ahead check misses the car in front: queue on anyone making the same
    // movement through this junction who's further along it
    if (g.type === "turn" && c.claim) {
      for (const o of cars) {
        if (o === c || o.mode !== "drive" || !o.claim || o.claim.node !== c.claim.node || o.seg.type !== "turn") continue;
        if (o.claim.kind !== c.claim.kind || o.claim.fromDir[0] * c.claim.fromDir[0] + o.claim.fromDir[1] * c.claim.fromDir[1] < 0.9) continue;
        if (o.s > c.s) gapV = Math.min(gapV, Math.max(0, o.s - c.s - 6) * 1.1 + o.v * 0.9);
      }
    }
    // the player: where they are and where they'll be over the next second (so a car crossing in front
    // is seen in time to stop, not once it's already in the lane)
    if (player) for (const t of [0, 0.4, 0.8, 1.2]) check(player.x + player.vx * t, player.z + player.vz * t, player.vx * fx + player.vz * fz, true);
    target = Math.min(target, gapV);
    // accelerate gently, brake firmly
    const a = target > c.v ? 2.2 : -6.5;
    const before = c.v;
    c.v = Math.max(0, target > c.v ? Math.min(target, c.v + a * DT) : Math.max(target, c.v + a * DT));
    c.brake = c.v < before - 0.02 ? 1 : 0;
    // cut up by the player: a honk (once in a while)
    c.honkT = Math.max(0, c.honkT - DT);
    if (playerBlock && before - c.v > 0.08 && c.honkT <= 0) { c.honkT = 4; events.push({ type: "honk", x: c.x, z: c.z }); }
    c.s += c.v * DT;
    while (c.s > c.seg.len) { c.s -= c.seg.len; advance(c); }
    placeOnPath(c);
    c.vx = Math.sin(c.h) * c.v; c.vz = Math.cos(c.h) * c.v; c.w = 0;
  }

  // --- rigid-body mode: after a knock. Tyres scrub sideways velocity, the driver brakes.
  function physics(c) {
    const fx = Math.sin(c.h), fz = Math.cos(c.h), [rx, rz] = right(fx, fz);
    let along = c.vx * fx + c.vz * fz, lat = c.vx * rx + c.vz * rz;
    const grip = 9 * DT;   // ~0.9 g of side grip
    lat -= Math.sign(lat) * Math.min(Math.abs(lat), grip);
    along -= Math.sign(along) * Math.min(Math.abs(along), (c.mode === "wreck" ? 7 : 4.5) * DT);
    c.vx = fx * along + rx * lat; c.vz = fz * along + rz * lat;
    c.w *= Math.exp(-2.6 * DT);
    c.x += c.vx * DT; c.z += c.vz * DT; c.h += c.w * DT;
    // buildings and kerbside stuff
    for (const k of [1, -1]) {
      const cx = c.x + Math.sin(c.h) * c.K.ax * k, cz = c.z + Math.cos(c.h) * c.K.ax * k;
      city.near(cx, cz, c.K.r + 0.5, (o) => {
        if (o.broken || o.kind === "pole") return;
        let nx, nz, pen;
        if (o.r !== undefined) {
          const dx = cx - o.x, dz = cz - o.z, d = Math.hypot(dx, dz);
          if (d >= c.K.r + o.r || d < 1e-6) return;
          pen = c.K.r + o.r - d; nx = dx / d; nz = dz / d;
        } else {
          const px = Math.max(o.x0, Math.min(o.x1, cx)), pz = Math.max(o.z0, Math.min(o.z1, cz)), dx = cx - px, dz = cz - pz, d = Math.hypot(dx, dz);
          if (d >= c.K.r || d < 1e-6) return;
          pen = c.K.r - d; nx = dx / d; nz = dz / d;
        }
        c.x += nx * pen; c.z += nz * pen;
        const vn = c.vx * nx + c.vz * nz;
        if (vn < 0) { c.vx -= nx * vn * 1.3; c.vz -= nz * vn * 1.3; c.w += k * vn * 0.15; }
      });
    }
    const speed = Math.hypot(c.vx, c.vz);
    c.stillT = speed < 1.2 && Math.abs(c.w) < 0.4 ? c.stillT + DT : 0;
    if (c.mode === "wreck") { c.wreckT -= DT; return; }
    if (c.stillT > 1.1) rejoin(c);
  }
  // back into traffic: onto the nearest lane going the way the car points, merging along a curve
  function rejoin(c) {
    const ne = nearestEdge(city, c.x, c.z, c.h), e = ne.e;
    const dir = (e.bx - e.ax) * Math.sin(c.h) + (e.bz - e.az) * Math.cos(c.h) >= 0 ? 1 : -1;
    const next = pickNext(e, dir > 0 ? e.b : e.a);
    const run = runSeg(e, dir, 1);
    const s0 = Math.max(0, Math.min(run.len - 1, (dir > 0 ? ne.t : e.len - ne.t) - CURB + 10));
    const tx = run.x0 + run.dx * s0, tz = run.z0 + run.dz * s0;
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    const d = Math.max(4, Math.hypot(tx - c.x, tz - c.z));
    // a merge curve from where it sits to the lane, then the rest of the run
    const merge = { type: "turn", node: -1, P0: [c.x, c.z], P1: [c.x + fx * d * 0.5, c.z + fz * d * 0.5], P2: [tx, tz], len: d * 1.15, kind: "merge", fromDir: [fx, fz] };
    const rest = { ...run, x0: tx, z0: tz, len: run.len - s0 };
    c.mode = "drive"; c.seg = merge; c.after = rest; c.next = next; c.s = 0; c.v = 2; c.stillT = 0;
  }

  // --- contacts: two circles per car; impulses at the contact point (both ways with the player)
  const shape = (o, K) => {
    const fx = Math.sin(o.h), fz = Math.cos(o.h);
    return [[o.x + fx * K.ax, o.z + fz * K.ax], [o.x - fx * K.ax, o.z - fz * K.ax]];
  };
  function collide(A, KA, B, KB, isPlayerA, p) {
    const mA = isPlayerA ? p.m : KA.m, mB = KB.m;
    const IA = isPlayerA ? p.Iz : (mA * (KA.len ** 2 + KA.wid ** 2)) / 12, IB = (mB * (KB.len ** 2 + KB.wid ** 2)) / 12;
    let worst = 0;
    for (const [ax, az] of shape(A, KA)) for (const [bx, bz] of shape(B, KB)) {
      const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz), rr = KA.r + KB.r;
      if (d >= rr || d < 1e-6) continue;
      const nx = dx / d, nz = dz / d, pen = rr - d;
      // separate by inverse mass
      const iA = 1 / mA, iB = 1 / mB, sum = iA + iB;
      A.x -= nx * pen * (iA / sum); A.z -= nz * pen * (iA / sum);
      B.x += nx * pen * (iB / sum); B.z += nz * pen * (iB / sum);
      // the contact point, and each body's velocity there
      const cx = ax + nx * KA.r, cz = az + nz * KA.r;
      const raX = cx - A.x, raZ = cz - A.z, rbX = cx - B.x, rbZ = cz - B.z;
      const wA = isPlayerA ? A.r : A.w, wB = B.w;
      const vax = A.vx + wA * raZ, vaz = A.vz - wA * raX, vbx = B.vx + wB * rbZ, vbz = B.vz - wB * rbX;
      const vn = (vbx - vax) * nx + (vbz - vaz) * nz;
      if (vn >= 0) continue;
      const raN = raZ * nx - raX * nz, rbN = rbZ * nx - rbX * nz;
      const j = (-(1 + 0.25) * vn) / (iA + iB + (raN * raN) / IA + (rbN * rbN) / IB);
      A.vx -= nx * j * iA; A.vz -= nz * j * iA;
      B.vx += nx * j * iB; B.vz += nz * j * iB;
      if (isPlayerA) A.r -= (raN * j) / IA; else A.w -= (raN * j) / IA;
      B.w += (rbN * j) / IB;
      worst = Math.max(worst, -vn);
    }
    return worst;
  }
  const wake = (c, impact) => {
    if (c.mode === "drive") { c.mode = "phys"; release(c); }
    c.dmg += impact;
    if (impact > 11 || c.dmg > 22) { c.mode = "wreck"; c.wreckT = 15; }
  };

  /** One tick. player: the city car (its velocity is changed by impacts); p: its physics params. */
  function step(player, p, density) {
    events.length = 0;
    // keep the traffic around the player: top up, and recycle cars that drift far away or time out as wrecks
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      const dist = Math.hypot(c.x - player.x, c.z - player.z);
      // gone too far, a spent wreck, or stuck in a jam out of the player's sight: recycle it
      c.stuckT = c.mode === "drive" && c.v < 0.3 ? c.stuckT + DT : 0;
      if (dist > 190 || (c.mode === "wreck" && c.wreckT <= 0) || (c.stuckT > 15 && dist > 55)) {
        release(c);
        cars.splice(i, 1);
      }
    }
    if (cars.length < density) spawn(player.x, player.z, true);
    for (const c of cars) { c.px = c.x; c.pz = c.z; c.ph = c.h; }
    for (const c of cars) (c.mode === "drive" ? drive(c, player) : physics(c));
    // car-car contacts
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        if (Math.abs(a.x - b.x) > 8 || Math.abs(a.z - b.z) > 8) continue;
        const imp = collide(a, a.K, b, b.K, false);
        if (imp > 0) {
          if (imp > 2.5 || a.mode !== "drive" || b.mode !== "drive") { wake(a, imp); wake(b, imp); }
          if (imp > 3) events.push({ type: "crash", x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, speed: imp, a: a.id, b: b.id });
        }
      }
    }
    // the player against traffic: a real two-body impact, both ways
    for (const c of cars) {
      if (Math.abs(c.x - player.x) > 9 || Math.abs(c.z - player.z) > 9) continue;
      const imp = collide(player, p, c, c.K, true, p);   // the player's shape and mass come from its params
      if (imp > 0) {
        wake(c, imp);
        const sh = Math.sin(player.h), ch = Math.cos(player.h);
        player.u = player.vx * sh + player.vz * ch; player.v = player.vx * ch - player.vz * sh;
        if (imp > 2) {
          player.cond = Math.max(0, player.cond - Math.min(0.2, (imp - 1.5) * 0.011) * (player.dmgMul || 1));
          player.events.push({ type: "wall", speed: imp, car: true });
          events.push({ type: "crash", x: c.x, z: c.z, speed: imp, player: true });
          if (c.honkT <= 0) { c.honkT = 3; events.push({ type: "honk", x: c.x, z: c.z }); }
        }
      }
    }
  }

  function reset(player, density) {
    cars.length = 0; inside.clear();
    for (let k = 0; k < density * 3 && cars.length < density; k++) spawn(player.x, player.z);
  }

  return { cars, events, step, reset, KINDS };
}
