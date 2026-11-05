import { describe, expect, it } from "vitest";
import { ISO, isoBasis, isoCameraPose, isoGrid, isoPixel, isoProject, pyramid, tileCenter } from "./iso-map.js";

const BOUNDS = { minX: -500, maxX: 500, minZ: -1000, maxZ: 1050 };

describe("isoBasis", () => {
  it("gives unit vectors at right angles", () => {
    const { d, r, u } = isoBasis();
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (const v of [d, r, u]) expect(Math.hypot(...v)).toBeCloseTo(1, 12);
    expect(dot(d, r)).toBeCloseTo(0, 12);
    expect(dot(d, u)).toBeCloseTo(0, 12);
    expect(dot(r, u)).toBeCloseTo(0, 12);
  });

  it("looks 30 degrees down to the north-west, with up on the screen up", () => {
    const { d, r, u } = isoBasis();
    expect((Math.asin(-d[1]) * 180) / Math.PI).toBeCloseTo(ISO.pitch, 9);
    expect(d[0]).toBeLessThan(0); // west
    expect(d[2]).toBeLessThan(0); // north
    expect(r[1]).toBe(0); // the horizon is level
    expect(u[1]).toBeGreaterThan(0);
  });
});

describe("isoGrid and isoPixel", () => {
  const basis = isoBasis();
  const grid = isoGrid(BOUNDS, -10, 120, { basis });

  it("covers every corner of the level, from the ground to the roofs, inside the image", () => {
    for (const x of [BOUNDS.minX, BOUNDS.maxX]) {
      for (const z of [BOUNDS.minZ, BOUNDS.maxZ]) {
        for (const y of [-10, 120]) {
          const [px, py] = isoPixel(grid, basis, x, y, z);
          expect(px).toBeGreaterThanOrEqual(0);
          expect(py).toBeGreaterThanOrEqual(0);
          expect(px).toBeLessThanOrEqual(grid.width);
          expect(py).toBeLessThanOrEqual(grid.height);
        }
      }
    }
  });

  it("is a whole number of tiles", () => {
    expect(grid.width).toBe(grid.cols * ISO.tile);
    expect(grid.height).toBe(grid.rows * ISO.tile);
  });

  it("draws a higher point higher in the image", () => {
    expect(isoPixel(grid, basis, 0, 30, 0)[1]).toBeLessThan(isoPixel(grid, basis, 0, 0, 0)[1]);
    expect(isoPixel(grid, basis, 0, 30, 0)[0]).toBeCloseTo(isoPixel(grid, basis, 0, 0, 0)[0], 9);
  });

  it("puts the center of a tile at the middle of its pixels", () => {
    const [a, b] = tileCenter(grid, 3, 2);
    expect((a - grid.a0) / grid.mpp).toBeCloseTo(3.5 * ISO.tile, 9);
    expect((grid.b1 - b) / grid.mpp).toBeCloseTo(2.5 * ISO.tile, 9);
  });
});

describe("isoCameraPose", () => {
  it("stands at the ground height on the view line of the tile center", () => {
    const basis = isoBasis();
    const pose = isoCameraPose(basis, 120, -340, 7.5);
    expect(pose.position[1]).toBeCloseTo(7.5, 9);
    const [a, b] = isoProject(basis, ...pose.position);
    expect(a).toBeCloseTo(120, 9);
    expect(b).toBeCloseTo(-340, 9);
    const [ta, tb] = isoProject(basis, ...pose.target);
    expect(ta).toBeCloseTo(120, 9);
    expect(tb).toBeCloseTo(-340, 9);
  });
});

describe("pyramid", () => {
  it("halves the tiles at each level", () => {
    expect(pyramid({ cols: 17, rows: 9 }, 4)).toEqual([
      { level: 0, cols: 17, rows: 9 },
      { level: 1, cols: 9, rows: 5 },
      { level: 2, cols: 5, rows: 3 },
      { level: 3, cols: 3, rows: 2 },
    ]);
  });
});

describe("isoUnproject", async () => {
  const { isoUnproject } = await import("./iso-map.js");
  const basis = isoBasis();

  it("finds the ground point back on flat ground", () => {
    const [a, b] = isoProject(basis, 120, 0, -45);
    const p = isoUnproject(basis, a, b, () => 0);
    expect(p[0]).toBeCloseTo(120, 9);
    expect(p[1]).toBe(0);
    expect(p[2]).toBeCloseTo(-45, 9);
  });

  it("finds the ground point on a slope to within a few cm", () => {
    const ground = (x, z) => 0.05 * x - 0.03 * z + 4;
    const [a, b] = isoProject(basis, 80, ground(80, 30), 30);
    const p = isoUnproject(basis, a, b, ground, 8);
    expect(Math.hypot(p[0] - 80, p[2] - 30)).toBeLessThan(0.05);
  });
});

describe("the baked isometric map of the BeltLine level", async () => {
  const { readFileSync } = await import("node:fs");
  const { levelIsoGrid } = await import("./iso-map.js");
  const { terrainOf } = await import("./terrain.js");
  const level = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url)));
  const info = JSON.parse(readFileSync(new URL("../../../assets/map/beltline-eastside/iso.json", import.meta.url)));

  it("matches the level and the camera; if not, bake it again (scripts/bake-iso-map.mjs)", () => {
    const t = terrainOf(level);
    const { grid } = levelIsoGrid(level, (x, z) => t.height(x, z), isoBasis(info.yaw, info.pitch));
    expect([info.yaw, info.pitch, info.mpp, info.tile]).toEqual([ISO.yaw, ISO.pitch, ISO.mpp, ISO.tile]);
    expect({ a0: info.a0, b1: info.b1, cols: info.cols, rows: info.rows }).toEqual({ a0: grid.a0, b1: grid.b1, cols: grid.cols, rows: grid.rows });
  });
});
