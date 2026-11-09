// Game-feel sounds (#105): bonk, landing and wall scrape, synthesized with
// Web Audio on the beat clock's AudioContext (beat-clock.js). There are no
// sample files. The parameters come from sfx-math.js; the triggers from the
// controller flags (src/render/effects/feel.js feelTriggers()).
//
// The sounds play only when the beat clock runs (after the first gesture)
// and is not muted (?mute=1). prefers-reduced-motion does not turn them
// off: it is about motion on the screen.

import { feelTriggers } from "../render/effects/feel.js";
import { SFX, bonkVoice, landVoice, scrapeLevel } from "./sfx-math.js";

// `clock` has `ctx`, `running` and `muted` (a BeatClock).
export function createSfx(clock, k = SFX) {
  let noise = null;
  let ctxOf = null;
  let scrape = null;
  let lastBonk = -Infinity;
  const info = { bonk: 0, land: 0, scrapeTicks: 0, played: 0, last: null };

  function ready() {
    if (!clock || !clock.running || clock.muted) return null;
    const c = clock.ctx;
    if (c !== ctxOf) {
      ctxOf = c;
      noise = null;
      scrape = null;
    }
    return c;
  }

  // One second of white noise, made once per context.
  function noiseBuffer(c) {
    if (!noise) {
      noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    }
    return noise;
  }

  // A pitched thud: a sine that falls an octave and a half, with a fast decay.
  function thud(c, t, freq, gain, length) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.35), t + length);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  // A short noise hit through a band-pass: the knock of a bonk, the clack
  // of the wheels.
  function hit(c, t, center, gain, length) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = center;
    bp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(t, Math.random() * 0.5);
    src.stop(t + length + 0.02);
  }

  function bonk(strength) {
    const voice = bonkVoice(strength, k);
    if (!voice) return;
    info.bonk += 1;
    info.last = { kind: "bonk", ...voice };
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    if (t - lastBonk < k.bonk.cooldown) return;
    lastBonk = t;
    thud(c, t, voice.freq, voice.gain, voice.length);
    if (voice.knock > 0) hit(c, t, 900, voice.knock, 0.05);
    info.played += 1;
  }

  function land(height) {
    const voice = landVoice(height, k);
    if (!voice) return;
    info.land += 1;
    info.last = { kind: "land", height, ...voice };
    const c = ready();
    if (!c) return;
    const t = c.currentTime;
    thud(c, t, voice.freq, voice.gain, voice.length);
    hit(c, t, 2600, voice.noise * voice.gain * 2, 0.04);
    info.played += 1;
  }

  // The scrape is one looping noise source; each slide tick sets its level
  // and schedules a fade to 0, so the sound stops by itself when the slide
  // ticks stop (the slide ends, a pause, photo mode).
  function scrapeTick(sliding, speed) {
    const level = scrapeLevel(sliding, speed, k);
    if (level.gain > 0) info.scrapeTicks += 1;
    const c = ready();
    if (!c) return;
    if (!scrape) {
      if (level.gain <= 0) return;
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c);
      src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 2.5;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(bp).connect(g).connect(c.destination);
      src.start();
      scrape = { src, bp, g };
    }
    const t = c.currentTime;
    scrape.g.gain.cancelScheduledValues(t);
    scrape.g.gain.setTargetAtTime(level.gain, t, k.scrape.attack);
    scrape.g.gain.setTargetAtTime(0, t + 0.06, k.scrape.release);
    scrape.bp.frequency.setTargetAtTime(level.band, t, 0.05);
    if (level.gain > 0) info.played += 1;
  }

  return {
    // A simulation tick: the skater before and after.
    observe(prev, next) {
      const f = feelTriggers(prev, next);
      if (f.bonk > 0) bonk(f.bonk);
      if (f.land) land(f.land.height);
      if (f.slide || scrape) scrapeTick(Boolean(f.slide), f.slide ? f.slide.speed : 0);
    },
    bonk,
    land,
    get info() {
      return { ...info, running: Boolean(clock?.running), muted: Boolean(clock?.muted) };
    },
  };
}
