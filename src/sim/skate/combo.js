// Combo state machine and scoring. Pure, immutable: every function returns
// a new combo object.
//
// A move adds a link. The multiplier equals the count of links that earn
// points, up to `maxMultiplier` (THPS style). A repeat of the same move name
// in one combo earns less (`repeatDecay`); a repeat past the end of that list
// earns 0 points and does not raise the multiplier (#75).
// The combo stays open while a move is in progress (grind, air, style move)
// and for `linkWindow` seconds after. When the window runs out the pending
// points times the multiplier bank into the score. A bail throws the pending
// points away and drops the style meter.

import { COMBO } from "./constants.js";

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

export function comboMove(c, { move, name, points, onBeat = false, beat = null }, k = COMBO) {
  const bonus = onBeat ? k.beatBonus : 1;
  const repeat = c.links.reduce((n, l) => (l.name === name ? n + 1 : n), 0);
  const decay = k.repeatDecay[repeat] ?? 0;
  const earned = Math.round(points * bonus * decay);
  const links = [...c.links, { move, name, points: earned, onBeat, beat, repeat, scores: earned > 0 }];
  const style = move === "style" ? Math.min(1, c.style + k.styleGain) : c.style;
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

export function comboBail(c, k = COMBO) {
  const style = Math.max(0, c.style - k.bailStyleLoss);
  return { ...c, links: [], pending: 0, multiplier: 1, window: 0, active: false, style, signatureReady: style >= 1, bails: c.bails + 1, lastBanked: 0 };
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
