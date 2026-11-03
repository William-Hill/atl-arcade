import { describe, expect, it } from "vitest";
import { LOAD_PARTS, createLoader, loadFraction } from "./loader.js";

describe("loadFraction", () => {
  it("is 0 at the start and 1 when every part is done", () => {
    expect(loadFraction({ done: new Set() })).toBe(0);
    expect(loadFraction({ done: new Set(Object.keys(LOAD_PARTS)) })).toBeCloseTo(1);
  });
  it("counts the skater bytes before the skater is done", () => {
    const f = loadFraction({ done: new Set(["level"]), skater: { loaded: 50, total: 100 } });
    expect(f).toBeCloseTo(LOAD_PARTS.level + LOAD_PARTS.skater / 2);
  });
  it("ignores the bytes when the total is not known", () => {
    expect(loadFraction({ done: new Set(), skater: { loaded: 50, total: 0 } })).toBe(0);
  });
});

describe("createLoader", () => {
  it("works with no DOM and splits the bar when there is no skater", () => {
    const l = createLoader(null, { skater: false });
    l.step("level");
    expect(l.fraction).toBeCloseTo(0.5);
    l.step("physics");
    expect(l.fraction).toBeCloseTo(1);
    l.hide();
  });
});
