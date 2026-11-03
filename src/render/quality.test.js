import { describe, expect, it } from "vitest";
import { QUALITY, isPhone, pixelRatioFor, qualityFor } from "./quality.js";

const METAL = "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)";
const ADRENO = "ANGLE (Qualcomm, Adreno (TM) 730, OpenGL ES 3.2)";
const IPHONE = { touch: true, width: 393, height: 852 };

describe("quality tiers", () => {
  it("uses the URL value when it is low, phone, or high", () => {
    expect(qualityFor("low", METAL)).toBe("low");
    expect(qualityFor("high", "ANGLE (Google, SwiftShader)")).toBe("high");
    expect(qualityFor("phone", METAL)).toBe("phone");
  });

  it("gives a software renderer the low tier and a real GPU the high tier", () => {
    expect(qualityFor(null, "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe("low");
    expect(qualityFor(null, "llvmpipe (LLVM 15.0.7, 256 bits)")).toBe("low");
    expect(qualityFor(null, METAL)).toBe("high");
    expect(qualityFor("ultra", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)")).toBe("high");
  });

  it("gives a touch device with a small screen the phone tier", () => {
    expect(qualityFor(null, ADRENO, IPHONE)).toBe("phone");
    expect(qualityFor(null, "Apple GPU", { touch: true, width: 844, height: 390 })).toBe("phone");
    expect(qualityFor(null, METAL, { touch: false, width: 390, height: 844 })).toBe("high");
    expect(qualityFor(null, METAL, { touch: true, width: 1366, height: 1024 })).toBe("high");
    // A software renderer stays on low, also on a phone.
    expect(qualityFor(null, "SwiftShader", IPHONE)).toBe("low");
  });

  it("keeps the low tier at the draw distance that the playtest gate measured", () => {
    expect(QUALITY.low).toMatchObject({ shadows: false, post: null, far: 320, fogNear: 150 });
    expect(QUALITY.high.far).toBeGreaterThan(QUALITY.low.far);
  });

  it("gives the phone tier no shadow map, the lite post, and a pixel ratio of 1.5 or less", () => {
    expect(QUALITY.phone).toMatchObject({ shadows: false, post: "lite", detail: false });
    expect(QUALITY.phone.pixelRatio).toBeLessThanOrEqual(1.5);
  });
});

describe("isPhone", () => {
  it("needs touch and a short side of 900 px or less", () => {
    expect(isPhone(IPHONE)).toBe(true);
    expect(isPhone({ touch: true, width: 0, height: 0 })).toBe(false);
    expect(isPhone({ touch: false, width: 390, height: 844 })).toBe(false);
  });
});

describe("pixelRatioFor", () => {
  it("caps the device pixel ratio and never goes under 1", () => {
    expect(pixelRatioFor(3, 1.5)).toBe(1.5);
    expect(pixelRatioFor(1, 1.5)).toBe(1);
    expect(pixelRatioFor(0.5, 2)).toBe(1);
    expect(pixelRatioFor(undefined, 2)).toBe(1);
  });
});
