import { describe, expect, it } from "vitest";
import { PBR_LITE, isPbrLite } from "./pbr-lite.js";
import { LEAF_CARDS } from "../level/geo/trees.js";
import { GROUND_CUTS } from "./pbr-ground.js";

describe("pbr lite (#246)", () => {
  it("is the pbr look on the phone tier", () => {
    expect(isPbrLite({ look: "pbr", quality: "phone" })).toBe(true);
    expect(isPbrLite({ look: "toon", quality: "phone" })).toBe(false);
  });
  it("leaves the high tier's pbr look alone", () => {
    expect(isPbrLite({ look: "pbr", quality: "high" })).toBe(false);
    expect(isPbrLite({ look: "pbr", quality: "high", param: "1" })).toBe(false);
  });
  it("leaves the low tier alone unless ?pbrlite=1 asks", () => {
    expect(isPbrLite({ look: "pbr", quality: "low" })).toBe(false);
    expect(isPbrLite({ look: "pbr", quality: "low", param: "1" })).toBe(true);
  });
  it("?pbrlite=0 keeps the phone pbr look as it was", () => {
    expect(isPbrLite({ look: "pbr", quality: "phone", param: "0" })).toBe(false);
  });
  it("draws fewer leaf cards than the full count and a 1024 px mural atlas", () => {
    expect(PBR_LITE.leafCards).toBeGreaterThan(0);
    expect(PBR_LITE.leafCards).toBeLessThan(LEAF_CARDS.perPuff / 2);
    expect(PBR_LITE.muralSize).toBe(1024);
    expect(PBR_LITE.groundCuts).toEqual(["oneAlbedo"]);
    for (const c of PBR_LITE.groundCuts) expect(GROUND_CUTS[c]).toBeTruthy();
  });
});
