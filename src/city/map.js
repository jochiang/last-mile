import { setPts, pointAt, project, clipHalf, polyArea, rectPoly, dirFrom } from "./edges.js";
import { approachPhase } from "./signals.js";

// The district: a 6x6 grid of hand-picked block types between streets. Everything the game needs
// comes out of buildCity(): colliders, the surface (road or grass), the road graph for the GPS,
// restaurants, customer addresses, and the dressing the renderer draws.
//
// Streets run along x = X(k) and z = X(k), k = 0..6. A block (row r, col c) spans
// x in [X(c), X(c+1)], z in [X(r), X(r+1)]. From a street's centreline: road to 8 m (four lanes),
// sidewalk to 14 m, then the block's buildings. Rows run north (-z) to south (+z).
//
// The GPS only knows the streets. Alleys, the parking lot and the park are the shortcuts a player
// learns.
//
// Not all of it is grid (2026-10-05, user: hard 90s everywhere "limits the mechanical expression"):
// Broadway runs corner to corner on the diagonal x + z = 0 (NE to SW), cutting six blocks into
// wedges (flatiron buildings) and making 6-way junctions, and the NW and SE corners are sweeping
// bends instead of right angles. Streets are polylines (edges.js).

export const PITCH = 66, NB = 6, ORIGIN = -3 * PITCH;
// streets widened 2026-10-03 (10 → 14 m, for power U-turns) and again 2026-10-04 for traffic:
// four 4 m lanes, GTA-sized 6 m sidewalks (drivable). LANE: where stops are, the kerbside lane.
export const CURB = 8, LINE = 14, LANE = 6, POLE = 8.6, LANE_W = 4;
export const X = (k) => ORIGIN + k * PITCH;
export const BEND_R = 50;   // the corner bends' radius (centreline)
// junction sizes: how far from a node the carriageway of every street through it reaches (jr, where
// traffic lanes start) and the sidewalks (jw, where lampposts and crossings start). Broadway's
// junctions are bigger: streets cross at 45 degrees.
const JR = 8, JW = 14, JR_DIAG = 18, JW_DIAG = 30;

// B buildings, P park (neighbouring parks merge across the street), L parking lot,
// | alley north-south, - alley east-west
// (r + c = 5 are the blocks Broadway cuts: they must be B)
const LAYOUT = [
  "BB|BBB",
  "BPPBBB",
  "-PPB-|",
  "BBBLBB",
  "BB-BPB",
  "BBL|BB",
];

const AVES = ["1st Ave", "2nd Ave", "3rd Ave", "4th Ave", "5th Ave", "6th Ave", "7th Ave"];       // x-lines
const STS = ["Oak St", "Elm St", "Pine St", "Maple St", "Cedar St", "Birch St", "Walnut St"];      // z-lines

export const RESTAURANTS = [
  { id: "pizza", name: "Pizza Palazzo", sign: "PIZZA", block: [1, 0], face: "E", color: 0xe8463c, kinds: ["food"], menu: { food: ["Pizza", "Calzone", "Garlic knots"] } },
  { id: "shakes", name: "Shake Shack-ish", sign: "SHAKES", block: [3, 4], face: "W", color: 0xff7ab8, kinds: ["drink"], menu: { drink: ["Large shake", "Shakes x3", "Malted"] } },
  { id: "bakery", name: "Sugar Rush Bakery", sign: "CAKES", block: [0, 4], face: "S", color: 0xb98cff, kinds: ["cake"], menu: { cake: ["Birthday cake", "Wedding cake (small)", "Cupcakes x12"] } },
  { id: "noodles", name: "Noodle Bar", sign: "NOODLES", block: [5, 1], face: "N", color: 0xffb020, kinds: ["food", "drink"], menu: { food: ["Noodles", "Dumplings"], drink: ["Bubble tea", "Iced coffee x3"] } },
];

const PALETTE = [0xd9c7a3, 0xc98e6b, 0xa9b8c4, 0xe3d9c6, 0x9fae8f, 0xc4a4a4, 0xb7a58f, 0x8f9fb2, 0xe0b98a, 0xa7a7b7];

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildCity(seed = 7) {
  const R = rng(seed);
  const type = (r, c) => (r < 0 || c < 0 || r >= NB || c >= NB ? "#" : LAYOUT[r][c]);
  const isPark = (r, c) => type(r, c) === "P";

  // --- road graph: 7x7 intersections; a street between two parks is park instead
  const nodes = [];
  const nid = (i, j) => j * (NB + 1) + i;
  for (let j = 0; j <= NB; j++) for (let i = 0; i <= NB; i++) {
    const diag = i + j === NB;   // on Broadway
    nodes.push({ i, j, x: X(i), z: X(j), adj: [], alive: false, jr: diag ? JR_DIAG : JR, jw: diag ? JW_DIAG : JW, signal: diag });
  }
  const edges = [];
  const addEdge = (a, b, name, pts = null) => {
    const A = nodes[a], B = nodes[b];
    const e = setPts({ a, b, name, id: edges.length }, pts || [[A.x, A.z], [B.x, B.z]]);
    edges.push(e);
    A.adj.push({ n: b, e }); B.adj.push({ n: a, e });
    A.alive = B.alive = true;
  };
  // the two bent corners: no node there, one curved street from neighbour to neighbour
  const BENT = new Set([nid(0, 0), nid(NB, NB)]);
  const touchesBend = (a, b) => BENT.has(a) || BENT.has(b);
  const removed = [];   // street rects that became park
  for (let j = 0; j <= NB; j++) for (let i = 0; i < NB; i++) {
    // along z-line j, between blocks (j-1, i) and (j, i)
    if (isPark(j - 1, i) && isPark(j, i)) removed.push({ x0: X(i) + CURB, x1: X(i + 1) - CURB, z0: X(j) - CURB, z1: X(j) + CURB });
    else if (!touchesBend(nid(i, j), nid(i + 1, j))) addEdge(nid(i, j), nid(i + 1, j), STS[j]);
  }
  for (let i = 0; i <= NB; i++) for (let j = 0; j < NB; j++) {
    if (isPark(j, i - 1) && isPark(j, i)) removed.push({ x0: X(i) - CURB, x1: X(i) + CURB, z0: X(j) + CURB, z1: X(j + 1) - CURB });
    else if (!touchesBend(nid(i, j), nid(i, j + 1))) addEdge(nid(i, j), nid(i, j + 1), AVES[i]);
  }
  // Broadway: node (6, 0) to node (0, 6), one block at a time
  for (let i = NB; i > 0; i--) addEdge(nid(i, NB - i), nid(i - 1, NB - i + 1), "Broadway");
  // the bends: straight in from the neighbouring node, a quarter circle round the corner, straight out
  const bend = (from, to, cx, cz, th0, th1, name) => {
    const A = nodes[from], B = nodes[to], pts = [[A.x, A.z]];
    for (let k = 0; k <= 12; k++) { const th = th0 + ((th1 - th0) * k) / 12; pts.push([cx + BEND_R * Math.cos(th), cz + BEND_R * Math.sin(th)]); }
    pts.push([B.x, B.z]);
    addEdge(from, to, name, pts);
    return { cx, cz, th0, th1 };
  };
  const bends = [
    { ...bend(nid(1, 0), nid(0, 1), X(0) + BEND_R, X(0) + BEND_R, -Math.PI / 2, -Math.PI, "Harbor Curve"), corner: [X(0), X(0)] },
    { ...bend(nid(NB - 1, NB), nid(NB, NB - 1), X(NB) - BEND_R, X(NB) - BEND_R, Math.PI / 2, 0, "Mill Bend"), corner: [X(NB), X(NB)] },
  ];
  const deadNodes = nodes.filter((n, k) => !n.alive && !BENT.has(k));
  for (const n of deadNodes) removed.push({ x0: n.x - CURB, x1: n.x + CURB, z0: n.z - CURB, z1: n.z + CURB, fountain: true });
  const edgeAt = (r0, c0, face) => {
    // the street edge in front of a block face, or null if that street is gone
    const [i, j, i2, j2] = face === "N" ? [c0, r0, c0 + 1, r0] : face === "S" ? [c0, r0 + 1, c0 + 1, r0 + 1]
      : face === "W" ? [c0, r0, c0, r0 + 1] : [c0 + 1, r0, c0 + 1, r0 + 1];
    const a = nid(i, j), b = nid(i2, j2);
    return edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a)) || null;
  };

  // --- block shapes: most blocks are rectangles; Broadway splits six into two wedges each, and the
  // bends round off two corner blocks. A block part is a list of half-planes, each a function of the
  // inset d from the street centreline (CURB for the sidewalk's edge, LINE for the building line).
  const S2 = Math.SQRT1_2;
  const discClips = (b) => Array.from({ length: 32 }, (_, k) => {
    const ux = Math.cos((k / 32) * Math.PI * 2), uz = Math.sin((k / 32) * Math.PI * 2);
    return (d) => [-ux, -uz, -(BEND_R - d) - (ux * b.cx + uz * b.cz)];
  });
  const blockParts = (r, c) => {
    if (r + c === NB - 1) return [[(d) => [-S2, -S2, d]], [(d) => [S2, S2, d]]];   // either side of Broadway
    if (r === 0 && c === 0) return [discClips(bends[0])];
    if (r === NB - 1 && c === NB - 1) return [discClips(bends[1])];
    return [[]];
  };
  const clipAll = (poly, part, d) => part.reduce((q, f) => (q.length ? clipHalf(q, ...f(d)) : q), poly);
  const partPoly = (r, c, part, d) => clipAll(rectPoly(X(c) + d, X(r) + d, X(c + 1) - d, X(r + 1) - d), part, d);

  // --- blocks
  const buildings = [], boxes = [], circles = [], trees = [], parkedCars = [], dumpsters = [], parks = [], lots = [], alleys = [];
  const solid = (x0, z0, x1, z1, extra = {}) => { const b = { x0, z0, x1, z1, ...extra }; boxes.push(b); return b; };
  let curParts = [[]];   // the block being filled
  const building = (x0, z0, x1, z1) => {
    const floors = 3 + Math.floor(R() * 10), color = PALETTE[Math.floor(R() * PALETTE.length)];
    let out = null;
    for (const part of curParts) {
      if (!part.length) { out = solid(x0, z0, x1, z1, { kind: "building", h: floors * 3.2, floors, color }); buildings.push(out); continue; }
      // cut to the block's shape: a wedge or a rounded corner (a flatiron, at the sharp end)
      const poly = clipAll(rectPoly(x0, z0, x1, z1), part, LINE);
      const area = poly.length >= 3 ? polyArea(poly) : 0;
      if (area < 22) continue;
      if (poly.length === 4 && Math.abs(area - (x1 - x0) * (z1 - z0)) < 0.5) { out = solid(x0, z0, x1, z1, { kind: "building", h: floors * 3.2, floors, color }); buildings.push(out); continue; }
      const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
      out = { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs), poly, kind: "building", h: floors * 3.2, floors, color };
      buildings.push(out);
      // colliders: a staircase of 1.5 m slices under it (the colliders are boxes)
      for (let sx = out.x0; sx < out.x1 - 0.05; sx += 1.5) {
        const sl = clipHalf(clipHalf(poly, 1, 0, sx), -1, 0, -Math.min(out.x1, sx + 1.5));
        if (sl.length < 3) continue;
        const sz = sl.map((p) => p[1]);
        solid(sx, Math.min(...sz), Math.min(out.x1, sx + 1.5), Math.max(...sz), { kind: "building", part: out });
      }
    }
    return out;
  };
  // fill a rect with 1-3 buildings along its long side
  const fill = (x0, z0, x1, z1) => {
    const alongX = x1 - x0 >= z1 - z0, len = alongX ? x1 - x0 : z1 - z0;
    const n = len > 30 ? 2 + (R() < 0.4 ? 1 : 0) : len > 16 ? (R() < 0.6 ? 2 : 1) : 1;
    let a = alongX ? x0 : z0;
    for (let k = 0; k < n; k++) {
      const b = k === n - 1 ? (alongX ? x1 : z1) : a + (len / n) * (0.8 + R() * 0.4);
      alongX ? building(a, z0, b, z1) : building(x0, a, x1, b);
      a = b;
    }
  };
  for (let r = 0; r < NB; r++) for (let c = 0; c < NB; c++) {
    const t = type(r, c);
    curParts = blockParts(r, c);
    const bx0 = X(c), bx1 = X(c + 1), bz0 = X(r), bz1 = X(r + 1);
    const ix0 = bx0 + LINE, ix1 = bx1 - LINE, iz0 = bz0 + LINE, iz1 = bz1 - LINE, mx = (ix0 + ix1) / 2, mz = (iz0 + iz1) / 2;
    if (t === "B" && r + c === NB - 1) {
      // a block Broadway cuts: a 4x4 grid of small buildings, clipped to the two wedges, so they're
      // built up to the diagonal (big rectangles left mostly empty plazas)
      const n = 4, w = (ix1 - ix0) / n;
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) building(ix0 + a * w, iz0 + b * w, ix0 + (a + 1) * w, iz0 + (b + 1) * w);
    } else if (t === "B") {
      fill(ix0, iz0, ix1, mz); fill(ix0, mz, ix1, iz1);
    } else if (t === "|" || t === "-") {
      const W = 3.5;   // half the alley's width
      if (t === "|") {
        fill(ix0, iz0, mx - W, mz); fill(ix0, mz, mx - W, iz1); fill(mx + W, iz0, ix1, mz); fill(mx + W, mz, ix1, iz1);
        alleys.push({ x0: mx - W, x1: mx + W, z0: bz0 + CURB, z1: bz1 - CURB, ns: true });
        for (const [side, zz] of [[-1, iz0 + 9], [1, mz + 4], [-1, iz1 - 8]]) {
          const x = side < 0 ? mx - W : mx + W - 1.3;
          dumpsters.push(solid(x, zz, x + 1.3, zz + 2.2, { kind: "dumpster" }));
        }
      } else {
        fill(ix0, iz0, mx, mz - W); fill(mx, iz0, ix1, mz - W); fill(ix0, mz + W, mx, iz1); fill(mx, mz + W, ix1, iz1);
        alleys.push({ x0: bx0 + CURB, x1: bx1 - CURB, z0: mz - W, z1: mz + W, ns: false });
        for (const [side, xx] of [[-1, ix0 + 8], [1, mx - 3], [-1, ix1 - 10]]) {
          const z = side < 0 ? mz - W : mz + W - 1.3;
          dumpsters.push(solid(xx, z, xx + 2.2, z + 1.3, { kind: "dumpster" }));
        }
      }
    } else if (t === "L") {
      lots.push({ x0: bx0 + CURB, x1: bx1 - CURB, z0: bz0 + CURB, z1: bz1 - CURB });
      // three rows of nose-in parking with gaps; the aisles between them are a shortcut
      for (const rz of [iz0 + 2, mz - 2.2, iz1 - 6.4]) {
        for (let x = ix0 + 1; x + 2.2 < ix1; x += 2.8) {
          if (R() < 0.3) continue;
          parkedCars.push(solid(x, rz, x + 2.0, rz + 4.4, { kind: "car", color: PALETTE[Math.floor(R() * PALETTE.length)] }));
        }
      }
    } else if (t === "P") {
      // grass to the curbs, and across any street to a neighbouring park
      const ext = (dr, dc) => isPark(r + dr, c + dc);
      parks.push({ x0: bx0 + (ext(0, -1) ? -CURB : CURB), x1: bx1 - (ext(0, 1) ? -CURB : CURB), z0: bz0 + (ext(-1, 0) ? -CURB : CURB), z1: bz1 - (ext(1, 0) ? -CURB : CURB), r, c });
    }
  }
  // the fountain where four parks meet
  for (const n of deadNodes) circles.push({ x: n.x, z: n.z, r: 4.5, kind: "fountain" });
  // park trees, off the paths (diagonals across each park block, and a ring round the fountain)
  for (const p of parks) {
    const cx0 = X(p.c), cz0 = X(p.r);
    for (let k = 0; k < 26; k++) {
      const x = p.x0 + 3 + R() * (p.x1 - p.x0 - 6), z = p.z0 + 3 + R() * (p.z1 - p.z0 - 6);
      const u = (x - cx0) / PITCH, v = (z - cz0) / PITCH;
      if (Math.abs(u - v) < 0.07 || Math.abs(u + v - 1) < 0.07) continue;   // diagonal paths
      if (deadNodes.some((n) => Math.hypot(x - n.x, z - n.z) < 11)) continue;
      if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 5)) continue;
      const t = { x, z, r: 0.6, s: 0.8 + R() * 0.6, kind: "tree" };
      trees.push(t); circles.push(t);
    }
  }
  curParts = [[]];
  // the city's edge: a wall of buildings beyond the outer streets
  const E0 = X(0) - LINE, E1 = X(NB) + LINE, D = 24;
  for (let k = 0; k < NB + 1; k++) {
    const a = X(0) - PITCH / 2 + k * PITCH, b = a + PITCH;
    fill(Math.max(E0 - D, a), E0 - D, Math.min(E1 + D, b), E0);
    fill(Math.max(E0 - D, a), E1, Math.min(E1 + D, b), E1 + D);
    fill(E0 - D, Math.max(E0, a), E0, Math.min(E1, b));
    fill(E1, Math.max(E0, a), E1 + D, Math.min(E1, b));
  }

  // outside each bend, where the corner used to be: a lawn with a few trees
  const lawns = bends.map((b) => {
    const sx = Math.sign(b.corner[0] - b.cx), sz = Math.sign(b.corner[1] - b.cz);   // toward the old corner
    const K = [b.corner[0] + sx * LINE, b.corner[1] + sz * LINE];
    for (let k = 0, n = 0; k < 60 && n < 6; k++) {
      const x = b.cx + sx * R() * (BEND_R + LINE), z = b.cz + sz * R() * (BEND_R + LINE);
      if (Math.hypot(x - b.cx, z - b.cz) < BEND_R + LINE + 4 || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 6)) continue;
      const t = { x, z, r: 0.6, s: 0.9 + R() * 0.6, kind: "tree" };
      trees.push(t); circles.push(t); n++;
    }
    return { ...b, K, sx, sz };
  });

  // --- lampposts along every street, both sides (breakable), from the sidewalk corners of each
  // junction; the arm reaches out over the road (yaw)
  const poles = [];
  for (const e of edges) {
    const s0 = nodes[e.a].jw - 2, s1 = e.len - nodes[e.b].jw + 3;
    for (let s = s0; s < s1; s += 16) {
      const q = pointAt(e, s);
      for (const side of [-1, 1]) {
        const x = q.x - q.dz * side * POLE, z = q.z + q.dx * side * POLE;
        // not standing in some other street (where two streets meet at an angle)
        if (edges.some((o) => o !== e && project(o, x, z).d < CURB + 1)) continue;
        const p = { x, z, r: 0.25, kind: "pole", broken: false, yaw: Math.atan2(q.dz * side, -q.dx * side) };
        poles.push(p); circles.push(p);
      }
    }
  }

  // --- places: restaurant pickups and customer addresses, each a stopping zone in the near lane
  const facePoint = (r, c, face) => {
    const mx = (X(c) + X(c + 1)) / 2, mz = (X(r) + X(r + 1)) / 2;
    if (face === "N") return { x: mx, z: X(r) + LANE };
    if (face === "S") return { x: mx, z: X(r + 1) - LANE };
    if (face === "W") return { x: X(c) + LANE, z: mz };
    return { x: X(c + 1) - LANE, z: mz };
  };
  const place = (r, c, face, extra) => {
    const e = edgeAt(r, c, face);
    if (!e) return null;
    const p = facePoint(r, c, face);
    return { ...p, edge: e, face, block: [r, c], t: projT(e, p.x, p.z), ...extra };
  };
  const restaurants = RESTAURANTS.map((d) => ({ ...d, ...place(d.block[0], d.block[1], d.face, {}) }));
  const addresses = [];
  for (let r = 0; r < NB; r++) for (let c = 0; c < NB; c++) {
    if (!"B|-".includes(type(r, c))) continue;
    for (const face of ["N", "E", "S", "W"]) {
      if (restaurants.some((q) => q.block[0] === r && q.block[1] === c && q.face === face)) continue;
      const p = place(r, c, face, {});
      if (!p) continue;
      p.label = `${100 * (face === "N" || face === "S" ? c + 1 : r + 1) + 10 + Math.floor(R() * 80)} ${p.edge.name}`;
      addresses.push(p);
    }
  }

  // Broadway's own addresses: one each side of every block of it, at the wedges' long faces
  for (const e of edges.filter((q) => q.name === "Broadway")) {
    const q = pointAt(e, e.len / 2), r = Math.floor((q.z - ORIGIN) / PITCH), c = Math.floor((q.x - ORIGIN) / PITCH);
    for (const side of [-1, 1]) {
      const x = q.x - q.dz * side * LANE, z = q.z + q.dx * side * LANE;
      addresses.push({ x, z, edge: e, face: "D", block: [r, c], t: e.len / 2, label: `${100 * (r + 1) + 10 + Math.floor(R() * 80)} Broadway` });
    }
  }

  // --- surface: 1 m cells, 1 = grass
  const S0 = E0 - D, SN = Math.ceil(E1 + D - S0);
  const surf = new Uint8Array(SN * SN);
  for (const p of [...parks, ...removed]) {
    for (let z = Math.floor(p.z0 - S0); z < Math.ceil(p.z1 - S0); z++) for (let x = Math.floor(p.x0 - S0); x < Math.ceil(p.x1 - S0); x++) surf[z * SN + x] = 1;
  }
  // the lawns outside the bends (cut the corner and you're on the grass)
  for (const l of lawns) {
    const xa = Math.min(l.K[0], l.cx), xb = Math.max(l.K[0], l.cx), za = Math.min(l.K[1], l.cz), zb = Math.max(l.K[1], l.cz);
    for (let z = Math.floor(za - S0); z < Math.ceil(zb - S0); z++) for (let x = Math.floor(xa - S0); x < Math.ceil(xb - S0); x++) {
      if (Math.hypot(x + S0 + 0.5 - l.cx, z + S0 + 0.5 - l.cz) > BEND_R + LINE) surf[z * SN + x] = 1;
    }
  }
  // traffic lights: one head per approach to each Broadway junction, on the far-right corner of the
  // stop line, facing the oncoming traffic
  const signals = [];
  nodes.forEach((N, k) => {
    if (!N.signal || !N.alive) return;
    for (const { e } of N.adj) {
      const [lx, lz] = dirFrom(e, k);   // leaving along e; the approach comes the other way
      const rx = lz, rz = -lx;          // the right of the approaching traffic
      signals.push({ node: k, phase: approachPhase(e), x: N.x + lx * (N.jr + 3) + rx * (CURB + 1.4), z: N.z + lz * (N.jr + 3) + rz * (CURB + 1.4), h: Math.atan2(lx, lz) });
    }
  });
  // sidewalk outlines for the renderer: each block part at the kerb
  const walks = [];
  for (let r = 0; r < NB; r++) for (let c = 0; c < NB; c++) {
    if (isPark(r, c)) continue;
    for (const part of blockParts(r, c)) { const q = partPoly(r, c, part, CURB); if (q.length >= 3) walks.push(q); }
  }
  const surfaceAt = (x, z) => {
    const i = Math.floor(x - S0), j = Math.floor(z - S0);
    return i < 0 || j < 0 || i >= SN || j >= SN ? 0 : surf[j * SN + i];
  };

  // --- broadphase: colliders bucketed in 10 m cells
  const CELL = 10, GN = Math.ceil(SN / CELL), grid = Array.from({ length: GN * GN }, () => []);
  const bucket = (o, x0, z0, x1, z1) => {
    for (let j = Math.max(0, Math.floor((z0 - S0) / CELL)); j <= Math.min(GN - 1, Math.floor((z1 - S0) / CELL)); j++)
      for (let i = Math.max(0, Math.floor((x0 - S0) / CELL)); i <= Math.min(GN - 1, Math.floor((x1 - S0) / CELL)); i++) grid[j * GN + i].push(o);
  };
  for (const b of boxes) bucket(b, b.x0, b.z0, b.x1, b.z1);
  for (const c of circles) bucket(c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
  // colliders that come and go with the day (road-work barricades)
  let extra = [];
  const setExtra = (list) => { extra = list; };
  const near = (x, z, rad, fn) => {
    for (const o of extra) if (x + rad > o.x0 && x - rad < o.x1 && z + rad > o.z0 && z - rad < o.z1) fn(o);
    const seen = new Set();
    for (let j = Math.max(0, Math.floor((z - rad - S0) / CELL)); j <= Math.min(GN - 1, Math.floor((z + rad - S0) / CELL)); j++)
      for (let i = Math.max(0, Math.floor((x - rad - S0) / CELL)); i <= Math.min(GN - 1, Math.floor((x + rad - S0) / CELL)); i++)
        for (const o of grid[j * GN + i]) if (!seen.has(o)) { seen.add(o); fn(o); }
  };

  return {
    nodes, edges, removed, deadNodes, buildings, boxes, circles, trees, poles, parkedCars, dumpsters, parks, lots, alleys, walks, lawns, signals,
    restaurants, addresses, surfaceAt, near, setExtra, bounds: { x0: S0, z0: S0, x1: S0 + SN, z1: S0 + SN }, inner: { x0: E0, x1: E1 },
    start: { x: X(3) + LANE, z: X(4) - 14, h: Math.PI },   // 4th Ave, heading north
  };
}

/** How far along edge e (0..len) the point (x, z) projects. */
export function projT(e, x, z) {
  return project(e, x, z).t;
}
