import { describe, expect, it } from "vitest";
import { COMBO } from "./constants.js";
import { comboBail, comboBank, comboMove, comboString, comboTick, comboValue, createCombo } from "./combo.js";

const grind = { move: "grind", name: "Grind", points: 100 };
const hop = { move: "air", name: "Hop", points: 50 };
const shuffle = { move: "style", name: "Shuffle", points: 120 };

describe("chaining", () => {
  it("adds a link per move and the multiplier equals the link count", () => {
    let c = comboMove(createCombo(), grind);
    c = comboMove(c, hop);
    c = comboMove(c, shuffle);
    expect(c.links).toHaveLength(3);
    expect(c.multiplier).toBe(3);
    expect(c.pending).toBe(270);
    expect(comboValue(c)).toBe(810);
    expect(comboString(c)).toBe("Grind + Hop + Shuffle");
    expect(c.active).toBe(true);
  });

  it("does not change the original combo", () => {
    const a = createCombo();
    comboMove(a, grind);
    expect(a.links).toHaveLength(0);
  });
});

describe("banking", () => {
  it("banks pending times the multiplier when the link window runs out", () => {
    let c = comboMove(comboMove(createCombo(), grind), hop);
    c = comboTick(c, COMBO.linkWindow / 2, false);
    expect(c.active).toBe(true);
    expect(c.score).toBe(0);
    c = comboTick(c, COMBO.linkWindow / 2 + 0.01, false);
    expect(c.active).toBe(false);
    expect(c.score).toBe(150 * 2);
    expect(c.lastBanked).toBe(300);
    expect(c.best).toBe(300);
    expect(c.links).toHaveLength(0);
    expect(c.multiplier).toBe(1);
  });

  it("keeps the window open while a move is in progress", () => {
    let c = comboMove(createCombo(), grind);
    for (let i = 0; i < 200; i += 1) c = comboTick(c, 1 / 60, true);
    expect(c.active).toBe(true);
    expect(c.window).toBeCloseTo(COMBO.linkWindow);
  });

  it("is a no-op when nothing is active", () => {
    const c = createCombo();
    expect(comboTick(c, 1, false)).toBe(c);
    expect(comboBank(c)).toBe(c);
  });
});

describe("bail", () => {
  it("throws the pending points away and keeps the banked score", () => {
    let c = comboMove(comboMove(createCombo(), grind), hop);
    c = comboTick(c, 1, false); // banks 300
    c = comboMove(comboMove(c, grind), shuffle);
    c = comboBail(c);
    expect(c.score).toBe(300);
    expect(c.pending).toBe(0);
    expect(c.links).toHaveLength(0);
    expect(c.multiplier).toBe(1);
    expect(c.active).toBe(false);
    expect(c.bails).toBe(1);
  });
});

describe("style meter", () => {
  it("fills with dance moves, caps at 1, and flags the signature move", () => {
    let c = createCombo();
    for (let i = 0; i < 3; i += 1) c = comboMove(c, shuffle);
    expect(c.style).toBeCloseTo(3 * COMBO.styleGain);
    expect(c.signatureReady).toBe(false);
    for (let i = 0; i < 3; i += 1) c = comboMove(c, shuffle);
    expect(c.style).toBe(1);
    expect(c.signatureReady).toBe(true);
  });

  it("does not fill with grinds and drops on a bail", () => {
    let c = comboMove(createCombo(), grind);
    expect(c.style).toBe(0);
    c = comboMove(c, shuffle);
    c = comboMove(c, shuffle);
    c = comboMove(c, shuffle);
    c = comboMove(c, shuffle);
    expect(c.style).toBe(1);
    c = comboBail(c);
    expect(c.style).toBeCloseTo(1 - COMBO.bailStyleLoss);
    expect(c.signatureReady).toBe(false);
  });
});

describe("on-beat bonus", () => {
  it("multiplies the move points and marks the link", () => {
    const c = comboMove(createCombo(), { ...hop, onBeat: true });
    expect(c.pending).toBe(Math.round(50 * COMBO.beatBonus));
    expect(comboString(c)).toBe("Hop!");
  });
});
