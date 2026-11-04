import { describe, expect, it } from "vitest";
import { BAND_LIMITS, TILT_SHIFT, TiltShiftShader, bandMask, blurRadius, clampBand, clampStrength } from "./tilt-shift.js";

describe("tilt-shift band math", () => {
  it("keeps the band sharp and blurs fully past the feather", () => {
    const p = TILT_SHIFT;
    expect(bandMask(p.center, p)).toBe(0);
    expect(bandMask(p.center + p.halfWidth * 0.999, p)).toBe(0);
    expect(bandMask(p.center - p.halfWidth * 0.999, p)).toBe(0);
    expect(bandMask(p.center + (p.halfWidth + p.feather) * 1.001, p)).toBe(1);
    expect(bandMask(p.center - (p.halfWidth + p.feather) * 1.001, p)).toBe(1);
  });

  it("grows the blur away from the band, above and below", () => {
    const p = TILT_SHIFT;
    let prev = -1;
    for (let y = p.center; y <= 1; y += 0.02) {
      const m = bandMask(y, p);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
    expect(bandMask(p.center + 0.2, p)).toBeCloseTo(bandMask(p.center - 0.2, p), 10);
  });

  it("follows the band center", () => {
    const p = { ...TILT_SHIFT, center: 0.7 };
    expect(bandMask(0.7, p)).toBe(0);
    expect(bandMask(0.2, p)).toBe(1);
  });

  it("blurs more with a larger depth step from the focus", () => {
    const y = 0.95;
    const atFocus = blurRadius(y, 50, 50);
    const far = blurRadius(y, 200, 50);
    expect(atFocus).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(atFocus);
    expect(far).toBeCloseTo(TILT_SHIFT.strength * TILT_SHIFT.maxRadius, 6);
    expect(blurRadius(TILT_SHIFT.center, 200, 50)).toBe(0);
  });

  it("gives no blur at strength 0", () => {
    expect(blurRadius(0.99, 300, 20, { ...TILT_SHIFT, strength: 0 })).toBe(0);
  });

  it("clamps the band and the strength", () => {
    expect(clampBand(-1)).toBe(BAND_LIMITS.min);
    expect(clampBand(2)).toBe(BAND_LIMITS.max);
    expect(clampBand(0.5)).toBe(0.5);
    expect(clampBand(NaN)).toBe(TILT_SHIFT.center);
    expect(clampStrength(-0.5)).toBe(0);
    expect(clampStrength(3)).toBe(1);
    expect(clampStrength(undefined)).toBe(TILT_SHIFT.strength);
  });

  it("reads the depth buffer in the shader", () => {
    expect(TiltShiftShader.uniforms.tDepth).toBeDefined();
    expect(TiltShiftShader.fragmentShader).toContain("perspectiveDepthToViewZ");
  });
});
