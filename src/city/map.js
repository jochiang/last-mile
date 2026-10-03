// The district: a 6x6 grid of hand-picked block types between streets. Everything the game needs
// comes out of buildCity(): colliders, the surface (road or grass), the road graph for the GPS,
// restaurants, customer addresses, and the dressing the renderer draws.
//
// Streets run along x = X(k) and z = X(k), k = 0..6. A block (row r, col c) spans
// x in [X(c), X(c+1)], z in [X(r), X(r+1)]. From a street's centreline: road to 7 m (four lanes),
// sidewalk to 10 m, then the block's buildings. Rows run north (-z) to south (+z).
//
// The GPS only knows the streets. Alleys, the parking lot and the park are the shortcuts a player
// learns.

export const PITCH = 58, NB = 6, ORIGIN = -3 * PITCH;
// streets widened 2026-10-03 (were 10 m curb to curb): room for a power-oversteer U-turn
export const CURB = 7, LINE = 10, LANE = 3.5, POLE = 7.6;
export const X = (k) => ORIGIN + k * PITCH;

// B buildings, P park (neighbouring parks merge across the street), L parking lot,
// | alley north-south, - alley east-west
const LAYOUT = [
  "BB|BBB",
  "BPPBLB",
  "-PPB-|",
  "BB|LBB",
  "B-BBPB",
  "BBB|BB",
];

const AVES = ["1st Ave", "2nd Ave", "3rd Ave", "4th Ave", "5th Ave", "6th Ave", "7th Ave"];       // x-lines
const STS = ["Oak St", "Elm St", "Pine St", "Maple St", "Cedar St", "Birch St", "Walnut St"];      // z-lines

export const RESTAURANTS = [
  { id: "pizza", name: "Pizza Palazzo", sign: "PIZZA", block: [1, 0], face: "E", color: 0xe8463c, kinds: ["food"], menu: { food: ["Pizza", "Calzone", "Garlic knots"] } },
  { id: "shakes", name: "Shake Shack-ish", sign: "SHAKES", block: [3, 4], face: "W", color: 0xff7ab8, kinds: ["drink"], menu: { drink: ["Large shake", "Shakes x3", "Malted"] } },
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
  for (let j = 0; j <= NB; j++) for (let i = 0; i <= NB; i++) nodes.push({ i, j, x: X(i), z: X(j), adj: [], alive: false });
  const edges = [];
  const addEdge = (a, b, name) => {
    const A = nodes[a], B = nodes[b], len = Math.hypot(B.x - A.x, B.z - A.z);
    const e = { a, b, ax: A.x, az: A.z, bx: B.x, bz: B.z, len, name, id: edges.length };
    edges.push(e);
    A.adj.push({ n: b, e }); B.adj.push({ n: a, e });
    A.alive = B.alive = true;
  };
  const removed = [];   // street rects that became park
  for (let j = 0; j <= NB; j++) for (let i = 0; i < NB; i++) {
    // along z-line j, between blocks (j-1, i) and (j, i)
    if (isPark(j - 1, i) && isPark(j, i)) removed.push({ x0: X(i) + CURB, x1: X(i + 1) - CURB, z0: X(j) - CURB, z1: X(j) + CURB });
    else addEdge(nid(i, j), nid(i + 1, j), STS[j]);
  }
  for (let i = 0; i <= NB; i++) for (let j = 0; j < NB; j++) {
    if (isPark(j, i - 1) && isPark(j, i)) removed.push({ x0: X(i) - CURB, x1: X(i) + CURB, z0: X(j) + CURB, z1: X(j + 1) - CURB });
    else addEdge(nid(i, j), nid(i, j + 1), AVES[i]);
  }
  const deadNodes = nodes.filter((n) => !n.alive);
  for (const n of deadNodes) removed.push({ x0: n.x - CURB, x1: n.x + CURB, z0: n.z - CURB, z1: n.z + CURB, fountain: true });
  const edgeAt = (r0, c0, face) => {
    // the street edge in front of a block face, or null if that street is gone
    const [i, j, i2, j2] = face === "N" ? [c0, r0, c0 + 1, r0] : face === "S" ? [c0, r0 + 1, c0 + 1, r0 + 1]
      : face === "W" ? [c0, r0, c0, r0 + 1] : [c0 + 1, r0, c0 + 1, r0 + 1];
    const a = nid(i, j), b = nid(i2, j2);
    return edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a)) || null;
  };

  // --- blocks
  const buildings = [], boxes = [], circles = [], trees = [], parkedCars = [], dumpsters = [], parks = [], lots = [], alleys = [];
  const solid = (x0, z0, x1, z1, extra = {}) => { const b = { x0, z0, x1, z1, ...extra }; boxes.push(b); return b; };
  const building = (x0, z0, x1, z1) => {
    const floors = 3 + Math.floor(R() * 10);
    const b = solid(x0, z0, x1, z1, { kind: "building", h: floors * 3.2, floors, color: PALETTE[Math.floor(R() * PALETTE.length)] });
    buildings.push(b);
    return b;
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
    const bx0 = X(c), bx1 = X(c + 1), bz0 = X(r), bz1 = X(r + 1);
    const ix0 = bx0 + LINE, ix1 = bx1 - LINE, iz0 = bz0 + LINE, iz1 = bz1 - LINE, mx = (ix0 + ix1) / 2, mz = (iz0 + iz1) / 2;
    if (t === "B") {
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
  // the city's edge: a wall of buildings beyond the outer streets
  const E0 = X(0) - LINE, E1 = X(NB) + LINE, D = 24;
  for (let k = 0; k < NB + 1; k++) {
    const a = X(0) - PITCH / 2 + k * PITCH, b = a + PITCH;
    fill(Math.max(E0 - D, a), E0 - D, Math.min(E1 + D, b), E0);
    fill(Math.max(E0 - D, a), E1, Math.min(E1 + D, b), E1 + D);
    fill(E0 - D, Math.max(E0, a), E0, Math.min(E1, b));
    fill(E1, Math.max(E0, a), E1 + D, Math.min(E1, b));
  }

  // --- lampposts along every street, both sides (breakable)
  const poles = [];
  for (const e of edges) {
    const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len;
    for (let s = 12; s < e.len - 11; s += 16) {
      for (const side of [-1, 1]) {
        const p = { x: e.ax + dx * s - dz * side * POLE, z: e.az + dz * s + dx * side * POLE, r: 0.25, kind: "pole", broken: false };
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

  // --- surface: 1 m cells, 1 = grass
  const S0 = E0 - D, SN = Math.ceil(E1 + D - S0);
  const surf = new Uint8Array(SN * SN);
  for (const p of [...parks, ...removed]) {
    for (let z = Math.floor(p.z0 - S0); z < Math.ceil(p.z1 - S0); z++) for (let x = Math.floor(p.x0 - S0); x < Math.ceil(p.x1 - S0); x++) surf[z * SN + x] = 1;
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
  const near = (x, z, rad, fn) => {
    const seen = new Set();
    for (let j = Math.max(0, Math.floor((z - rad - S0) / CELL)); j <= Math.min(GN - 1, Math.floor((z + rad - S0) / CELL)); j++)
      for (let i = Math.max(0, Math.floor((x - rad - S0) / CELL)); i <= Math.min(GN - 1, Math.floor((x + rad - S0) / CELL)); i++)
        for (const o of grid[j * GN + i]) if (!seen.has(o)) { seen.add(o); fn(o); }
  };

  return {
    nodes, edges, removed, deadNodes, buildings, boxes, circles, trees, poles, parkedCars, dumpsters, parks, lots, alleys,
    restaurants, addresses, surfaceAt, near, bounds: { x0: S0, z0: S0, x1: S0 + SN, z1: S0 + SN }, inner: { x0: E0, x1: E1 },
    start: { x: X(3) + LANE, z: X(4) - 14, h: Math.PI },   // 4th Ave, heading north
  };
}

/** How far along edge e (0..len) the point (x, z) projects. */
export function projT(e, x, z) {
  const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len;
  return Math.max(0, Math.min(e.len, (x - e.ax) * dx + (z - e.az) * dz));
}
