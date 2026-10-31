// Pure beat math. No Web Audio here; the clock in beat-clock.js uses these.
//
// Times are seconds since beat 0 on the audio clock, corrected for output
// latency and the user offset. DOM input events carry a `timeStamp` on the
// performance.now() clock; an anchor pair { perf, audio } taken by the
// scheduler maps one clock onto the other.

import { BEAT } from "../sim/skate/constants.js";

export function beatLength(bpm) {
  return 60 / bpm;
}

// Nearest beat to `t` and the signed offset in ms (positive = late), with
// the PERFECT / GOOD tag and the on-beat flag.
export function judge(t, bpm = BEAT.bpm, k = BEAT) {
  const len = beatLength(bpm);
  const index = Math.round(t / len) || 0; // no negative zero
  const offsetMs = (t - index * len) * 1000;
  const abs = Math.abs(offsetMs);
  const tag = abs <= k.perfectMs ? "PERFECT" : abs <= k.goodMs ? "GOOD" : null;
  return { index, offsetMs, tag, onBeat: tag !== null };
}

// Audio-clock time (seconds since beat 0, perceived) of a DOM event.
export function inputTime(domTimeStamp, anchor, startTime, totalOffsetSec = 0) {
  const audio = anchor.audio + (domTimeStamp - anchor.perf) / 1000;
  return audio - startTime - totalOffsetSec;
}

// The performance.now() timestamp at which an input would judge as exactly
// on beat `index`. The inverse of inputTime.
export function beatPerfTime(index, bpm, anchor, startTime, totalOffsetSec = 0) {
  const audio = startTime + index * beatLength(bpm) + totalOffsetSec;
  return anchor.perf + (audio - anchor.audio) * 1000;
}

// Fraction of the way through the current beat, 0..1.
export function phase(t, bpm = BEAT.bpm) {
  const p = (t / beatLength(bpm)) % 1;
  return p < 0 ? p + 1 : p;
}

export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stddev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
