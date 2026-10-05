// The score: two original tracks, synthesised live (no files), on a small step sequencer.
//   "Night Shift": synthwave (Kavinsky-adjacent). Gated snare, rolling bass, pads, arps, a lead.
//   "Lane Split":  street hip-hop (Teriyaki Boyz-adjacent). 808s, claps, a plucked riff in the
//                  Japanese In scale, brass stabs, taiko fills.
// The music follows the game: muffled through the wall in the garage and when paused; hats and
// arps push harder with speed. Works on a live AudioContext or an OfflineAudioContext (for clips).
//
// Production (2026-10-04, round 2): drums are CC0 samples (public/audio/drums, from Sonic Pi's
// library) with the synth versions as a fallback; the music sits on a bus that ducks on every kick
// (sidechain pump); the snare goes through a true gated reverb (a short, flat, abruptly cut
// impulse); drums get a punch compressor and saturation; the whole mix a glue compressor.

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// --- instruments: each schedules one note at time t into `out`
function makeKit(ctx, outD, outM, samples = {}) {
  const out = outD;
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  // a hall: a decaying noise impulse, and a dotted-eighth echo
  const verb = ctx.createConvolver();
  const ir = ctx.createBuffer(2, ctx.sampleRate * 2.4, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2); }
  verb.buffer = ir;
  const verbIn = ctx.createGain(); verbIn.gain.value = 1; verbIn.connect(verb); verb.connect(outM);
  // gated reverb: dense and flat for a quarter second, then cut dead (the 80s snare)
  const gate = ctx.createConvolver();
  const gir = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 0.26), ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = gir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (0.9 - 0.4 * (i / d.length)) * (i > d.length - 200 ? (d.length - i) / 200 : 1); }
  gate.buffer = gir;
  const gateIn = ctx.createGain(); gateIn.gain.value = 0.55; gateIn.connect(gate); gate.connect(out);
  // a kick on the beat ducks the music bus: the pump
  const duckers = [];
  const duck = (t, depth) => { for (const g of duckers) { g.gain.setTargetAtTime(1 - depth, t, 0.004); g.gain.setTargetAtTime(1, t + 0.03, 0.09); } };
  // samples: play a buffer at a rate and level, optionally into the hall or the gate
  const play = (name, t, v = 1, rate = 1, { wet = 0, gated = 0, dur = 0 } = {}) => {
    const b = samples[name]; if (!b) return false;
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = b; s.playbackRate.value = rate; g.gain.value = v;
    s.connect(g); g.connect(out);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(verbIn); }
    if (gated) { const w = ctx.createGain(); w.gain.value = gated; g.connect(w); w.connect(gateIn); }
    s.start(t); if (dur) s.stop(t + dur);
    return true;
  };
  const delay = ctx.createDelay(1.5), fb = ctx.createGain(), dlIn = ctx.createGain();
  fb.gain.value = 0.32; dlIn.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(outM);
  const env = (g, t, a, peak, d, sustain = 0.0001, len = 0) => {
    g.gain.value = 0.0001;   // closed until the note: a gain is wide open before its first automation event
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
    if (len) g.gain.setValueAtTime(Math.max(0.0001, sustain), t + len), g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.25);
  };
  const noiseSrc = (t, dur) => { const s = ctx.createBufferSource(); s.buffer = noise; s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05); return s; };
  const send = (node, wet = 0.2, echo = 0, to = outM) => {
    const dry = ctx.createGain(); dry.gain.value = 1; node.connect(dry); dry.connect(to);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; node.connect(w); w.connect(verbIn); }
    if (echo) { const e = ctx.createGain(); e.gain.value = echo; node.connect(e); e.connect(dlIn); }
  };
  let kit = {}, duckDepth = 0.6;
  const K = {
    setTempo(bpm) { delay.delayTime.value = (60 / bpm) * 0.75; },
    setKit(k, depth) { kit = k; duckDepth = depth; },
    addDucker(g) { duckers.push(g); },
    kick(t, v = 1, long = false) {
      duck(t, duckDepth * v);
      if (play(kit.kick, t, v)) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(long ? 120 : 160, t); o.frequency.exponentialRampToValueAtTime(long ? 38 : 45, t + (long ? 0.35 : 0.12));
      env(g, t, 0.002, 0.9 * v, long ? 0.9 : 0.35);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.2);
    },
    snare(t, v = 1, gated = true) {
      if (play(kit.snare, t, v * 0.9, 1, { gated: gated ? 0.6 : 0, wet: gated ? 0 : 0.12 })) return;
      const s = noiseSrc(t, 0.4), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 0.8;
      env(g, t, 0.002, 0.55 * v, gated ? 0.28 : 0.16);
      s.connect(f); f.connect(g);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
      env(og, t, 0.002, 0.35 * v, 0.1); o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.3);
      send(g, gated ? 0.55 : 0.15, 0, out);
    },
    clap(t, v = 1) {
      if (play(kit.clap, t, v * 0.8, 1, { wet: 0.25 })) return;
      const g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 1.2;
      for (const dt of [0, 0.011, 0.023]) { const s = noiseSrc(t + dt, 0.2), gg = ctx.createGain(); env(gg, t + dt, 0.001, 0.5 * v, dt === 0.023 ? 0.18 : 0.02); s.connect(gg); gg.connect(f); }
      f.connect(g); g.gain.value = 1; send(g, 0.3, 0, out);
    },
    hat(t, v = 1, open = false) {
      if (open && play(kit.ohat, t, v * 0.35, 1, { dur: 0.6 })) return;
      if (play(kit.hat, t, v * 0.5, 0.97 + Math.random() * 0.06)) return;
      const s = noiseSrc(t, 0.3), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = "highpass"; f.frequency.value = 7500;
      env(g, t, 0.001, 0.22 * v, open ? 0.22 : 0.04);
      s.connect(f); f.connect(g); g.connect(out);
    },
    tom(t, m, v = 1) {   // taiko-ish: a low thud with a skin of noise
      if (play(kit.tom, t, v * 0.6, midiHz(m) / midiHz(45), { wet: 0.18, dur: 0.5 })) return;
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(midiHz(m) * 1.6, t); o.frequency.exponentialRampToValueAtTime(midiHz(m), t + 0.08);
      env(g, t, 0.003, 0.7 * v, 0.45); o.connect(g);
      const s = noiseSrc(t, 0.1), f = ctx.createBiquadFilter(), ng = ctx.createGain(); f.type = "lowpass"; f.frequency.value = 900; env(ng, t, 0.001, 0.3 * v, 0.06);
      s.connect(f); f.connect(ng); ng.connect(g);
      send(g, 0.35, 0, out); o.start(t); o.stop(t + 0.8);
    },
    bass(t, m, dur, v = 1) {   // synthwave: saw through a plucky low-pass
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = "sawtooth"; o.frequency.value = midiHz(m);
      f.type = "lowpass"; f.Q.value = 6; f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(260, t + 0.14);
      env(g, t, 0.004, 0.5 * v, dur * 0.9, 0.0001);
      o.connect(f); f.connect(g); g.connect(outM); o.start(t); o.stop(t + dur + 0.1);
      // a sine an octave down underneath, for weight
      const sub = ctx.createOscillator(), sg = ctx.createGain(); sub.frequency.value = midiHz(m - 12); env(sg, t, 0.004, 0.35 * v, dur * 0.9, 0.0001);
      sub.connect(sg); sg.connect(outM); sub.start(t); sub.stop(t + dur + 0.1);
    },
    sub808(t, m, dur, v = 1, glideTo = null) {   // street: a long sine with a little drive
      const o = ctx.createOscillator(), sh = ctx.createWaveShaper(), g = ctx.createGain();
      // an odd-length, symmetric curve: silence maps to exactly zero (an even length leaves a DC offset)
      const c = new Float32Array(257); for (let i = 0; i < 257; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 2.5); }
      sh.curve = c; o.frequency.setValueAtTime(midiHz(m), t);
      if (glideTo !== null) o.frequency.exponentialRampToValueAtTime(midiHz(glideTo), t + dur * 0.6);
      env(g, t, 0.005, 0.55 * v, dur, 0.0001);
      o.connect(sh); sh.connect(g); g.connect(outM); o.start(t); o.stop(t + dur + 0.1);
    },
    pad(t, notes, dur, v = 1) {   // three detuned saws a note, slow in, through a soft low-pass
      const f = ctx.createBiquadFilter(), g = ctx.createGain(), hp = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1500; f.Q.value = 0.5;
      hp.type = "highpass"; hp.frequency.value = 200;   // leave the low end to the bass
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12 * v, t + 0.6); g.gain.setValueAtTime(0.12 * v, t + dur - 0.2); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
      for (const m of notes) for (const det of [-9, 0, 8]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = midiHz(m); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.7); }
      f.connect(hp); hp.connect(g); send(g, 0.45);
    },
    arp(t, m, v = 1, bright = 1) {   // a square pluck with an echo
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = midiHz(m);
      f.type = "lowpass"; f.Q.value = 4; f.frequency.setValueAtTime(900 + 2600 * bright, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.12);
      env(g, t, 0.002, 0.11 * v, 0.14);
      o.connect(f); f.connect(g); send(g, 0.2, 0.35); o.start(t); o.stop(t + 0.3);
    },
    lead(t, m, dur, v = 1) {   // two saws an octave apart with vibrato, into the hall and the echo
      const g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2600;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.5; lg.gain.value = 6; lfo.connect(lg);
      for (const [mul, gg] of [[1, 1], [2, 0.3]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = "sawtooth"; o.frequency.value = midiHz(m) * mul; lg.connect(o.detune); og.gain.value = gg;
        o.connect(og); og.connect(f); o.start(t); o.stop(t + dur + 0.4);
      }
      lfo.start(t); lfo.stop(t + dur + 0.4);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.13 * v, t + 0.03); g.gain.setValueAtTime(0.12 * v, t + dur * 0.85); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
      f.connect(g); send(g, 0.4, 0.3);
    },
    pluck(t, m, v = 1) {   // koto-ish: a bright triangle twang through a resonant band-pass
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = midiHz(m); o2.type = "sawtooth"; o2.frequency.value = midiHz(m) * 2.005;
      const g2 = ctx.createGain(); g2.gain.value = 0.25; o2.connect(g2); g2.connect(f);
      f.type = "bandpass"; f.frequency.setValueAtTime(midiHz(m) * 4, t); f.frequency.exponentialRampToValueAtTime(midiHz(m) * 1.5, t + 0.25); f.Q.value = 2;
      env(g, t, 0.002, 0.32 * v, 0.5);
      o.connect(f); f.connect(g); send(g, 0.25, 0.22); o.start(t); o.stop(t + 0.7); o2.start(t); o2.stop(t + 0.7);
    },
    impact(t) { play("impact", t, 0.7, 1, { wet: 0.3 }); play("splash", t, 0.35); },
    stab(t, notes, v = 1) {   // brass-ish: saws with a quick filter swell
      const f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = "lowpass"; f.Q.value = 2;
      f.frequency.setValueAtTime(600, t); f.frequency.linearRampToValueAtTime(2800, t + 0.05); f.frequency.exponentialRampToValueAtTime(900, t + 0.35);
      env(g, t, 0.01, 0.16 * v, 0.4);
      for (const m of notes) for (const det of [-6, 6]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = midiHz(m); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + 0.6); }
      f.connect(g); send(g, 0.35);
    },
  };
  return K;
}

// --- the songs. A bar is 16 steps; drum rows are strings ("x" hit, "o" accent, "." rest).
const bars = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const hits = (row) => [...row].map((c, i) => (c === "x" || c === "o" ? [i, c === "o" ? 1 : 0.7] : null)).filter(Boolean);

const NIGHT_SHIFT = {
  name: "Night Shift", bpm: 108, duck: 0.65, swing: 0,
  kit: { kick: "kick_klub", snare: "snare_dolf", clap: "clap_snap", hat: "hat_gnu", ohat: "hat_open", tom: "tom_lo" },
  // Am F C G: roots (bass octave) and pad voicings
  chords: [[45, [57, 60, 64]], [41, [57, 60, 65]], [48, [55, 60, 64]], [43, [55, 59, 62]]],
  // an original eight-bar tune in A minor (eighths; null = rest, numbers held until the next note)
  lead: [76, null, 74, 72, 69, null, null, null, 72, null, 69, null, 65, null, 67, 69,
    67, null, 76, null, 74, 72, null, null, 71, null, null, 74, null, null, null, null,
    76, null, 79, null, 81, null, 79, 76, 77, null, 76, null, 72, null, 69, null,
    76, null, 74, 72, 74, null, 76, null, 74, null, null, null, 71, null, null, null],
  sections: [["intro", 4], ["verse", 8], ["chorus", 8], ["verse", 8], ["break", 4], ["chorus", 8]],
  play(K, sec, bar, t, step, beat, mix) {
    const [root, pad] = this.chords[bar % 4];
    const full = sec !== "intro" && sec !== "break";
    if (bar % 1 === 0) K.pad(t, pad, 4 * beat, sec === "break" ? 1.2 : 0.8);
    // the arp: chord tones climbing two octaves, sixteenths
    const tones = [pad[0], pad[1], pad[2], pad[0] + 12, pad[1] + 12, pad[2] + 12, pad[0] + 24, pad[2] + 12];
    for (let s = 0; s < 16; s++) K.arp(t + s * step, tones[s % 8], (s % 4 === 0 ? 1 : 0.7) * (0.7 + 0.5 * mix), sec === "intro" ? 0.2 + bar * 0.2 : 0.6 + 0.4 * mix);
    if (!full) return;
    // drums: four on the floor in the chorus, a big gated snare on 2 and 4
    for (const [i, v] of hits(sec === "chorus" ? "o...x...o...x..." : "o.......x.o.....")) K.kick(t + i * step, v);
    for (const [i, v] of hits("....o.......o...")) K.snare(t + i * step, v);
    for (const [i, v] of hits(mix > 0.6 ? "xxoxxxoxxxoxxxox" : "x.o.x.o.x.o.x.o.")) K.hat(t + i * step, v * (0.6 + 0.6 * mix));
    if (sec === "chorus") for (const [i] of hits("..x...x...x...x.")) K.hat(t + i * step, 0.8, true);
    // a galloping bass: root, with an octave on the off-beat sixteenths
    for (const [i] of hits("x.xxx.xxx.xxx.xx")) K.bass(t + i * step, root + (i % 4 === 3 ? 12 : 0), step * 0.9);
    if (sec === "chorus") {
      const phrase = this.lead.slice((bar % 8) * 8, (bar % 8) * 8 + 8);
      phrase.forEach((m, k) => {
        if (m === null) return;
        let len = 1; while (k + len < 8 && phrase[k + len] === null) len++;
        K.lead(t + k * 2 * step, m, len * 2 * step * 0.95);
      });
    }
  },
};

const LANE_SPLIT = {
  name: "Lane Split", bpm: 94, duck: 0.3, swing: 0.12,
  kit: { kick: "kick_808", snare: "snare_hi", clap: "clap_snap2", hat: "hat_tap", ohat: "hat_open", tom: "tom_lo" },
  // a two-bar riff in D, In scale (D Eb G A Bb), sixteenths
  riff: [74, null, null, 74, 75, null, 74, null, 69, null, null, 70, 69, null, 67, null,
    74, null, null, 74, 75, null, 79, null, 81, null, 79, null, 75, null, 74, null],
  sections: [["intro", 4], ["verse", 8], ["hook", 8], ["verse", 8], ["break", 4], ["hook", 8]],
  play(K, sec, bar, t, step, beat, mix) {
    const half = bar % 2;
    const full = sec !== "intro" && sec !== "break";
    // the riff (an octave up and busier in the hook)
    this.riff.slice(half * 16, half * 16 + 16).forEach((m, s) => { if (m !== null) K.pluck(t + s * step, m + (sec === "hook" && s % 8 === 0 ? 12 : 0), sec === "intro" ? 0.6 : 0.9); });
    if (sec === "break" || (sec === "intro" && bar === 3)) for (const [i, v] of hits(half ? "o..x..x.o.x.xxxx" : "o.....o...o.....")) K.tom(t + i * step, i < 8 ? 38 : 43, v);
    if (!full) return;
    const kicks = half ? "o.........o..x.." : "o......x..o.....";
    for (const [i, v] of hits(kicks)) K.kick(t + i * step, v, true);
    for (const [i] of hits(kicks)) K.sub808(t + i * step, 38 + (half && i > 8 ? 1 : 0), beat * 1.6, 0.9, half && i === 10 ? 39 : null);
    for (const [i, v] of hits("....o.......o...")) K.clap(t + i * step, v);
    const hatRow = bar % 4 === 3 ? "x.x.x.x.x.xxxxxx" : mix > 0.6 ? "x.xxx.x.x.xxx.x." : "x.x.x.x.x.x.x.x.";
    for (const [i, v] of hits(hatRow)) K.hat(t + i * step, v * (0.6 + 0.5 * mix));
    if (sec === "hook" && bar === 0) K.impact(t);
    if (sec === "hook" && half === 0) K.stab(t, [62, 67, 69], 1), K.stab(t + 3 * step, [62, 67, 69], 0.7), K.stab(t + 6 * step, [63, 67, 70], 0.9);
  },
};

export const TRACKS = { synthwave: NIGHT_SHIFT, street: LANE_SPLIT };

const SAMPLE_NAMES = ["kick_klub", "kick_808", "snare_dolf", "snare_hi", "clap_snap", "clap_snap2", "hat_gnu", "hat_tap", "hat_open", "tom_lo", "impact", "splash"];
/** Fetch and decode the drum samples on a context. Missing ones fall back to the synth drums. */
export async function loadSamples(ctx, base = "/audio/drums/") {
  const out = {};
  await Promise.all(SAMPLE_NAMES.map(async (n) => {
    try { const r = await fetch(`${base}${n}.flac`); out[n] = await ctx.decodeAudioData(await r.arrayBuffer()); } catch { /* synth fallback */ }
  }));
  return out;
}

/** A player for one track on a context. mix(0..1): intensity, e.g. from speed. */
export function createMusic(ctx, dest, samples = {}) {
  const bus = ctx.createGain(); bus.gain.value = 0.0001;
  const muffle = ctx.createBiquadFilter(); muffle.type = "lowpass"; muffle.frequency.value = 18000;
  // the glue: a gentle compressor over everything
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -20; glue.ratio.value = 3; glue.attack.value = 0.012; glue.release.value = 0.2; glue.knee.value = 8;
  bus.connect(glue); glue.connect(muffle); muffle.connect(dest);
  // drums: a punchy compressor and a touch of saturation
  const drumComp = ctx.createDynamicsCompressor();
  drumComp.threshold.value = -16; drumComp.ratio.value = 4; drumComp.attack.value = 0.006; drumComp.release.value = 0.12;
  const sat = ctx.createWaveShaper(); const c = new Float32Array(257); for (let i = 0; i < 257; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); } sat.curve = c;
  const drums = ctx.createGain(); drums.gain.value = 0.9;
  drums.connect(drumComp); drumComp.connect(sat); sat.connect(bus);
  // music: everything melodic, ducked on the kick
  const music = ctx.createGain(); music.gain.value = 0.85;
  const ducker = ctx.createGain(); ducker.gain.value = 1;
  music.connect(ducker); ducker.connect(bus);
  const K = makeKit(ctx, drums, music, samples);
  K.addDucker(ducker);
  let track = null, playing = false, nextBar = 0, barIdx = 0, timer = null, mix = 0.5;
  const sectionAt = (song, n) => {
    const total = song.sections.reduce((a, [, b]) => a + b, 0);
    let k = n >= 4 ? 4 + ((n - 4) % (total - 4)) : n;   // the intro plays once, then the rest loops
    for (const [s, b] of song.sections) { if (k < b) return [s, k]; k -= b; }
    return ["verse", 0];
  };
  function scheduleBar() {
    const beat = 60 / track.bpm, step = beat / 4;
    const [sec, b] = sectionAt(track, barIdx);
    // swing: every other sixteenth a little late (a stand-in K that shifts its time argument)
    const swung = track.swing ? new Proxy(K, { get: (o, k) => (typeof o[k] === "function" ? (t, ...a) => o[k](swingT(t), ...a) : o[k]) }) : K;
    const t0 = nextBar, swingT = (t) => { const i = Math.round((t - t0) / step); return Math.abs(t - (t0 + i * step)) < 1e-4 && i % 2 === 1 ? t + step * track.swing : t; };
    track.play(swung, sec, b, nextBar, step, beat, mix);
    nextBar += beat * 4; barIdx++;
  }
  const start = (id) => { track = TRACKS[id]; K.setTempo(track.bpm); K.setKit(track.kit, track.duck); };
  return {
    bus, muffle,
    play(id, vol = 1) {
      this.stop();
      if (!TRACKS[id]) return;
      start(id);
      playing = true; barIdx = 0; nextBar = ctx.currentTime + 0.1;
      bus.gain.cancelScheduledValues(ctx.currentTime); bus.gain.setTargetAtTime(0.5 * vol, ctx.currentTime, 0.4);
      // schedule a couple of seconds ahead
      timer = setInterval(() => { while (playing && nextBar < ctx.currentTime + 2.2) scheduleBar(); }, 200);
      while (nextBar < ctx.currentTime + 2.2) scheduleBar();
    },
    stop() { playing = false; if (timer) clearInterval(timer); timer = null; bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2); },
    setVolume(v) { if (playing) bus.gain.setTargetAtTime(0.5 * v, ctx.currentTime, 0.2); },
    setMix(v) { mix = v; },
    // through the wall: the garage, the pause menu
    setMuffled(on) { muffle.frequency.setTargetAtTime(on ? 700 : 18000, ctx.currentTime, 0.25); },
    setSamples(sm) { Object.assign(samples, sm); },
    /** For offline clips: schedule `seconds` of a track from t = 0 in one go. */
    renderAll(id, seconds, mixFn = () => 0.6) {
      start(id); barIdx = 0; nextBar = 0.05;
      bus.gain.value = 0.5;
      while (nextBar < seconds) { mix = mixFn(nextBar); scheduleBar(); }
    },
  };
}
