import { describe, expect, it } from "vitest";
import { loadLevel, resolveLevelName, withCanopy } from "./levels.js";

describe("resolveLevelName", () => {
  it("resolves the known levels and the alias", () => {
    expect(resolveLevelName()).toBe("beltline-eastside");
    expect(resolveLevelName("")).toBe("beltline-eastside");
    expect(resolveLevelName("greybox")).toBe("greybox");
    expect(resolveLevelName("beltline")).toBe("beltline-eastside");
  });

  it("rejects inherited keys, not only unknown names", () => {
    expect(() => resolveLevelName("constructor")).toThrow(/unknown level/);
    expect(() => resolveLevelName("toString")).toThrow(/unknown level/);
    expect(() => resolveLevelName("nope")).toThrow(/unknown level/);
  });
});

describe("withCanopy", () => {
  it("adds the canopy grid and its credit to the level attribution once", () => {
    const level = { attribution: "Map data (c) OpenStreetMap contributors" };
    const canopy = { attribution: "Tree canopy: City of Atlanta", data: "" };
    const out = withCanopy(level, canopy);
    expect(out.canopy).toBe(canopy);
    expect(out.attribution).toBe("Map data (c) OpenStreetMap contributors. Tree canopy: City of Atlanta");
    expect(withCanopy(out, canopy).attribution).toBe(out.attribution);
    expect(withCanopy(level, null)).toBe(level);
  });

  it("loads the BeltLine level with the City of Atlanta canopy", async () => {
    const level = await loadLevel("beltline-eastside");
    expect(level.canopy.cols).toBeGreaterThan(0);
    expect(level.attribution).toMatch(/Tree canopy: City of Atlanta Department of City Planning/);
  });
});
