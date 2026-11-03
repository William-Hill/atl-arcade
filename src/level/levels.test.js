import { describe, expect, it } from "vitest";
import { resolveLevelName } from "./levels.js";

describe("resolveLevelName", () => {
  it("resolves the known levels and the alias", () => {
    expect(resolveLevelName()).toBe("greybox");
    expect(resolveLevelName("beltline")).toBe("beltline-eastside");
  });

  it("rejects inherited keys, not only unknown names", () => {
    expect(() => resolveLevelName("constructor")).toThrow(/unknown level/);
    expect(() => resolveLevelName("toString")).toThrow(/unknown level/);
    expect(() => resolveLevelName("nope")).toThrow(/unknown level/);
  });
});
