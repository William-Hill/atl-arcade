import { describe, expect, it } from "vitest";
import { SIGN_CORE, boardWidth, signCoreIntensity } from "./shop-signs-view.js";
import { BLOOM_THRESHOLD } from "./pbr-palette.js";

describe("the shop board width", () => {
  it("fits the text and stays in its limits", () => {
    const short = boardWidth(100, 0.55, 5);
    const long = boardWidth(600, 0.55, 5);
    expect(long).toBeGreaterThan(short);
    expect(boardWidth(5000, 0.55, 5)).toBe(5);
    expect(boardWidth(0, 0.55, 5)).toBeGreaterThanOrEqual(1.2);
  });
});

describe("the hot sign core at night (#196)", () => {
  it("is off in the day and about x8 at night", () => {
    expect(signCoreIntensity(0)).toBe(0);
    expect(signCoreIntensity(1)).toBe(8);
    expect(signCoreIntensity(0.5)).toBe(4);
    expect(signCoreIntensity(3)).toBe(8);
    expect(SIGN_CORE.night).toBeGreaterThan(BLOOM_THRESHOLD.night * 4);
  });
});
