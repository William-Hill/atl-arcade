import { describe, expect, it } from "vitest";
import { contrast, fovFor, isCompact, over, shortAttribution, startHint } from "./layout.js";

describe("isCompact", () => {
  it("is true for phone portrait and landscape, false for a desktop", () => {
    expect(isCompact(390, 844)).toBe(true);
    expect(isCompact(844, 390)).toBe(true);
    expect(isCompact(1280, 720)).toBe(false);
  });
});

describe("fovFor", () => {
  it("narrows the view only on a short landscape screen", () => {
    expect(fovFor(844, 390)).toBe(42);
    expect(fovFor(390, 844)).toBe(60);
    expect(fovFor(1280, 720)).toBe(60);
  });
  it("makes the skater about 1.5 times as tall in landscape", () => {
    const scale = Math.tan((60 * Math.PI) / 360) / Math.tan((fovFor(844, 390) * Math.PI) / 360);
    expect(scale).toBeGreaterThan(1.45);
  });
});

describe("startHint", () => {
  it("names the gesture for the device", () => {
    expect(startHint(true)).toBe("Tap to start the beat");
    expect(startHint(false)).toMatch(/key or click/);
  });
});

describe("shortAttribution", () => {
  it("keeps the OpenStreetMap credit", () => {
    expect(shortAttribution("Map data (c) OpenStreetMap contributors, ODbL 1.0, https://... Heights: Overture")).toBe("© OpenStreetMap contributors");
    expect(shortAttribution("Other credit")).toBe("Other credit");
  });
});

describe("contrast", () => {
  it("gives 21 for black on white and 1 for the same colors", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrast([120, 120, 120], [120, 120, 120])).toBeCloseTo(1);
  });
  it("composites a pill color over the scene", () => {
    expect(over([0, 0, 0, 0.5], [255, 255, 255])).toEqual([127.5, 127.5, 127.5]);
  });
});
