import { describe, expect, it } from "vitest";
import { expandScript, scriptSeconds } from "./input-script.js";
import { FIXED_DT } from "../fixed-step.js";

describe("input script", () => {
  it("expands a duration into fixed steps", () => {
    const frames = expandScript([{ for: 1, input: { push: true } }], FIXED_DT);
    expect(frames).toHaveLength(60);
    expect(frames[0]).toEqual({ steer: 0, push: true, brake: false, jump: false });
  });

  it("fires a tap on the first step only", () => {
    const frames = expandScript([{ for: 0.5, tap: ["jump"] }], FIXED_DT);
    expect(frames[0].jump).toBe(true);
    expect(frames.slice(1).every((f) => f.jump === false)).toBe(true);
  });

  it("keeps segments in order", () => {
    const frames = expandScript(
      [
        { for: 0.1, input: { push: true } },
        { for: 0.1, input: { brake: true } },
      ],
      FIXED_DT,
    );
    expect(frames[0].push).toBe(true);
    expect(frames.at(-1).brake).toBe(true);
    expect(frames).toHaveLength(12);
  });

  it("adds up the wall time", () => {
    expect(scriptSeconds([{ for: 1.5 }, { for: 0.5 }])).toBe(2);
  });

  it("rejects a segment with no duration", () => {
    expect(() => expandScript([{ input: { push: true } }], FIXED_DT)).toThrow();
    expect(() => expandScript([{ for: 1 }], 0)).toThrow();
  });
});
