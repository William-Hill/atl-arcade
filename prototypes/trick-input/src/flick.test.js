import { describe, expect, it } from "vitest";
import { withRelaxed } from "./constants.js";
import { createFlick, flickMove, flickTick, flickUp } from "./flick.js";

describe("R11 touch flick", () => {
  it("a 24 px drag right resolves right at that time", () => {
    const f = flickMove(createFlick("trick", 100, 100, 0), 124, 100, 40);
    expect(f.resolved).toEqual({ dir: "r", atMs: 40, by: "drag" });
  });
  it("23 px is not a flick", () => {
    expect(flickMove(createFlick("trick", 100, 100, 0), 123, 100, 40).resolved).toBeNull();
  });
  it("screen up (negative y) is up; the main axis wins", () => {
    expect(flickMove(createFlick("trick", 0, 0, 0), 10, -30, 30).resolved.dir).toBe("u");
    expect(flickMove(createFlick("trick", 0, 0, 0), -30, 10, 30).resolved.dir).toBe("l");
    expect(flickMove(createFlick("trick", 0, 0, 0), 5, 30, 30).resolved.dir).toBe("d");
  });
  it("a lift at 50 ms with under 24 px is a tap: neutral", () => {
    let f = flickMove(createFlick("trick", 0, 0, 0), 10, 0, 30);
    f = flickUp(f, 50);
    expect(f.resolved).toEqual({ dir: "n", atMs: 50, by: "tap" });
  });
  it("no drag for 120 ms resolves neutral at 120 ms", () => {
    let f = createFlick("trick", 0, 0, 1000);
    f = flickTick(f, 1119);
    expect(f.resolved).toBeNull();
    f = flickTick(f, 1120);
    expect(f.resolved).toEqual({ dir: "n", atMs: 1120, by: "timeout" });
  });
  it("Relaxed timing waits 250 ms", () => {
    expect(flickTick(createFlick("trick", 0, 0, 0), 200, withRelaxed()).resolved).toBeNull();
  });
  it("a later move does not change a resolved flick", () => {
    let f = flickMove(createFlick("grind", 0, 0, 0), 0, -30, 20);
    f = flickMove(f, 40, -30, 40);
    expect(f.resolved.dir).toBe("u");
  });
});
