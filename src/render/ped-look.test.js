import { describe, expect, it } from "vitest";
import { F, HEIGHT, lookKey, pedLook } from "./ped-look.js";

const LOOKS = Array.from({ length: 500 }, (_, i) => pedLook((i * 7919 + 13) >>> 0));
const has = (l, bit) => ((l.genes >> bit) & 1) === 1;

describe("ped look", () => {
  it("gives the same look for the same number", () => {
    expect(pedLook(42)).toEqual(pedLook(42));
  });

  it("keeps every walker an adult of a real height (1.52 to 1.94 m)", () => {
    for (const l of LOOKS) {
      expect(l.height).toBeGreaterThanOrEqual(HEIGHT[0]);
      expect(l.height).toBeLessThanOrEqual(HEIGHT[1]);
    }
    const mean = LOOKS.reduce((a, l) => a + l.height, 0) / LOOKS.length;
    expect(mean).toBeGreaterThan(1.68);
    expect(mean).toBeLessThan(1.78);
  });

  it("makes almost every walker look different", () => {
    const keys = new Set(LOOKS.map(lookKey));
    expect(keys.size).toBeGreaterThanOrEqual(LOOKS.length - 1);
  });

  it("uses every hair style, top, bottom and bag", () => {
    for (const field of ["style", "top", "bottom", "bag"]) expect(new Set(LOOKS.map((l) => l[field])).size, field).toBeGreaterThanOrEqual(3);
  });

  it("sets the feature bits that match the clothes", () => {
    for (const l of LOOKS) {
      expect(has(l, F.longPants) && has(l, F.skirt)).toBe(false);
      expect(has(l, F.longPants)).toBe(l.bottom === "pants");
      expect(has(l, F.longSleeve) && !has(l, F.sleeve)).toBe(false);
      if (l.top === "dress") expect(l.pants).toBe(l.shirt);
      expect([F.backpack, F.tote, F.crossbody].filter((b) => has(l, b)).length).toBeLessThanOrEqual(1);
      expect(l.genes).toBeLessThan(2 ** 24);
    }
  });
});
