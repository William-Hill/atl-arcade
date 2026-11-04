import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKING_COLORS, mergeMarkings, roadMarkings } from "./markings.js";

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
    const m = mergeMarkings(roadMarkings(level));
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
    const tiles = roadMarkings(LEVEL);
    expect(tiles.length).toBeGreaterThan(10);
    const m = mergeMarkings(tiles);
    expect(count(m, MARKING_COLORS.yellow)).toBeGreaterThan(50);
    expect(count(m, MARKING_COLORS.white)).toBeGreaterThan(500);
    expect(m.indices.length % 3).toBe(0);
  });
});

describe("road markings on the real level with city sign names (#78)", () => {
  it("gives finite positions and a finite tile for each marking", () => {
    const tiles = roadMarkings(LEVEL);
    let tris = 0;
    for (const t of tiles) {
      expect(t.tile).toMatch(/^-?\d+,-?\d+$/);
      for (const v of t.mesh.positions) expect(Number.isFinite(v)).toBe(true);
      tris += t.mesh.indices.length / 3;
    }
    // Before the fix, crosswalks at a renamed street went to infinity and
    // most markings were lost (3192 triangles instead of about 8500).
    expect(tris).toBeGreaterThan(8000);
  });

  it("finds the street width by the sign name, not only the OSM name", () => {
    const strip = (id, name, signName, points, width) => ({ id, kind: "street", highway: "residential", name, signName, nameSource: "city", points, width });
    const level = {
      ...LEVEL,
      strips: [
        strip("a", "Osm Ave", "City Ave NE", [[-40, 0], [0, 0], [40, 0]], 10),
        strip("b", "Osm St", "City St NE", [[0, -40], [0, 0], [0, 40]], 12),
      ],
    };
    for (const t of roadMarkings(level)) for (const v of t.mesh.positions) expect(Number.isFinite(v)).toBe(true);
  });
});
