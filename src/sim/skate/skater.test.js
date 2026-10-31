import { describe, expect, it } from "vitest";
import { createSkater, stepSkater } from "./skater.js";

describe("switch (backward riding)", () => {
  it("toggles on a press while rolling, and not while the button is held", () => {
    let s = { ...createSkater(null), speed: 4 };
    s = stepSkater(s, { switch: true }, 1 / 60);
    expect(s.backward).toBe(true);
    s = stepSkater(s, { switch: true }, 1 / 60);
    expect(s.backward).toBe(true);
    s = stepSkater(s, {}, 1 / 60);
    s = stepSkater(s, { switch: true }, 1 / 60);
    expect(s.backward).toBe(false);
  });

  it("keeps the switch through the air, and ignores a press in the air", () => {
    let s = { ...createSkater(null), speed: 4 };
    s = stepSkater(stepSkater(s, { switch: true }, 1 / 60), {}, 1 / 60);
    s = stepSkater({ ...s, state: "air", airTime: 0.2, velocity: [0, 3, 0], position: [0, 1, 0] }, { switch: true }, 1 / 60);
    expect(s.state).toBe("air");
    expect(s.backward).toBe(true);
  });

  it("does not change the travel direction", () => {
    const a = stepSkater({ ...createSkater(null), speed: 4 }, { push: true }, 1 / 60);
    const b = stepSkater({ ...createSkater(null), speed: 4 }, { push: true, switch: true }, 1 / 60);
    expect(b.position).toEqual(a.position);
    expect(b.yaw).toBe(a.yaw);
  });
});
