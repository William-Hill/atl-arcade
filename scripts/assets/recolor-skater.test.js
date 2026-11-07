import { describe, expect, it } from "vitest";
import { RECIPES, hsv, recolorTexel } from "./recolor-skater.mjs";

const NAVY = RECIPES["nia-navy"];

describe("recolor-skater nia-navy (#203)", () => {
  it("makes the mean pants green the navy target", () => {
    expect(recolorTexel(NAVY, ...NAVY.from).rgb).toEqual(NAVY.to);
  });

  it("keeps the folds: a darker green texel gives a darker navy", () => {
    const dark = recolorTexel(NAVY, 38, 56, 33).rgb;
    const mid = recolorTexel(NAVY, ...NAVY.from).rgb;
    expect(dark[2]).toBeLessThan(mid[2]);
    expect(hsv(...dark)[0]).toBeCloseTo(225, -1);
  });

  it("keeps the jacket, the skin, the cream boots, the wheels and the wristband", () => {
    const keep = {
      jacket: [218, 99, 54],
      skin: [143, 94, 62],
      boots: [230, 215, 180],
      wheels: [214, 160, 60],
      wristband: [65, 119, 90],
      hair: [18, 20, 15],
    };
    for (const [name, rgb] of Object.entries(keep)) {
      expect(recolorTexel(NAVY, ...rgb), name).toEqual({ rgb, w: 0 });
    }
  });

  it("gives a navy above the albedo floor and under the saturation cap", () => {
    const [h, s, v] = hsv(...NAVY.to);
    expect(h).toBeGreaterThan(215);
    expect(h).toBeLessThan(235);
    expect(s).toBeLessThanOrEqual(0.85);
    const luma = 0.2126 * NAVY.to[0] + 0.7152 * NAVY.to[1] + 0.0722 * NAVY.to[2];
    expect(luma).toBeGreaterThan(0x30);
  });
});
