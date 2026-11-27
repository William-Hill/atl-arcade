// Combo state machine and scoring. Pure, immutable: every function returns
// a new combo object.
//
// A move adds a link. The multiplier equals the count of links that earn
// points, up to `maxMultiplier` (THPS style). A repeat of the same move name
// in one combo earns less (`repeatDecay`); a repeat past the end of that list
// earns 0 points and does not raise the multiplier (#75).
// The combo stays open while a move is in progress (grind, air, style move)
// and for `linkWindow` seconds after. When the window runs out the pending
// points times the multiplier bank into the score. A bail banks `bailBank`
// (25%) of the pending points at multiplier 1 and drops the style meter
// (docs/gdd/trick-input.md F7).
//
// Link score (F5): earned = round(P * R[r] * L * B). R is the repeat decay,
// L is 1 on a clean landing and `stumbleKeep` on a stumble, and B is the beat
// factor (F6): `beatPerfectBonus` for PERFECT, `beatBonus` for GOOD, else 1,
// and 1 on a stumble.

import { BEAT, COMBO } from "./constants.js";

// F6: the beat tag of an offset in ms from the nearest beat (the audio clock).
export function beatTag(offsetMs, b = BEAT) {
  if (offsetMs == null || !Number.isFinite(offsetMs)) return null;
  const a = Math.abs(offsetMs);
  if (a <= b.perfectMs) return "PERFECT";
  if (a <= b.goodMs) return "GOOD";
  return null;
}

// F6: B from a beat tag. A stumble or no beat clock gives 1.
export function beatFactorOfTag(tag, stumble = false, k = COMBO) {
  if (stumble) return 1;
  if (tag === "PERFECT") return k.beatPerfectBonus ?? k.beatBonus;
  if (tag === "GOOD") return k.beatBonus;
  return 1;
}

// F6: B from an offset in ms. This is the pure beat function of the GDD
// criteria (20 ms 1.75, 21 ms 1.5, 60 ms 1.5, 61 ms 1).
export const beatFactor = (offsetMs, stumble = false, k = COMBO, b = BEAT) => beatFactorOfTag(beatTag(offsetMs, b), stumble, k);

export function createCombo() {
  return {
    links: [], // [{ move, name, points, onBeat }]
    pending: 0, // points before the multiplier
    multiplier: 1,
    score: 0, // banked
    style: 0, // 0..1
    signatureReady: false,
    window: 0, // seconds left before the combo banks
    active: false,
    lastBanked: 0,
    bails: 0,
    best: 0, // best banked combo
  };
}

// `beat` is the judge result { tag, offsetMs } of the judged moment, or null.
// `onBeat` with no beat counts as GOOD (the old call). `landing` is "clean"
// or "stumble" (R10).
// `dir` is the direction that chose the trick ("n", "l", "r", "u", "d"), or
// null when no direction chose it (no trick input, one-button mode). The HUD
// trick line shows it as an arrow (docs/ux/trick-hud.md 5.1).
export function comboMove(c, { move, name, points, onBeat = false, beat = null, landing = "clean", dir = null }, k = COMBO) {
  const stumble = landing === "stumble";
  const tag = stumble ? null : beat ? (beat.tag ?? null) : onBeat ? "GOOD" : null;
  const bonus = beatFactorOfTag(tag, stumble, k);
  const repeat = c.links.reduce((n, l) => (l.name === name ? n + 1 : n), 0);
  const decay = k.repeatDecay[repeat] ?? 0;
  const keep = stumble ? (k.stumbleKeep ?? 1) : 1;
  const earned = Math.round(points * decay * keep * bonus);
  const hit = tag !== null;
  const links = [...c.links, { move, name, points: earned, base: points, onBeat: hit, tag, beat, repeat, landing, dir, scores: earned > 0 }];
  let style = move === "style" ? Math.min(1, c.style + k.styleGain) : c.style;
  if (stumble) style = Math.max(0, style - (k.stumbleStyleLoss ?? 0));
  return {
    ...c,
    links,
    pending: c.pending + earned,
    multiplier: comboMultiplier(links, k),
    style,
    signatureReady: style >= 1,
    window: k.linkWindow,
    active: true,
  };
}

// The count of links that earn points, from 1 to `maxMultiplier`.
export function comboMultiplier(links, k = COMBO) {
  const scoring = links.reduce((n, l) => (l.scores === false ? n : n + 1), 0);
  return Math.max(1, Math.min(k.maxMultiplier, scoring));
}

// R10, F7: a bail (a grind balance out or a respawn) banks
// round(pending * bailBank) at multiplier 1, and drops the style meter.
export function comboBail(c, k = COMBO) {
  const style = Math.max(0, c.style - k.bailStyleLoss);
  const banked = Math.round(c.pending * (k.bailBank ?? 0));
  return { ...c, links: [], pending: 0, multiplier: 1, window: 0, active: false, style, signatureReady: style >= 1, bails: c.bails + 1, score: c.score + banked, lastBanked: banked, best: Math.max(c.best, banked) };
}

// R10: a stumble with no new link (for example a manual balance out after the
// manual link was added at the cap) drops the style meter only.
export function comboStumble(c, k = COMBO) {
  const style = Math.max(0, c.style - (k.stumbleStyleLoss ?? 0));
  return { ...c, style, signatureReady: style >= 1 };
}

export function comboBank(c) {
  if (!c.active) return c;
  const banked = c.pending * c.multiplier;
  return { ...c, links: [], pending: 0, multiplier: 1, window: 0, active: false, score: c.score + banked, lastBanked: banked, best: Math.max(c.best, banked) };
}

// `open` is true while a move is in progress; the window does not count down.
export function comboTick(c, dt, open, k = COMBO) {
  if (!c.active) return c;
  if (open) return c.window === k.linkWindow ? c : { ...c, window: k.linkWindow };
  const left = c.window - dt;
  if (left > 0) return { ...c, window: left };
  return comboBank(c);
}

export function comboValue(c) {
  return c.pending * c.multiplier;
}

export function comboString(c) {
  return c.links.map((l) => (l.onBeat ? `${l.name}!` : l.name)).join(" + ");
}

// The HUD combo line (#269). A long combo shows its last links and the link
// count, so the line does not grow with no limit. `maxLinks` is the most
// links that show; `maxChars` is the most characters before the count. The
// line drops older links until it fits, but it always keeps the last link.
// Example, 8 links: "… Rail Grind + Hop! + Rail Grind + Hop! (8)".
export const COMBO_LINE = {
  desktop: { maxLinks: 4, maxChars: 48 },
  phone: { maxLinks: 3, maxChars: 30 },
};

export function comboLine(links, { maxLinks = 4, maxChars = 48 } = {}) {
  const names = links.map((l) => (l.onBeat ? `${l.name}!` : l.name));
  if (names.length <= maxLinks) {
    const all = names.join(" + ");
    if (all.length <= maxChars) return all;
  }
  let shown = Math.max(1, Math.min(maxLinks, names.length));
  const text = (n) => `… ${names.slice(-n).join(" + ")}`;
  while (shown > 1 && text(shown).length > maxChars) shown -= 1;
  // One link that is too long hides no link: it shows in full, with no count.
  if (shown === names.length) return names.join(" + ");
  return `${text(shown)} (${names.length})`;
}
