import { describe, expect, it } from "vitest";
import { DEFAULT_SKATER, SKATERS, resolveSkater, skaterUrl } from "./skater-select.js";
import { SKATER_MODELS } from "../render/skater-model.js";

describe("the skater roster", () => {
  it("has a model for every skater", () => {
    for (const s of SKATERS) expect(SKATER_MODELS).toHaveProperty(s.id);
  });

  it("starts with Nia", () => {
    expect(DEFAULT_SKATER).toBe("nia");
  });
});

describe("resolveSkater", () => {
  it("keeps a known skater and the capsule", () => {
    expect(resolveSkater("marcus")).toBe("marcus");
    expect(resolveSkater(" Nia ")).toBe("nia");
    expect(resolveSkater("capsule")).toBe("capsule");
  });

  it("gives the default for no value or an unknown value", () => {
    expect(resolveSkater(null)).toBe("nia");
    expect(resolveSkater("")).toBe("nia");
    expect(resolveSkater("tony")).toBe("nia");
  });
});

describe("skaterUrl", () => {
  it("sets the skater and keeps the other values", () => {
    const u = new URL(skaterUrl("http://localhost:5173/?level=beltline&skater=nia", "marcus"));
    expect(u.searchParams.get("skater")).toBe("marcus");
    expect(u.searchParams.get("level")).toBe("beltline");
  });
});
