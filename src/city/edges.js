// Street geometry (2026-10-05, user: "almost every turn being a hard 90 limits the mechanical
// expression"; the city got a diagonal avenue and two sweeping corners). A street (edge) is a
// polyline from node a to node b: pts [[x, z]...], cum[i] = metres to pts[i], len. Straight streets
// have two points. Everything that walks along a street goes through these.

/** Fill in an edge's polyline bookkeeping. */
export function setPts(e, pts) {
  e.pts = pts;
  e.cum = [0];
  for (let i = 1; i < pts.length; i++) e.cum.push(e.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  e.len = e.cum[e.cum.length - 1];
  [e.ax, e.az] = pts[0]; [e.bx, e.bz] = pts[pts.length - 1];
  e.straight = pts.length === 2;
  return e;
}

/** The point s metres along e (from a), and the unit direction of travel there (toward b). */
export function pointAt(e, s) {
  s = Math.max(0, Math.min(e.len, s));
  const c = e.cum;
  let i = 0;
  while (i < c.length - 2 && c[i + 1] < s) i++;
  const [ax, az] = e.pts[i], [bx, bz] = e.pts[i + 1], L = c[i + 1] - c[i] || 1e-9, f = (s - c[i]) / L;
  return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, dx: (bx - ax) / L, dz: (bz - az) / L };
}

/** The nearest point on e to (x, z): t (metres from a), d (distance), px/pz, and the direction there. */
export function project(e, x, z) {
  let best = null;
  for (let i = 0; i < e.pts.length - 1; i++) {
    const [ax, az] = e.pts[i], [bx, bz] = e.pts[i + 1], L = e.cum[i + 1] - e.cum[i] || 1e-9;
    const f = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (L * L)));
    const px = ax + (bx - ax) * f, pz = az + (bz - az) * f, d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) best = { t: e.cum[i] + L * f, d, px, pz, dx: (bx - ax) / L, dz: (bz - az) / L };
  }
  return best;
}

/** The polyline's points strictly between t0 and t1 (either order), in that order of travel. */
export function between(e, t0, t1) {
  const out = [];
  if (t0 <= t1) { for (let i = 1; i < e.pts.length - 1; i++) if (e.cum[i] > t0 && e.cum[i] < t1) out.push(e.pts[i]); }
  else { for (let i = e.pts.length - 2; i >= 1; i--) if (e.cum[i] < t0 && e.cum[i] > t1) out.push(e.pts[i]); }
  return out;
}

/** Leaving node n along e: the unit direction (for turn arithmetic at junctions). */
export function dirFrom(e, n) {
  const p = n === e.a ? pointAt(e, 0) : pointAt(e, e.len);
  return n === e.a ? [p.dx, p.dz] : [-p.dx, -p.dz];
}

// --- convex polygons ([[x, z]...]), for blocks cut by the diagonal and rounded by the corners

/** Keep the part of a convex polygon where nx*x + nz*z >= c. */
export function clipHalf(poly, nx, nz, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length];
    const dp = nx * P[0] + nz * P[1] - c, dq = nx * Q[0] + nz * Q[1] - c;
    if (dp >= 0) out.push(P);
    if ((dp >= 0) !== (dq >= 0)) { const f = dp / (dp - dq); out.push([P[0] + (Q[0] - P[0]) * f, P[1] + (Q[1] - P[1]) * f]); }
  }
  return out;
}
export function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]; a += x0 * z1 - x1 * z0; }
  return a / 2;
}
export const rectPoly = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
