import { describe, expect, it } from "vitest";
import { createStreetSigns } from "./street-signs.js";

describe("createStreetSigns", () => {
  it("gives an update() even with no signs, so the frame loop never throws", () => {
    const signs = createStreetSigns([]);
    expect(signs.count).toBe(0);
    expect(signs.names).toEqual([]);
    expect(() => signs.update({ x: 0, y: 0, z: 0 })).not.toThrow();
  });
});
