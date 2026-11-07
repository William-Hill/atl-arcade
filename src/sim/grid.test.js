import { describe, expect, it } from "vitest";
import { createGrid, gridNear, gridOf, gridRemove, gridSet } from "./grid.js";
import { seededRandom } from "./npc/crowd.js";

const near = (grid, x, z, r) => {
  const out = [];
  gridNear(grid, x, z, r, (it) => {
    if (Math.abs(it.x - x) <= r && Math.abs(it.z - z) <= r) out.push(it.id);
  });
  return out.sort((a, b) => a - b);
};

describe("grid", () => {
  it("finds the same items as a full scan, with negative coordinates too", () => {
    const rand = seededRandom(3);
    const items = Array.from({ length: 300 }, (_, id) => ({
      id,
      x: (rand() - 0.5) * 400,
      z: (rand() - 0.5) * 400,
    }));
    const grid = gridOf(items, 4);
    for (let k = 0; k < 50; k += 1) {
      const x = (rand() - 0.5) * 400;
      const z = (rand() - 0.5) * 400;
      const r = rand() * 20;
      const scan = items
        .filter((it) => Math.abs(it.x - x) <= r && Math.abs(it.z - z) <= r)
        .map((it) => it.id)
        .sort((a, b) => a - b);
      expect(near(grid, x, z, r)).toEqual(scan);
    }
  });

  it("moves an item to its new cell and takes it out", () => {
    const grid = createGrid(4);
    const a = { id: 1, x: 1, z: 1 };
    gridSet(grid, a, a.x, a.z);
    expect(near(grid, 1, 1, 1)).toEqual([1]);
    a.x = 50;
    gridSet(grid, a, a.x, a.z);
    expect(near(grid, 1, 1, 1)).toEqual([]);
    expect(near(grid, 50, 1, 1)).toEqual([1]);
    gridRemove(grid, a);
    expect(near(grid, 50, 1, 1)).toEqual([]);
    expect(grid.cells.size).toBe(0);
    // A position that is not finite is not in the grid.
    gridSet(grid, a, Infinity, 0);
    expect(grid.cells.size).toBe(0);
  });

  it("stops the search when the callback returns true", () => {
    const grid = gridOf(
      [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
      ],
      4,
    );
    let calls = 0;
    expect(gridNear(grid, 0, 0, 2, () => ((calls += 1), true))).toBe(true);
    expect(calls).toBe(1);
    expect(gridNear(grid, 100, 100, 2, () => true)).toBe(false);
  });
});
