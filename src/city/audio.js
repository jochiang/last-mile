// All sound is synthesised with Web Audio: no files. The engine is a couple of oscillators whose
// pitch follows rpm through five fake gears; tyres, wind and grass are filtered noise; everything
// else is short one-shot synths. update() runs every frame with the car's state; event() takes the
// car's and the shift's events.

const GEARS = [0, 11, 20, 29, 38, 99];   // m/s where each gear tops out (rpm climbs, then drops a gear's worth)

export function createAudio() {
  let ctx = null, master, comp, meter, eng = null, noise = null, loops = {}, vol = 1;
  let rainOn = false;
  let gear = 0, rpm = 900, tickT = 0, lastTick = -1, beepT = 0, spillWas = 0;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = vol * 0.8;
    master.connect(comp).connect(ctx.destination);
    meter = ctx.createAnalyser(); meter.fftSize = 2048; comp.connect(meter);   // for tests: how loud is it
    // a couple of seconds of white noise, looped by every noise voice
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // engine: a power chord (sub-octave, root, fifth, octave, twelfth), every voice doubled with a
    // detuned twin so they beat against each other, then a low-mid body boost, a throttle-opened
    // low-pass and drive (user: the single-voice version sounded thin)
    const out = ctx.createGain(); out.gain.value = 0;
    const body = ctx.createBiquadFilter(); body.type = "peaking"; body.frequency.value = 160; body.Q.value = 0.9; body.gain.value = 7;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 1.6;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = (i / 256) - 1; curve[i] = Math.tanh(x * 3.2); }
    shaper.curve = curve;
    const pre = ctx.createGain(); pre.gain.value = 0.5;
    const oscs = [];
    for (const [type, mul, g] of [["triangle", 0.5, 0.55], ["sawtooth", 1, 0.42], ["sawtooth", 1.5, 0.26], ["square", 2, 0.12], ["sawtooth", 3, 0.06]]) {
      for (const cents of [-7, 6]) {
        const o = ctx.createOscillator(); o.type = type; o.detune.value = cents + (Math.random() - 0.5) * 3;
        const og = ctx.createGain(); og.gain.value = g;
        o.connect(og).connect(pre); o.start();
        oscs.push({ o, mul });
      }
    }
    pre.connect(body).connect(lp).connect(shaper).connect(out).connect(master);
    eng = { out, lp, oscs };
    // noise beds
    loops.squeal = noiseLoop("bandpass", 1500, 6);
    loops.wind = noiseLoop("lowpass", 700, 0.7);
    loops.grass = noiseLoop("lowpass", 220, 1.5);
    loops.rain = noiseLoop("highpass", 1800, 0.5);
    loops.rainLow = noiseLoop("lowpass", 400, 0.5);
  }
  function noiseLoop(type, freq, q) {
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(master); src.start(0, Math.random() * 1.5);
    return { g, f };
  }
  const set = (param, v, tc = 0.05) => param.setTargetAtTime(v, ctx.currentTime, tc);

  // --- one-shots
  function tone(freq, dur, { type = "sine", gain = 0.3, pan = 0, at = 0, glide = null, attack = 0.005 } = {}) {
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g).connect(p).connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function burst(dur, { type = "lowpass", freq = 400, q = 1, gain = 0.5, at = 0, sweep = null } = {}) {
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource(); src.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
  }
  // cues (orders, turns, the clock) sit ~1.7x hotter than effects so they cut through the engine
  const SFX = {
    thump(speed) {
      const k = Math.min(1, speed / 14);
      burst(0.25 + k * 0.2, { freq: 300 + k * 500, gain: 0.35 + k * 0.6 });
      tone(90, 0.3, { glide: 40, gain: 0.3 + k * 0.4 });
      if (k > 0.4) burst(0.3, { type: "highpass", freq: 3000, gain: 0.15 * k, at: 0.02 });   // something rattles
    },
    clang() { for (const [f, g] of [[523, 0.12], [781, 0.09], [1203, 0.06], [1650, 0.04]]) tone(f, 0.9, { type: "triangle", gain: g }); burst(0.12, { freq: 1200, gain: 0.25 }); },
    ping() { tone(1318, 0.12, { gain: 0.306 }); tone(1760, 0.25, { gain: 0.272, at: 0.09 }); },
    pickup() { tone(659, 0.12, { type: "triangle", gain: 0.425 }); tone(988, 0.25, { type: "triangle", gain: 0.425, at: 0.08 }); },
    kaching() {
      burst(0.05, { type: "highpass", freq: 2500, gain: 0.55 });
      for (const [f, at] of [[2093, 0.04], [2637, 0.1], [3136, 0.16]]) tone(f, 0.6, { gain: 0.2, at });
      tone(1046, 0.5, { type: "triangle", gain: 0.2, at: 0.04 });
    },
    sad() { tone(392, 0.25, { type: "triangle", gain: 0.34 }); tone(311, 0.45, { type: "triangle", gain: 0.34, at: 0.2 }); },
    tick(urgent) { tone(urgent ? 1900 : 1500, 0.04, { type: "square", gain: 0.102 }); },
    slosh() { burst(0.35, { type: "bandpass", freq: 500, sweep: 1400, q: 2, gain: 0.3 }); },
    turn(pan) { tone(880, 0.09, { gain: 0.272, pan }); tone(1175, 0.14, { gain: 0.272, pan, at: 0.08 }); },
    shutter() { burst(0.04, { type: "highpass", freq: 4000, gain: 0.5 }); burst(0.06, { type: "bandpass", freq: 1500, q: 3, gain: 0.4, at: 0.07 }); tone(330, 0.35, { type: "square", gain: 0.12, at: 0.15 }); },
    beep() { tone(1050, 0.22, { type: "square", gain: 0.05, attack: 0.01 }); },
    reset() { tone(500, 0.2, { glide: 250, type: "triangle", gain: 0.15 }); },
    buy() { SFX.kaching(); },
    repair() { for (let k = 0; k < 4; k++) burst(0.04, { type: "bandpass", freq: 1800, q: 4, gain: 0.25, at: k * 0.07 }); },
  };

  return {
    init,
    get ready() { return !!ctx; },
    level() {
      if (!meter) return 0;
      const a = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(a);
      return Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
    },
    setVolume(v) { vol = v; if (master) set(master.gain, v * 0.8, 0.02); },
    suspend() { ctx?.suspend(); },
    resume() { init(); ctx.resume(); this.setRain(rainOn); },
    sfx(name, ...a) { if (ctx && vol > 0) SFX[name](...a); },
    /** s: { running, speed, u, throttle, brake, slipF, slipR, off, reverse, cond } */
    update(s, dt) {
      if (!ctx) return;
      const on = s.running ? 1 : 0;
      // gears: rpm runs up through each gear's speed range, the pitch drops a step at each change
      const v = Math.abs(s.u);
      while (gear < GEARS.length - 2 && v > GEARS[gear + 1] + 0.5) gear++;
      while (gear > 0 && v < GEARS[gear] - 1.5) gear--;
      const lo = GEARS[gear], hi = GEARS[gear + 1];
      const frac = Math.min(1.1, (v - lo) / (hi - lo));
      const target = s.reverse ? 1400 + v * 250 : gear === 0 && v < 2 ? 900 + s.throttle * 2600 : 2400 + frac * 4200 + s.throttle * 300;
      rpm += (target - rpm) * Math.min(1, dt * (target < rpm ? 14 : 8));
      const f = (rpm / 60) * 2;   // a four: two pulses a revolution
      for (const { o, mul } of eng.oscs) set(o.frequency, f * mul, 0.02);
      set(eng.lp.frequency, 380 + s.throttle * 2000 + rpm * 0.18, 0.05);
      set(eng.out.gain, on * (0.13 + s.throttle * 0.17) * (0.75 + 0.25 * s.cond), 0.05);
      // tyres: squeal with the worse slip, front or rear, once moving
      const slip = Math.max(Math.abs(s.slipR) - 0.08, Math.abs(s.slipF) - 0.11, 0);
      set(loops.squeal.g.gain, on * (s.off ? 0 : Math.min(0.32, slip * 1.6)) * Math.min(1, v / 5), 0.04);
      set(loops.squeal.f.frequency, 1300 + slip * 1500, 0.05);
      set(loops.wind.g.gain, on * Math.min(0.32, (v / 40) ** 2 * 0.32), 0.1);
      set(loops.wind.f.frequency, 400 + v * 25, 0.1);
      set(loops.grass.g.gain, on * (s.off ? Math.min(0.5, v / 15 * 0.5) : 0), 0.05);
      // reversing: the delivery-van beeper
      if (s.running && s.reverse) { beepT -= dt; if (beepT <= 0) { SFX.beep(); beepT = 0.9; } } else beepT = 0;
    },
    /** the last ten seconds of an order: a soft tick each second, faster when late */
    clock(left) {
      if (!ctx) return;
      if (left > 10 || left < -30) { lastTick = -1; return; }
      const k = left > 0 ? Math.ceil(left) : Math.floor(left * 2);
      if (k !== lastTick) { lastTick = k; if (left > 0) SFX.tick(left < 4); }
    },
    setRain(on) { rainOn = on; if (!ctx) return; set(loops.rain.g.gain, on ? 0.09 : 0, 0.5); set(loops.rainLow.g.gain, on ? 0.12 : 0, 0.5); },
    spill(amount) {
      if (!ctx) return;
      if (amount - spillWas > 0.03) { SFX.slosh(); spillWas = amount; }
      if (amount < spillWas) spillWas = amount;
    },
  };
}
