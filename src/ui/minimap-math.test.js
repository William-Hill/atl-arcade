import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cropRect, headingAngle, initials, mapFrame, mapParks, mapToWorld, needsRedraw, projectToView, stripWidth, stripsInOrder, viewTransform, worldToMap } from "./minimap-math.js";
import { pointInRings } from "../level/geo/geo-ground.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const BOUNDS = { minX: -100, maxX: 100, minZ: -50, maxZ: 150 };

describe("mapFrame and worldToMap", () => {
  it("puts the bounds corner at pixel (0, 0) and keeps 1 px per meter", () => {
    const f = mapFrame(BOUNDS);
    expect(f).toMatchObject({ scale: 1, width: 200, height: 200 });
    expect(worldToMap(f, -100, -50)).toEqual([0, 0]);
    expect(worldToMap(f, 100, 150)).toEqual([200, 200]);
  });

  it("puts north up and east right", () => {
    const f = mapFrame(BOUNDS);
    const [x0, y0] = worldToMap(f, 0, 0);
    const [xe] = worldToMap(f, 10, 0);
    const [, yn] = worldToMap(f, 0, -10); // north is -z
    expect(xe).toBeGreaterThan(x0);
    expect(yn).toBeLessThan(y0);
  });

  it("makes the scale smaller so the largest side fits the size limit", () => {
    const f = mapFrame(LEVEL.bounds, { maxTexture: 1024 });
    expect(Math.max(f.width, f.height)).toBeLessThanOrEqual(1024);
    expect(f.scale).toBeLessThan(1);
  });

  it("mapToWorld is the inverse of worldToMap", () => {
    const f = mapFrame(LEVEL.bounds);
    const [px, py] = worldToMap(f, 123.4, -567.8);
    const [x, z] = mapToWorld(f, px, py);
    expect(x).toBeCloseTo(123.4, 9);
    expect(z).toBeCloseTo(-567.8, 9);
  });

  it("refuses empty bounds", () => {
    expect(() => mapFrame({ minX: 0, maxX: 0, minZ: 0, maxZ: 1 })).toThrow();
  });
});

describe("viewTransform", () => {
  const f = mapFrame(BOUNDS);
  const size = 120;
  const opts = { size, viewMeters: 60 };

  it("puts the skater at the center in both modes", () => {
    for (const mode of ["north", "heading"]) {
      const v = viewTransform(f, { x: 20, z: 30, yaw: 0.7 }, { ...opts, mode });
      const [x, y] = projectToView(f, v, 20, 30);
      expect(x).toBeCloseTo(size / 2, 9);
      expect(y).toBeCloseTo(size / 2, 9);
    }
  });

  it("shows viewMeters across the view", () => {
    const v = viewTransform(f, { x: 0, z: 0, yaw: 0 }, { ...opts, mode: "north" });
    const [xl] = projectToView(f, v, -30, 0);
    const [xr] = projectToView(f, v, 30, 0);
    expect(xr - xl).toBeCloseTo(size, 9);
  });

  it("north up: a point north of the skater is straight up, and the arrow turns with the heading", () => {
    const v = viewTransform(f, { x: 0, z: 0, yaw: 0 }, { ...opts, mode: "north" });
    const [x, y] = projectToView(f, v, 0, -10);
    expect(x).toBeCloseTo(size / 2, 9);
    expect(y).toBeLessThan(size / 2);
    // yaw 0 faces +x (east): the arrow turns 90 degrees clockwise.
    expect(v.arrow).toBeCloseTo(Math.PI / 2, 9);
    expect(v.north).toBe(0);
  });

  it("heading up: the point in front of the skater is straight up, and the arrow points up", () => {
    for (const yaw of [0, 0.5, 2, -2.8]) {
      const s = { x: 5, z: -5, yaw };
      const v = viewTransform(f, s, { ...opts, mode: "heading" });
      const ahead = [s.x + Math.cos(yaw) * 10, s.z - Math.sin(yaw) * 10];
      const [x, y] = projectToView(f, v, ahead[0], ahead[1]);
      expect(x).toBeCloseTo(size / 2, 9);
      expect(y).toBeCloseTo(size / 2 - 10 * (size / 60), 9);
      expect(v.arrow).toBe(0);
    }
  });

  it("heading angle: yaw 0 is east, yaw PI/2 is north", () => {
    expect(headingAngle(0)).toBeCloseTo(Math.PI / 2, 9);
    expect(headingAngle(Math.PI / 2)).toBeCloseTo(0, 9);
  });
});

describe("cropRect", () => {
  const f = mapFrame(BOUNDS);
  it("covers the circle and clips to the image", () => {
    expect(cropRect(f, 100, 100, 20)).toEqual({ x: 80, y: 80, w: 40, h: 40 });
    expect(cropRect(f, 5, 195, 20)).toEqual({ x: 0, y: 175, w: 25, h: 25 });
  });
  it("is null outside the image", () => {
    expect(cropRect(f, -100, -100, 20)).toBeNull();
  });
});

describe("needsRedraw", () => {
  const a = { x: 0, z: 0, yaw: 0, mode: "north" };
  it("draws the first frame, a move, a turn, and a mode change", () => {
    expect(needsRedraw(null, a)).toBe(true);
    expect(needsRedraw(a, { ...a, x: 1 })).toBe(true);
    expect(needsRedraw(a, { ...a, yaw: 0.1 })).toBe(true);
    expect(needsRedraw(a, { ...a, mode: "heading" })).toBe(true);
  });
  it("skips a frame with no visible change", () => {
    expect(needsRedraw(a, { ...a, x: 0.01 })).toBe(false);
    expect(needsRedraw(a, { ...a, yaw: Math.PI * 2 })).toBe(false);
  });
});

describe("level content", () => {
  it("lists each named park once", () => {
    const parks = mapParks(LEVEL);
    expect(parks.every((i) => i.kind === "park")).toBe(true);
    for (const p of parks) {
      const a = LEVEL.areas.find((x) => x.id === p.id);
      expect(pointInRings(p.x, p.z, [a.outer, ...(a.holes ?? [])])).toBe(true);
    }
    const names = parks.map((p) => p.name);
    expect(names).toContain("Freedom Park");
    expect(names).toContain("Historic Fourth Ward Park");
    expect(new Set(names).size).toBe(names.length);
  });

  it("draws the trail last and widest", () => {
    const f = mapFrame(LEVEL.bounds);
    const order = stripsInOrder(LEVEL.strips);
    expect(order.at(-1).kind).toBe("trail");
    const trail = stripWidth(f, order.at(-1));
    for (const s of order.filter((x) => x.kind !== "trail" && x.kind !== "street")) expect(stripWidth(f, s)).toBeLessThan(trail);
  });

  it("makes initials from the first letters", () => {
    expect(initials("Ponce City Market")).toBe("PCM");
    expect(initials("")).toBe("");
  });
});
