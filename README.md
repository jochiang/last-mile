# Last Mile

A food-delivery time-attack roguelike in a small low-poly city at night. Pick a car, take orders by driving to the restaurant you want, and get the food there before the tip drains away, without spilling the shakes or flattening the cake. Every night the car payment comes out, and it goes up every day. Make the last payment and the car is yours.

**Play:** https://jochiang.github.io/last-mile/ (phone first; desktop works too)

- **Touch:** steer by sliding your left thumb sideways from wherever it lands. Right thumb down for gas; slide it down through BOTH to the brake (left-foot braking is a real technique here: the car has weight transfer). Hold the brake at a standstill for reverse.
- **Keyboard:** WASD or arrows; R puts the car back on the road.
- The blue line is the GPS. It doesn't know the alleys, the parking lot or the park paths. You will.
- Between shifts: repairs, and a shop of mods from sticky tires to LED underglow (customers love a show).
- Six cars: three to start, three more unlocked by paying one off.

Everything is built in code: the city is generated from a hand-drawn block layout, the cars are modeled by Python scripts in Blender (`art/`), and the engine noise and the soundtrack are Web Audio synthesis (plus a handful of CC0 drum samples).

## Develop

```sh
npm install
npm run dev      # http://127.0.0.1:5395
npm run build    # static build in dist/
```

- Cars: `blender -b --python-exit-code 1 -P art/cars.py -- <id> public/models/cars/<id>.glb [preview]`
- Tools (Node, no browser): `tools/econsim.mjs` (whole runs with the driving abstracted, for the economy), `tools/runbot.mjs` and `tools/botdiag.mjs` (a bot that actually drives), `tools/carcompare.mjs` (the cars' handling side by side).
- `track.html` is the steering test circuit the game started from.
- Test knobs: `?cars=all` unlocks every car; `window.__lm` exposes the car, shift and view.

## License

MIT. Drum samples are CC0 from the Sonic Pi library; see `public/audio/drums/CREDITS.md`.
