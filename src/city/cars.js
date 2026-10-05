// The three cars a run can start with (user, 2026-10-04). Each changes the physics (car2.js P),
// what knocks and hard driving cost, and the car payment, which is the run's difficulty curve.
// term: the loan's length in days. Make the last payment and the car is yours: the run is won
// (2026-10-05, user: "Do we have a victory state lol"; a strong run had died on day 12).
//   Hauler:   a front-drive minivan. Heavy, tall, slow; shrugs off knocks, keeps drinks level; the
//             payments are the steepest (it's financed).
//   Liftback: the all-rounder, rear drive (the car the game was tuned on).
//   Roadster: a tiny rear-drive convertible: sharp and grippy but slow, made of tissue paper, no roof
//             (drinks slosh). The cheapest payments. Is always the answer.
// Unlocked by paying a car off (2026-10-05, user: "Let's do more cars"); unlock: the car to pay off.
//   Kei truck:   a tiny cab-over pickup. Narrow enough to thread traffic, slow, tippy; the bag rides in the
//                bed. Unlocked by the hauler.
//   Interceptor: an ex-police sedan from the auction. Big V8, heavy, soft, tough, push bar. Customers think
//                you're a cop (fewer tips); speed cameras let it go. Unlocked by the liftback.
//   Rally hatch: an all-wheel-drive turbo hatch. Fast, grippy, barely cares about rain; fragile and
//                expensive. Unlocked by the roadster.

export const CARS = {
  hauler: {
    name: "Hauler", kind: "Front-drive minivan",
    blurb: "Heavy, tall and slow. Shrugs off knocks and keeps drinks level. Steep payments: it's financed.",
    bill: (d) => Math.round(17 + 3.5 * (d - 1) + 0.52 * (d - 1) ** 2),   // late curve eased ~25% (2026-10-04)
    term: 15,
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
    term: 14,
    p: {},
    fx: {},
    stats: { speed: 4, grip: 3, toughness: 3, cargo: 3 },
    audio: { pitch: 1 },
  },
  roadster: {
    name: "Roadster", kind: "Tiny rear-drive convertible",
    blurb: "Light, sharp and grippy, but slow and made of tissue paper. No roof: drinks slosh. Cheap payments. Is always the answer.",
    bill: (d) => Math.round(12 + 2.5 * (d - 1) + 0.38 * (d - 1) ** 2),
    term: 12,
    p: { m: 960, Iz: 1150, a: 1.1, b: 1.2, hcg: 0.45, power: 100000, fMax: 8000, drag: 1.15, mu: 2.15, muOff: 1.75,
      rearGrip: 1.15, steerMax: 0.66, ax: 1.15, r: 1.0 },
    fx: { dmgMul: 1.6, spillMul: 1.25 },
    stats: { speed: 2, grip: 5, toughness: 1, cargo: 2 },
    audio: { pitch: 1.3 },
  },
  kei: {
    name: "Kei Truck", kind: "Tiny cab-over pickup", unlock: "hauler",
    blurb: "Narrow enough to thread traffic and slip down any alley. Slow, light and a bit tippy; the bag rides strapped in the bed. The cheapest payments.",
    bill: (d) => Math.round(11 + 2.3 * (d - 1) + 0.36 * (d - 1) ** 2),
    term: 12,
    p: { m: 820, Iz: 900, a: 0.85, b: 1.05, hcg: 0.68, power: 64000, fMax: 6200, drag: 1.25, mu: 1.75, muOff: 1.5,
      rearGrip: 1.2, steerMax: 0.7, ax: 0.95, r: 0.8 },
    fx: { dmgMul: 1.25, spillMul: 1.1 },
    stats: { speed: 1, grip: 3, toughness: 2, cargo: 4 },
    audio: { pitch: 1.45 },
  },
  interceptor: {
    name: "Interceptor", kind: "Ex-police sedan", unlock: "liftback",
    blurb: "An auction special: big V8, push bar, soft springs, built like a vault. Customers think you're a cop (−15% tips). Speed cameras let it go.",
    bill: (d) => Math.round(16 + 3.2 * (d - 1) + 0.48 * (d - 1) ** 2),
    term: 14,
    p: { m: 1800, Iz: 2900, a: 1.35, b: 1.55, hcg: 0.6, power: 270000, fMax: 14500, drag: 1.45, mu: 1.65, muOff: 1.4,
      rearGrip: 1.06, steerMax: 0.56, ax: 1.45, r: 1.08 },
    fx: { dmgMul: 0.7, tipMul: 0.85, bullbar: true, noFines: true },
    stats: { speed: 5, grip: 2, toughness: 4, cargo: 3 },
    audio: { pitch: 0.7 },
  },
  rally: {
    name: "Rally Hatch", kind: "All-wheel-drive turbo hatch", unlock: "roadster",
    blurb: "All four wheels pull: launches hard, corners flat and barely notices the rain. Fragile, thirsty and expensive.",
    bill: (d) => Math.round(18 + 3.6 * (d - 1) + 0.54 * (d - 1) ** 2),
    term: 14,
    p: { m: 1300, Iz: 1800, a: 1.15, b: 1.3, hcg: 0.5, power: 225000, fMax: 15500, drag: 1.4, mu: 1.95, muOff: 1.75,
      awd: 0.4, rearGrip: 1.15, steerMax: 0.62 },
    fx: { dmgMul: 1.25, spillMul: 1.1, rainGrip: 0.93 },
    stats: { speed: 4, grip: 5, toughness: 2, cargo: 2 },
    audio: { pitch: 1.15 },
  },
};
export const CAR_ORDER = ["hauler", "liftback", "roadster", "kei", "interceptor", "rally"];
