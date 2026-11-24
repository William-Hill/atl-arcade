// Scoring formulas F3 to F7 of docs/gdd/trick-input.md, and the combo.
// Pure and immutable: each combo function returns a new combo.
// The combo is a copy of the production combo (src/sim/skate/combo.js) with
// the GDD changes: the perfect tier, the landing factor, the stumble, and the
// bail bank.

import { BEAT, COMBO, TRICK } from "./constants.js";

// --- Beat (F6) -------------------------------------------------------------

// The signed distance in ms from `t` (s) to the nearest beat. Beat 0 is at t0.
export function beatOffsetMs(t, bpm = BEAT.bpm, t0 = 0) {
  const period = 60 / bpm;
  const phase = (t - t0) / period;
  return (phase - Math.round(phase)) * period * 1000;
}

export function beatTag(offsetMs, b = BEAT) {
  if (offsetMs == null) return null;
  const a = Math.abs(offsetMs);
  if (a <= b.perfectMs) return "PERFECT";
  if (a <= b.goodMs) return "GOOD";
  return null;
}

// F6: B. A stumble or no beat clock gives 1.
export function beatFactor(offsetMs, stumble = false, k = TRICK, c = COMBO, b = BEAT) {
  if (stumble || offsetMs == null) return 1;
  const tag = beatTag(offsetMs, b);
  if (tag === "PERFECT") return k.beatPerfectBonus;
  if (tag === "GOOD") return c.beatBonus;
  return 1;
}

// --- Points (F2 in manual.js, F3, F4) ------------------------------------------

// F3. grab: null (no grab), "neutral", or "dir".
export function airPoints({ airBase, grab = null, tHold = 0, yawDeg = 0 }, k = TRICK) {
  const trickBase = grab === "neutral" ? k.trickBaseNeutral : grab === "dir" ? k.trickBaseDir : 0;
  const hold = grab ? k.holdRate * Math.min(tHold, k.holdCap) : 0;
  const n = Math.min(Math.floor(Math.abs(yawDeg) / 180 + 1e-9), k.spinCapHalfTurns);
  return Math.round(airBase + trickBase + hold + k.spinPer180 * n);
}

// F4.
export function grindPoints(meters, dir = "n", k = TRICK, c = COMBO) {
  return Math.round(c.grindBase + c.grindPerMeter * meters + (dir === "n" ? 0 : k.stanceBonus));
}

// --- Combo (F5, F7) ---------------------------------------------------------

export function createCombo() {
  return { links: [], pending: 0, multiplier: 1, score: 0, style: 0, window: 0, active: false, lastBanked: 0, best: 0, bails: 0 };
}

export function comboMultiplier(links, c = COMBO) {
  const n = links.reduce((s, l) => (l.scores ? s + 1 : s), 0);
  return Math.max(1, Math.min(c.maxMultiplier, n));
}

// F5: earned = round(P * R[r] * L * B). `landing` is "clean" or "stumble".
export function comboMove(cb, { move, name, points, offsetMs = null, landing = "clean" }, k = TRICK, c = COMBO) {
  const stumble = landing === "stumble";
  const repeat = cb.links.reduce((n, l) => (l.name === name ? n + 1 : n), 0);
  const R = c.repeatDecay[repeat] ?? 0;
  const L = stumble ? k.stumbleKeep : 1;
  const B = beatFactor(offsetMs, stumble, k, c);
  const earned = Math.round(points * R * L * B);
  const tag = stumble ? "WOBBLE" : beatTag(offsetMs);
  const link = { move, name, points, earned, repeat, landing, tag, B, scores: earned > 0 };
  const links = [...cb.links, link];
  let style = cb.style;
  if (move === "dance") style = Math.min(1, style + c.styleGain);
  if (stumble) style = Math.max(0, style - k.stumbleStyleLoss);
  return { ...cb, links, pending: cb.pending + earned, multiplier: comboMultiplier(links, c), style, window: c.linkWindow, active: true };
}

// A stumble with no link (a manual balance out pays its link with
// comboMove(..., landing: "stumble")); this only drops the style meter.
export function comboStumble(cb, k = TRICK) {
  return { ...cb, style: Math.max(0, cb.style - k.stumbleStyleLoss) };
}

export function comboBank(cb) {
  if (!cb.active) return cb;
  const banked = cb.pending * cb.multiplier;
  return { ...cb, links: [], pending: 0, multiplier: 1, window: 0, active: false, score: cb.score + banked, lastBanked: banked, best: Math.max(cb.best, banked) };
}

// F7 on a bail: bank round(pending * bailBank) at multiplier 1.
export function comboBail(cb, k = TRICK, c = COMBO) {
  const banked = Math.round(cb.pending * k.bailBank);
  return { ...cb, links: [], pending: 0, multiplier: 1, window: 0, active: false, score: cb.score + banked, lastBanked: banked, style: Math.max(0, cb.style - c.bailStyleLoss), bails: cb.bails + 1 };
}

// `open` is true while a move is in progress: the window does not count down.
export function comboTick(cb, dt, open, c = COMBO) {
  if (!cb.active) return cb;
  if (open) return cb.window === c.linkWindow ? cb : { ...cb, window: c.linkWindow };
  const left = cb.window - dt;
  if (left > 1e-9) return { ...cb, window: left };
  return comboBank(cb);
}

export const comboValue = (cb) => cb.pending * cb.multiplier;
