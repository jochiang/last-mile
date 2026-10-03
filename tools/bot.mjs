// A pure-pursuit driver: checks the track is drivable, laps count, and gives reference lap times.
// usage: node tools/bot.mjs [laps] [--drift] [--noise 0..1]
import { buildTrack } from "../src/track.js";
import { makeCar, stepCar, makeTimer, stepTimer } from "../src/car.js";

const args = process.argv.slice(2);
const laps = +args.find((a) => /^\d+$/.test(a)) || 3;
const drift = args.includes("--drift");
const noise = args.includes("--noise") ? +args[args.indexOf("--noise") + 1] : 0;
const tr = buildTrack();
const c = makeCar(tr), t = makeTimer();
let prev = 0, seed = 7, stats = { boosts: 0, walls: 0, resets: 0, maxSpeed: 0 };
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
while (t.laps.length < laps && t.tick < 60 * 60 * 5) {
  const s = Math.hypot(c.vx, c.vz);
  const look = Math.round(8 + s * 0.45);
  const j = (c.i + look) % tr.N;
  const ang = Math.atan2(tr.x[j] - c.x, tr.z[j] - c.z);
  let err = Math.atan2(Math.sin(c.h - ang), Math.cos(c.h - ang));   // + = target is to the right
  let steer = Math.max(-1, Math.min(1, err * 2.2 + rnd() * noise));
  // how sharp is the road ahead
  let k = 0;
  for (let m = 5; m < 40; m += 5) k = Math.max(k, Math.abs(tr.curv[(c.i + Math.round(s * 0.4) + m) % tr.N]));
  const brake = !drift && s * s * k > 30;
  const wantDrift = drift && k > 1 / 32 && s > 20;
  // keep drifting while the corner lasts and the line still wants to turn our way
  const inp = { steer, drift: wantDrift || (c.drifting && k > 1 / 50 && err * c.dDir > -0.04), brake };
  stepCar(c, inp, tr);
  for (const e of c.events) { if (e.type === "boost") stats.boosts++; if (e.type === "reset") stats.resets++; }
  stats.maxSpeed = Math.max(stats.maxSpeed, s);
  const lap = stepTimer(t, c, tr, prev, steer);
  prev = steer;
  if (lap) console.log(`lap ${t.laps.length}: ${lap.time.toFixed(2)}s  off-road ${(lap.off * 100).toFixed(0)}%  walls ${lap.walls}`);
}
console.log(`${t.laps.length} laps in ${(t.tick / 60).toFixed(1)}s; top speed ${(stats.maxSpeed * 3.6).toFixed(0)} km/h, boosts ${stats.boosts}, resets ${stats.resets}`);
