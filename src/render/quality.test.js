import { describe, expect, it } from "vitest";
import { QUALITY, qualityFor } from "./quality.js";

describe("quality tiers", () => {
  it("uses the URL value when it is low or high", () => {
    expect(qualityFor("low", "ANGLE (Apple, Apple M3)")).toBe("low");
    expect(qualityFor("high", "ANGLE (Google, SwiftShader)")).toBe("high");
  });

  it("gives a software renderer the low tier and a real GPU the high tier", () => {
    expect(qualityFor(null, "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe("low");
    expect(qualityFor(null, "llvmpipe (LLVM 15.0.7, 256 bits)")).toBe("low");
    expect(qualityFor(null, "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)")).toBe("high");
    expect(qualityFor("ultra", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)")).toBe("high");
  });

  it("keeps the low tier at the draw distance that the playtest gate measured", () => {
    expect(QUALITY.low).toMatchObject({ shadows: false, post: false, far: 320, fogNear: 150 });
    expect(QUALITY.high.far).toBeGreaterThan(QUALITY.low.far);
  });
});
