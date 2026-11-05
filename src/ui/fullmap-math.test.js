import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FULLMAP, baseTransform, clampView, fitView, labelFits, nearestIcon, panBy, screenToWorld, streetLabelSpots, worldToScreen, zoomAt } from "./fullmap-math.js";
import { mapFrame, worldToMap } from "./minimap-math.js";

const BOUNDS = { minX: -100, maxX: 300, minZ: -50, maxZ: 750 };

describe("fitView", () => {
  it("shows the whole level inside the margin, centered", () => {
    const v = fitView(BOUNDS, 1000, 800);
    expect(v.x).toBe(100);
    expect(v.z).toBe(350);
    // The level is 400 x 800 m; the height limits the zoom.
    expect(v.zoom).toBeCloseTo((800 - 2 * FULLMAP.margin) / 800, 9);
    const [x0, y0] = worldToScreen(v, 1000, 800, BOUNDS.minX, BOUNDS.minZ);
    const [x1, y1] = worldToScreen(v, 1000, 800, BOUNDS.maxX, BOUNDS.maxZ);
    expect(y0).toBeCloseTo(FULLMAP.margin, 6);
    expect(y1).toBeCloseTo(800 - FULLMAP.margin, 6);
    expect(x0).toBeGreaterThan(0);
    expect(x1).toBeLessThan(1000);
  });

  it("rejects empty bounds", () => {
    expect(() => fitView({ minX: 0, maxX: 0, minZ: 0, maxZ: 1 }, 100, 100)).toThrow(/positive/);
  });
});

describe("clampView", () => {
  it("keeps the zoom between the fit zoom and the closest zoom", () => {
    const fit = fitView(BOUNDS, 1000, 800);
    expect(clampView({ x: 0, z: 0, zoom: 0.01 }, BOUNDS, 1000, 800).zoom).toBe(fit.zoom);
    expect(clampView({ x: 0, z: 0, zoom: 99 }, BOUNDS, 1000, 800).zoom).toBe(FULLMAP.maxZoom);
  });

  it("keeps the center inside the level", () => {
    const v = clampView({ x: -500, z: 5000, zoom: 2 }, BOUNDS, 1000, 800);
    expect(v.x).toBe(BOUNDS.minX);
    expect(v.z).toBe(BOUNDS.maxZ);
  });
});

describe("screen and world", () => {
  const view = { x: 10, z: -20, zoom: 2.5 };

  it("go there and back", () => {
    const [sx, sy] = worldToScreen(view, 800, 600, 37, 12);
    const [x, z] = screenToWorld(view, 800, 600, sx, sy);
    expect(x).toBeCloseTo(37, 9);
    expect(z).toBeCloseTo(12, 9);
  });

  it("zoomAt keeps the point under the pointer", () => {
    const before = screenToWorld(view, 800, 600, 120, 450);
    const z = zoomAt(view, 800, 600, 120, 450, 1.7);
    expect(z.zoom).toBeCloseTo(2.5 * 1.7, 9);
    const after = screenToWorld(z, 800, 600, 120, 450);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
  });

  it("panBy moves the map with the pointer", () => {
    const p = panBy(view, 50, -25);
    const [sx, sy] = worldToScreen(p, 800, 600, ...screenToWorld(view, 800, 600, 400, 300));
    expect(sx).toBeCloseTo(450, 9);
    expect(sy).toBeCloseTo(275, 9);
  });

  it("baseTransform puts a base image pixel where its world point is", () => {
    const frame = mapFrame(BOUNDS, { pxPerMeter: 2, maxTexture: 4096 });
    const [a, , , d, e, f] = baseTransform(frame, view, 1600, 1200, 2);
    const [px, py] = worldToMap(frame, 37, 12);
    const [sx, sy] = worldToScreen(view, 800, 600, 37, 12);
    expect(a * px + e).toBeCloseTo(sx * 2, 6);
    expect(d * py + f).toBeCloseTo(sy * 2, 6);
  });
});

describe("streetLabelSpots", () => {
  const strips = [
    { kind: "street", name: "Ponce de Leon Avenue", points: [[0, 0], [100, 0], [100, 50]] },
    { kind: "street", name: "Ponce de Leon Avenue", points: [[0, 10], [10, 10]] },
    { kind: "street", name: "North Avenue", points: [[50, 0], [0, 0]] },
    { kind: "street", name: "Long Street", points: [[0, 100], [500, 100]] },
    { kind: "sidewalk", name: "Not a street", points: [[0, 0], [500, 0]] },
    { kind: "street", points: [[0, 0], [90, 90]] },
  ];

  it("gives a short piece one name at its middle, and skips a very short piece", () => {
    const spots = streetLabelSpots(strips).filter((s) => s.name !== "Long Street");
    expect(spots.map((s) => s.name)).toEqual(["Ponce de Leon Avenue", "North Avenue"]);
    expect(spots[0].length).toBe(150);
    expect(spots[0].x).toBeCloseTo(75, 9);
    expect(spots[0].z).toBeCloseTo(0, 9);
  });

  it("repeats the name along a long street", () => {
    const long = streetLabelSpots(strips).filter((s) => s.name === "Long Street");
    expect(long).toHaveLength(Math.floor(500 / FULLMAP.labelEvery));
    const xs = long.map((s) => s.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i] - xs[i - 1]).toBeCloseTo(500 / long.length, 6);
  });

  it("keeps every name upright", () => {
    const spots = streetLabelSpots(strips);
    for (const s of spots) {
      expect(s.angle).toBeGreaterThanOrEqual(-Math.PI / 2);
      expect(s.angle).toBeLessThanOrEqual(Math.PI / 2);
    }
    // North Avenue runs west, so its name turns to read east.
    expect(spots.find((s) => s.name === "North Avenue").angle).toBeCloseTo(0, 9);
  });

  it("finds names on the real level", () => {
    const level = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/level.json", import.meta.url)));
    const spots = streetLabelSpots(level.strips);
    expect(new Set(spots.map((s) => s.name)).size).toBeGreaterThan(10);
  });
});

describe("labelFits and nearestIcon", () => {
  it("shows a name only when its street is long enough on the screen", () => {
    const spot = { length: 100 };
    expect(labelFits(spot, 0.5, 80)).toBe(false);
    expect(labelFits(spot, 2, 80)).toBe(true);
  });

  it("finds the nearest icon inside the radius", () => {
    const icons = [{ id: "a", x: 0, z: 0 }, { id: "b", x: 10, z: 0 }];
    expect(nearestIcon(icons, 7, 0, 5).id).toBe("b");
    expect(nearestIcon(icons, 50, 0, 5)).toBe(null);
  });
});

describe("the isometric layer", async () => {
  const { isoBounds, isoLevelFor, visibleTiles } = await import("./fullmap-math.js");
  const info = { a0: -1000, b1: 600, mpp: 0.5, tile: 256, cols: 17, rows: 9, width: 4352, height: 2304, levels: 4 };

  it("gives the image bounds in map space", () => {
    expect(isoBounds(info)).toEqual({ minX: -1000, maxX: 1176, minZ: -600, maxZ: 552 });
  });

  it("draws the full level when zoomed in, and a coarser level when zoomed out", () => {
    expect(isoLevelFor(4, info)).toBe(0);
    expect(isoLevelFor(2, info)).toBe(0);
    expect(isoLevelFor(1, info)).toBe(1);
    expect(isoLevelFor(0.5, info)).toBe(2);
    expect(isoLevelFor(0.01, info)).toBe(3);
  });

  it("lists only the tiles on the screen, at their screen place", () => {
    // 250 px at 2 px/m is 125 m: inside tile 0,0 (128 m on each side).
    const view = { x: -1000 + 62.5, z: -600 + 62.5, zoom: 2 };
    const tiles = visibleTiles(view, 250, 250, info, 0);
    expect(tiles.map((t) => `${t.col},${t.row}`)).toEqual(["0,0"]);
    expect(tiles[0].x).toBeCloseTo(0, 9);
    expect(tiles[0].y).toBeCloseTo(0, 9);
    expect(tiles[0].size).toBeCloseTo(256, 9);
  });

  it("covers the whole image at the overview", () => {
    const b = isoBounds(info);
    const view = fitView(b, 1280, 720);
    const level = isoLevelFor(view.zoom, info);
    const tiles = visibleTiles(view, 1280, 720, info, level);
    expect(tiles).toHaveLength(Math.ceil(info.cols / 2 ** level) * Math.ceil(info.rows / 2 ** level));
  });
});
