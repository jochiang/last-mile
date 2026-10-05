// The three cars a run can start with (user, 2026-10-04). Each changes the physics (car2.js P),
// what knocks and hard driving cost, and the car payment, which is the run's difficulty curve.
//   Hauler:   a front-drive minivan. Heavy, tall, slow; shrugs off knocks, keeps drinks level; the
//             payments are the steepest (it's financed).
//   Liftback: the all-rounder, rear drive (the car the game was tuned on).
//   Roadster: a tiny rear-drive convertible: sharp and grippy but slow, made of tissue paper, no roof
//             (drinks slosh). The cheapest payments. Is always the answer.

export const CARS = {
  hauler: {
    name: "Hauler", kind: "Front-drive minivan",
    blurb: "Heavy, tall and slow. Shrugs off knocks and keeps drinks level. Steep payments: it's financed.",
    bill: (d) => Math.round(17 + 3.5 * (d - 1) + 0.52 * (d - 1) ** 2),   // late curve eased ~25% (2026-10-04)
    p: { m: 1950, Iz: 3300, a: 1.25, b: 1.7, hcg: 0.72, power: 175000, fMax: 9500, drag: 1.75, mu: 1.32, muOff: 1.15,
      fwd: true, rearGrip: 1.25, steerMax: 0.55, ax: 1.6, r: 1.15 },
    fx: { dmgMul: 0.6, spillMul: 0.65 },
    stats: { speed: 1, grip: 1, toughness: 5, cargo: 5 },
    audio: { pitch: 0.78 },
  },
  liftback: {
    name: "Liftback", kind: "Rear-drive hatchback",
    blurb: "The all-rounder. Quick enough, grippy enough, tough enough. Middling payments.",
    bill: (d) => Math.round(15 + 3 * (d - 1) + 0.45 * (d - 1) ** 2),
    p: {},
    fx: {},
    stats: { speed: 4, grip: 3, toughness: 3, cargo: 3 },
    audio: { pitch: 1 },
  },
  roadster: {
    name: "Roadster", kind: "Tiny rear-drive convertible",
    blurb: "Light, sharp and grippy, but slow and made of tissue paper. No roof: drinks slosh. Cheap payments. Is always the answer.",
    bill: (d) => Math.round(12 + 2.5 * (d - 1) + 0.38 * (d - 1) ** 2),
    p: { m: 960, Iz: 1150, a: 1.1, b: 1.2, hcg: 0.45, power: 100000, fMax: 8000, drag: 1.15, mu: 2.15, muOff: 1.75,
      rearGrip: 1.15, steerMax: 0.66, ax: 1.15, r: 1.0 },
    fx: { dmgMul: 1.6, spillMul: 1.25 },
    stats: { speed: 2, grip: 5, toughness: 1, cargo: 2 },
    audio: { pitch: 1.3 },
  },
};
export const CAR_ORDER = ["hauler", "liftback", "roadster"];
