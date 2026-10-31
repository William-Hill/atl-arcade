// Combo state machine and scoring. Pure, immutable: every function returns
// a new combo object.
//
// A move adds a link; the multiplier equals the link count (THPS style).
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
  const earned = Math.round(points * bonus);
  const links = [...c.links, { move, name, points: earned, onBeat, beat }];
  const style = move === "style" ? Math.min(1, c.style + k.styleGain) : c.style;
  return {
    ...c,
    links,
    pending: c.pending + earned,
    multiplier: links.length,
    style,
    signatureReady: style >= 1,
    window: k.linkWindow,
    active: true,
  };
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
export function comboTick(c, dt, open) {
  if (!c.active) return c;
  if (open) return c.window === COMBO.linkWindow ? c : { ...c, window: COMBO.linkWindow };
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
