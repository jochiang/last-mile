// US units for everything the player reads (user, 2026-10-04). The simulation stays metric.
export const MPH = 2.23694;   // per m/s

/** A distance the way a US nav app says it: feet in 50s, then tenths of a mile from 1,000 ft. */
export function dist(m) {
  const ft = m * 3.28084;
  if (ft < 1000) return `${Math.max(50, Math.round(ft / 50) * 50)} ft`;
  return `${(ft / 5280).toFixed(1)} mi`;
}
export const mph = (ms) => Math.round(ms * MPH);
