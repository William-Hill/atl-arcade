import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKING_COLORS, roadMarkings } from "./markings.js";

const LEVEL = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../levels/beltline-eastside/level.json"), "utf8"));

const count = (m, color) => {
  let n = 0;
  for (let i = 0; i < m.colors.length; i += 3) if (m.colors[i] === Math.fround(color[0]) && m.colors[i + 2] === Math.fround(color[2])) n += 1;
  return n / 4;
};

describe("road markings", () => {
  it("draws a double yellow line on a main street and stops it at the cross street", () => {
    const level = {
      surfaces: { street: 0.03 },
      strips: [
        { id: "a", kind: "street", highway: "secondary", name: "North Avenue Northeast", width: 12, points: [[-50, 0], [0, 0], [50, 0]] },
        { id: "b", kind: "street", highway: "residential", name: "Bonaventure Avenue Northeast", width: 8, points: [[0, -50], [0, 0], [0, 50]] },
        { id: "c", kind: "street", highway: "service", width: 4, points: [[25, 0], [25, 20]] },
      ],
    };
    const m = roadMarkings(level);
    // Two lines, each cut once at the cross street (the driveway does not cut it).
    expect(count(m, MARKING_COLORS.yellow)).toBe(4);
    for (let i = 0; i < m.positions.length; i += 3) {
      expect(m.positions[i + 1]).toBeCloseTo(0.05, 5);
      // No line within the cross street.
      if (m.colors[i] === Math.fround(MARKING_COLORS.yellow[0])) expect(Math.abs(m.positions[i]) >= 4 + 2 - 1e-4 || Math.abs(m.positions[i + 2]) > 1).toBe(true);
    }
    // Crosswalks on the four arms.
    expect(count(m, MARKING_COLORS.white)).toBeGreaterThan(20);
  });

  it("marks the BeltLine level streets", () => {
    const m = roadMarkings(LEVEL);
    expect(count(m, MARKING_COLORS.yellow)).toBeGreaterThan(50);
    expect(count(m, MARKING_COLORS.white)).toBeGreaterThan(500);
    expect(m.indices.length % 3).toBe(0);
  });
});
