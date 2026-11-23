import { describe, expect, it } from "vitest";
import { DEFAULT_SKATER, SKATERS, createSkaterSwitch, resolveSkater, skaterUrl } from "./skater-select.js";
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

// A load that the test resolves or rejects by hand.
function deferredLoads() {
  const waits = new Map();
  return {
    load: (id) => new Promise((resolve, reject) => waits.set(id, { resolve, reject })),
    done: (id) => waits.get(id).resolve({ model: id }),
    fail: (id) => waits.get(id).reject(new Error(`no ${id}`)),
  };
}

describe("createSkaterSwitch (#97, MOB-13)", () => {
  it("loads the other skater and applies it, with no reload", async () => {
    const applied = [];
    const sw = createSkaterSwitch({ current: "nia", load: async (id) => ({ model: id }), apply: (id, m) => applied.push([id, m.model]) });
    expect(await sw.select("marcus")).toBe(true);
    expect(sw.current).toBe("marcus");
    expect(applied).toEqual([["marcus", "marcus"]]);
    expect(await sw.select("marcus")).toBe(false);
    expect(await sw.select("nia")).toBe(true);
    expect(applied.map((a) => a[0])).toEqual(["marcus", "nia"]);
  });

  it("applies only the last choice when the player clicks fast", async () => {
    const d = deferredLoads();
    const applied = [];
    const sw = createSkaterSwitch({ current: "nia", load: d.load, apply: (id) => applied.push(id) });
    const a = sw.select("marcus");
    expect(sw.pending).toBe("marcus");
    // Back to Nia before Marcus loads: the Marcus load is dropped.
    expect(await sw.select("nia")).toBe(false);
    expect(sw.pending).toBe(null);
    d.done("marcus");
    expect(await a).toBe(false);
    expect(applied).toEqual([]);
    expect(sw.current).toBe("nia");
  });

  it("keeps the current skater when the load fails", async () => {
    const d = deferredLoads();
    const errors = [];
    const sw = createSkaterSwitch({ current: "nia", load: d.load, apply: () => {}, onError: (id) => errors.push(id) });
    const a = sw.select("marcus");
    d.fail("marcus");
    expect(await a).toBe(false);
    expect(sw.current).toBe("nia");
    expect(sw.pending).toBe(null);
    expect(errors).toEqual(["marcus"]);
  });
});
