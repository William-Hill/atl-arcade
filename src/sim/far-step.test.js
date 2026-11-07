import { describe, expect, it } from "vitest";
import { farStride, stepsOnTick, viewerDistance } from "./far-step.js";

const BANDS = [
  [40, 2],
  [80, 4],
];

describe("far-step", () => {
  it("gives stride 1 near, and the stride of the farthest band passed", () => {
    expect(farStride(0, BANDS)).toBe(1);
    expect(farStride(39.9, BANDS)).toBe(1);
    expect(farStride(40, BANDS)).toBe(2);
    expect(farStride(79, BANDS)).toBe(2);
    expect(farStride(500, BANDS)).toBe(4);
    expect(farStride(Infinity, BANDS)).toBe(4);
    expect(farStride(100, [])).toBe(1);
  });

  it("steps an agent once every stride ticks, staggered by id", () => {
    for (const stride of [1, 2, 3, 4]) {
      for (let id = 0; id < 6; id += 1) {
        let n = 0;
        for (let tick = 0; tick < 24; tick += 1)
          if (stepsOnTick(tick, id, stride)) n += 1;
        expect(n).toBe(24 / stride);
      }
    }
    // Ids 0..3 at stride 4 step on 4 different ticks.
    const first = [0, 1, 2, 3].map((id) =>
      [0, 1, 2, 3].find((t) => stepsOnTick(t, id, 4)),
    );
    expect(new Set(first).size).toBe(4);
  });

  it("measures to the nearest viewer", () => {
    expect(viewerDistance(0, 0, [])).toBe(Infinity);
    expect(viewerDistance(3, 4, [[0, 0]])).toBe(5);
    expect(
      viewerDistance(10, 0, [
        [0, 0],
        [9, 0],
      ]),
    ).toBe(1);
  });
});
