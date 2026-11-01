import { describe, expect, it } from "vitest";
import { createSkater, createSkaterEnv, stepSkater } from "./skater.js";
import { GRIND } from "./constants.js";
import { GREYBOX } from "../../level/greybox.js";
import { createGroundSampler } from "../../level/ground.js";

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

describe("grind buffer", () => {
  const level = GREYBOX;
  const env = { sampleGround: createGroundSampler(level) };
  const skaterEnv = createSkaterEnv(level);
  const start = () => createSkater(level, { position: [-26, 0, -2], yaw: 0 });

  // The first frame where a held grind button snaps to the straight rail.
  function snapFrame() {
    let s = start();
    for (let i = 0; i < 400; i += 1) {
      s = stepSkater(s, { push: true, grind: true }, 1 / 60, env, skaterEnv);
      if (s.justSnapped) return i;
    }
    return -1;
  }

  function tapAt(frame) {
    let s = start();
    for (let i = 0; i < 400; i += 1) {
      s = stepSkater(s, { push: true, grind: i === frame }, 1 / 60, env, skaterEnv);
      if (s.justSnapped) return true;
    }
    return false;
  }

  it("snaps on a tap made just before the rail comes in range", () => {
    const n = snapFrame();
    expect(n).toBeGreaterThan(10);
    expect(tapAt(n - 4)).toBe(true);
  });

  it("does not snap on a tap made too early", () => {
    const n = snapFrame();
    expect(tapAt(n - Math.ceil(GRIND.buffer * 60) - 5)).toBe(false);
  });
});
