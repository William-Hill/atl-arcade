import { describe, expect, it } from "vitest";
import { BANKED_FADE_MS, BANKED_SHOW_MS, STYLE_LABEL, STYLE_READY_LABEL, bankedLine, pulseLook, styleLabel } from "./hud.js";

describe("the style ready cue (#97, MOB-12)", () => {
  it("changes the text and adds a star shape, not only the color", () => {
    expect(styleLabel(false)).toBe(STYLE_LABEL);
    expect(styleLabel(true)).toBe(STYLE_READY_LABEL);
    expect(styleLabel(true)).not.toBe(styleLabel(false));
    expect(styleLabel(true)).toMatch(/★/);
    expect(styleLabel(true)).toMatch(/READY/);
  });
});

describe("the beat pulse (#97, MOB-11)", () => {
  it("grows on the beat with full motion", () => {
    expect(pulseLook(0).scale).toBeCloseTo(1.6, 9);
    expect(pulseLook(1).scale).toBe(1);
    expect(pulseLook(0).opacity).toBe(1);
  });

  it("does not grow with reduced motion, but still flashes", () => {
    for (const p of [0, 0.25, 0.5, 1]) expect(pulseLook(p, true).scale).toBe(1);
    expect(pulseLook(0, true).opacity).toBe(1);
    expect(pulseLook(1, true).opacity).toBeCloseTo(0.25, 9);
  });
});

describe("the +N of a banked combo (#269)", () => {
  it("shows for a fixed time, fades, then goes", () => {
    expect(bankedLine(1200, 1000, 1000)).toEqual({ text: "+1,200", fade: false });
    expect(bankedLine(1200, 1000, 1000 + BANKED_SHOW_MS - 1)).toEqual({ text: "+1,200", fade: false });
    expect(bankedLine(1200, 1000, 1000 + BANKED_SHOW_MS)).toEqual({ text: "+1,200", fade: true });
    expect(bankedLine(1200, 1000, 1000 + BANKED_SHOW_MS + BANKED_FADE_MS)).toEqual({ text: "", fade: false });
  });

  it("shows nothing before the first bank or after a bail", () => {
    expect(bankedLine(0, null, 5000)).toEqual({ text: "", fade: false });
    expect(bankedLine(1200, null, 5000)).toEqual({ text: "", fade: false });
    expect(bankedLine(0, 1000, 1000)).toEqual({ text: "", fade: false });
  });
});
