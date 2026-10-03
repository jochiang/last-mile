// The circuit: a closed centripetal Catmull-Rom spline through hand-placed control points,
// resampled every metre. Everything else (physics, rendering, laps) works off the samples.
// Coordinates are metres on the ground plane (x, z); a heading h faces (sin h, cos h).

export const ROAD = 7;        // half width of the asphalt
export const WALL = 14;       // the barrier's distance from the centreline
export const KERB = 1.3;      // kerb width outside the road edge

// counter-clockwise seen from above, starting on the start/finish straight (heading +x)
const CTRL = [
  [-110, 70], [0, 70], [90, 70], [150, 55], [175, 10], [160, -30], [115, -40], [80, -25],
  [45, -45], [55, -95], [110, -110], [175, -125], [190, -170], [150, -195], [60, -190],
  [-10, -160], [-35, -120], [-75, -125], [-115, -150], [-165, -140], [-185, -90], [-160, -40],
  [-185, 10], [-170, 55],
];

function catmull(p0, p1, p2, p3, t) {
  // centripetal parameterisation (alpha 0.5): no cusps or loops on uneven spacing
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => [
    ((tb - u) * a[0] + (u - ta) * b[0]) / (tb - ta),
    ((tb - u) * a[1] + (u - ta) * b[1]) / (tb - ta),
  ];
  const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

export function buildTrack(ctrl = CTRL) {
  // dense polyline, then resample by arc length at 1 m
  const dense = [];
  const n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p = [ctrl[(i - 1 + n) % n], ctrl[i], ctrl[(i + 1) % n], ctrl[(i + 2) % n]];
    for (let k = 0; k < 120; k++) dense.push(catmull(...p, k / 120));
  }
  let total = 0;
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1], b = dense[i % dense.length];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    cum.push(total);
  }
  const N = Math.floor(total);
  const step = total / N;
  const x = new Float64Array(N), z = new Float64Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = i * step;
    while (cum[j + 1] < s) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length], f = (s - cum[j]) / (cum[j + 1] - cum[j]);
    x[i] = a[0] + (b[0] - a[0]) * f;
    z[i] = a[1] + (b[1] - a[1]) * f;
  }
  // tangents, right-hand normals, signed curvature (+ = turning right)
  const tx = new Float64Array(N), tz = new Float64Array(N), nx = new Float64Array(N), nz = new Float64Array(N);
  const heading = new Float64Array(N), curv = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    const dx = x[b] - x[a], dz = z[b] - z[a], l = Math.hypot(dx, dz);
    tx[i] = dx / l; tz[i] = dz / l;
    nx[i] = -tz[i]; nz[i] = tx[i];
    heading[i] = Math.atan2(tx[i], tz[i]);
  }
  for (let i = 0; i < N; i++) {
    // over +-4 m so the 1 m sampling doesn't make curvature noisy
    const a = (i - 4 + N) % N, b = (i + 4) % N;
    let d = heading[a] - heading[b];
    d = Math.atan2(Math.sin(d), Math.cos(d));
    curv[i] = d / (8 * step);
  }
  return { N, step, length: total, x, z, tx, tz, nx, nz, heading, curv };
}

/** Nearest sample to (px, pz), searching around a hint index (or everywhere if hint < 0).
 *  Returns { i, d } where d is the signed lateral offset (+ = right of the racing direction). */
export function locate(tr, px, pz, hint = -1, out = { i: 0, d: 0 }) {
  let best = Infinity, bi = 0;
  const scan = (i) => {
    const dx = px - tr.x[i], dz = pz - tr.z[i], q = dx * dx + dz * dz;
    if (q < best) { best = q; bi = i; }
  };
  if (hint < 0) for (let i = 0; i < tr.N; i++) scan(i);
  else for (let k = -40; k <= 40; k++) scan((hint + k + tr.N) % tr.N);
  out.i = bi;
  out.d = (px - tr.x[bi]) * tr.nx[bi] + (pz - tr.z[bi]) * tr.nz[bi];
  return out;
}
