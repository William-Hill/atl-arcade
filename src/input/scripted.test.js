import { describe, expect, it } from "vitest";
import { createScriptPlayer } from "./scripted.js";

describe("script player", () => {
  it("plays each entry for its frame count, then ends", () => {
    const p = createScriptPlayer([
      { frames: 2, input: { push: true } },
      { frames: 1, input: { jump: true } },
    ]);
    expect(p.total).toBe(3);
    expect(p.next()).toEqual({ push: true });
    expect(p.next()).toEqual({ push: true });
    expect(p.done).toBe(false);
    expect(p.next()).toEqual({ jump: true });
    expect(p.done).toBe(true);
    expect(p.next()).toBeNull();
    expect(p.played).toBe(3);
  });

  it("skips zero-frame entries and handles an empty script", () => {
    const p = createScriptPlayer([{ frames: 0, input: { push: true } }, { frames: 1 }]);
    expect(p.next()).toEqual({});
    expect(p.done).toBe(true);
    expect(createScriptPlayer([]).done).toBe(true);
  });
});
