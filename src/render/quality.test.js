import { describe, expect, it } from "vitest";
import { QUALITY, isMobileAgent, isPhone, pixelRatioFor, qualityFor, readDevice } from "./quality.js";

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

  it("starts the coarse far ground inside the fog on high, and keeps low at 60 m", () => {
    expect(QUALITY.low.farTerrain).toBe(60);
    expect(QUALITY.phone.farTerrain).toBe(null);
    // Past the fog start, and well inside the far plane.
    expect(QUALITY.high.farTerrain).toBeGreaterThan(QUALITY.high.fogNear);
    expect(QUALITY.high.farTerrain).toBeLessThan(QUALITY.high.far * 0.6);
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

describe("the device default", () => {
  it("gives a phone user agent the phone tier, also with no touch facts", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
    expect(isMobileAgent(ua)).toBe(true);
    expect(isMobileAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15")).toBe(false);
    expect(isMobileAgent(undefined)).toBe(false);
    expect(qualityFor(null, "Mali-G710", { mobile: true })).toBe("phone");
  });

  it("gives a CPU with 2 cores or less the phone tier", () => {
    expect(qualityFor(null, "ANGLE (Intel, Intel UHD 600)", { cores: 2 })).toBe("phone");
    expect(qualityFor(null, "ANGLE (Intel, Intel UHD 600)", { cores: 8 })).toBe("high");
    // An unknown core count (0) is not a slow CPU.
    expect(qualityFor(null, "ANGLE (Intel, Intel UHD 600)", { cores: 0 })).toBe("high");
    // A software renderer stays on low.
    expect(qualityFor(null, "SwiftShader", { cores: 2 })).toBe("low");
  });

  it("reads the device from the browser objects", () => {
    const nav = { maxTouchPoints: 5, userAgent: "iPhone", hardwareConcurrency: 6 };
    const win = { screen: { width: 390, height: 844 }, matchMedia: () => ({ matches: true }) };
    expect(readDevice(nav, win)).toEqual({ touch: true, width: 390, height: 844, mobile: true, cores: 6 });
    expect(readDevice({}, {})).toEqual({ touch: false, width: 0, height: 0, mobile: false, cores: 0 });
  });
});
