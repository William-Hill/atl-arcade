// The landmark chimes (#219): the Found and the Claimed chime, synthesized
// with Web Audio on the beat clock's AudioContext. The notes and the timing
// are in chime-math.js. There are no sample files.
//
// A chime plays only when the beat clock's context runs (after the first
// key or pointer press: a browser plays no sound before it) and the clock is
// not muted (?mute=1). One chime plays at a time; a Claimed chime goes
// before a Found chime. The music ducks under a chime.
//
// update() starts the next chime. The game calls it only while the
// simulation runs, so no chime starts in photo mode.

import { CHIMES, chimeLength, chimeStart, duckPoints, queueChime } from "./chime-math.js";

// `clock` is a BeatClock: ctx, running, muted, startTime, bpm, music.
export function createChimes(clock, k = CHIMES) {
  let queue = [];
  let busyUntil = -Infinity; // audio time: the end of the chime that plays
  let noise = null;
  let ctxOf = null;
  const info = { found: 0, claimed: 0, played: 0, ducked: 0, waiting: 0, last: null };

  function context() {
    if (!clock || !clock.running || clock.muted) return null;
    const c = clock.ctx;
    if (c !== ctxOf) {
      ctxOf = c;
      noise = null;
      busyUntil = -Infinity;
    }
    return c;
  }

  function noiseBuffer(c) {
    if (!noise) {
      noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    }
    return noise;
  }

  // A soft bell: a sine with a quiet octave over it, a fast attack and a decay.
  function note(c, t, n) {
    for (const [mult, level] of [[1, 1], [2, 0.25]]) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(n.freq * mult, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(n.gain * level, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + n.length);
      osc.connect(g).connect(c.destination);
      osc.start(t);
      osc.stop(t + n.length + 0.02);
    }
  }

  // The wheels: band-passed noise that falls in pitch and fades.
  function wheel(c, t, w) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(w.band[0], t);
    bp.frequency.exponentialRampToValueAtTime(w.band[1], t + w.length);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(w.gain, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + w.length);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(t, Math.random() * 0.4);
    src.stop(t + w.length + 0.02);
  }

  function duck(c, at, length) {
    const gain = clock.music?.gain?.gain;
    if (!gain) return false;
    const base = clock.musicGainValue ?? gain.value;
    const points = duckPoints(at, length, base, c.currentTime, k);
    // Hold the gain where it is now (inside the release of the chime before,
    // perhaps) and fall from there: no jump back to the full gain.
    if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(points[0].t);
    else {
      gain.cancelScheduledValues(points[0].t);
      gain.setValueAtTime(gain.value, points[0].t);
    }
    for (const p of points.slice(1)) gain.linearRampToValueAtTime(p.value, p.t);
    return true;
  }

  function start(c, type) {
    const length = chimeLength(type, k);
    const when = chimeStart({ now: c.currentTime, startTime: clock.startTime, bpm: clock.bpm, running: true }, k);
    for (const n of k[type].notes) note(c, when.at + n.at, n);
    if (k[type].wheel) wheel(c, when.at + k[type].wheel.at, k[type].wheel);
    const ducked = duck(c, when.at, length);
    busyUntil = when.at + length;
    info.played += 1;
    if (ducked) info.ducked += 1;
    info.last = { type, delay: when.delay, onGrid: when.onGrid, length, beat: 60 / clock.bpm, ducked };
  }

  return {
    // A spot was found or claimed on this simulation tick.
    play(type) {
      if (!k[type]) return;
      info[type] += 1;
      // With no sound (no gesture yet, or ?mute=1) the chime is dropped: a
      // chime that plays seconds after its banner is wrong.
      if (!context()) return;
      queue = queueChime(queue, type);
      info.waiting = queue.length;
    },
    // The game paused (photo mode, a menu): a chime that waits is dropped,
    // so it does not sound long after its find.
    clear() {
      queue = [];
      info.waiting = 0;
    },
    // Each frame while the simulation runs: starts the next chime when the
    // one before it has ended.
    update() {
      if (!queue.length) return;
      const c = context();
      if (!c) {
        queue = [];
        info.waiting = 0;
        return;
      }
      if (c.currentTime < busyUntil) return;
      const [type, ...rest] = queue;
      queue = rest;
      info.waiting = queue.length;
      start(c, type);
    },
    get info() {
      return { ...info, running: Boolean(clock?.running), muted: Boolean(clock?.muted) };
    },
  };
}
