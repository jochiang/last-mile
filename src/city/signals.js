// Traffic lights on Broadway's junctions (2026-10-05, user: "Do we need street lights so the NPCs
// don't get crazy"; they did: with six approaches the take-turns rule jammed every Broadway junction).
// Three phases each: the east-west street, the north-south street, Broadway. NPCs only enter on green
// (or a yellow they can't stop for); nothing makes the player stop.

export const SIG = { green: 9, yellow: 2.5, allRed: 1.5 };
const PH = SIG.green + SIG.yellow + SIG.allRed, CYCLE = 3 * PH;

/** Which phase an approach along street e belongs to. */
export const approachPhase = (e) => (e.name === "Broadway" ? 2 : Math.abs(e.bx - e.ax) > Math.abs(e.bz - e.az) ? 0 : 1);

/** "green" | "yellow" | "red" for that phase at junction node, at time t (s). Junctions are offset. */
export function signalState(node, phase, t) {
  const k = (((t + node * 7.3) % CYCLE) + CYCLE) % CYCLE, cur = Math.floor(k / PH), w = k - cur * PH;
  if (cur !== phase) return "red";
  return w < SIG.green ? "green" : w < SIG.green + SIG.yellow ? "yellow" : "red";
}
