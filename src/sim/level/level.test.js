import { describe, expect, it } from "vitest";
import { GREYBOX_BLOCK } from "../../levels/greybox-block.js";
import { findObject, grindables, levelBounds, objectsOfKind, validateLevel } from "./level.js";
import { polylineLength } from "./spline.js";

const minimal = () => ({
  id: "t",
  spawn: { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
  objects: [
    { id: "g", kind: "ground", shape: { type: "box", position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } } },
  ],
});

describe("level validation", () => {
  it("accepts a minimal level", () => {
    expect(() => validateLevel(minimal())).not.toThrow();
  });

  it("rejects duplicate ids", () => {
    const level = minimal();
    level.objects.push({ ...level.objects[0] });
    expect(() => validateLevel(level)).toThrow(/duplicate object id g/);
  });

  it("rejects an unknown kind and an unknown shape", () => {
    const badKind = minimal();
    badKind.objects[0].kind = "helicopter";
    expect(() => validateLevel(badKind)).toThrow(/unknown kind/);

    const badShape = minimal();
    badShape.objects[0].shape = { type: "blob" };
    expect(() => validateLevel(badShape)).toThrow(/unknown shape type/);
  });

  it("rejects a grindable with no usable spline", () => {
    const noSpline = minimal();
    noSpline.objects.push({
      id: "r",
      kind: "rail",
      shape: { type: "segments", radius: 0.05, points: [{ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }] },
    });
    expect(() => validateLevel(noSpline)).toThrow(/needs a grind spline/);

    const zeroLength = minimal();
    zeroLength.objects.push({
      id: "r",
      kind: "rail",
      shape: { type: "segments", radius: 0.05, points: [{ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }] },
      spline: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }],
    });
    expect(() => validateLevel(zeroLength)).toThrow(/no length/);
  });

  it("rejects a box with no size and a ramp with no radius", () => {
    const badBox = minimal();
    badBox.objects[0].shape.size = { x: 1, y: 0, z: 1 };
    expect(() => validateLevel(badBox)).toThrow(/positive size/);

    const badRamp = minimal();
    badRamp.objects.push({ id: "p", kind: "ramp", shape: { type: "quarterPipe", position: { x: 0, y: 0, z: 0 }, width: 2 } });
    expect(() => validateLevel(badRamp)).toThrow(/positive radius/);
  });
});

describe("the greybox block", () => {
  it("is valid", () => {
    expect(() => validateLevel(GREYBOX_BLOCK)).not.toThrow();
  });

  it("has the objects M0-02 asks for", () => {
    expect(objectsOfKind(GREYBOX_BLOCK, "ground")).toHaveLength(1);
    expect(objectsOfKind(GREYBOX_BLOCK, "sidewalk")).toHaveLength(2);
    expect(objectsOfKind(GREYBOX_BLOCK, "curb")).toHaveLength(2);
    expect(objectsOfKind(GREYBOX_BLOCK, "rail")).toHaveLength(3);
    expect(objectsOfKind(GREYBOX_BLOCK, "ledge")).toHaveLength(2);
    expect(objectsOfKind(GREYBOX_BLOCK, "ramp")).toHaveLength(1);
    expect(objectsOfKind(GREYBOX_BLOCK, "stairs")).toHaveLength(1);
  });

  it("has one straight, one kinked and one curved rail", () => {
    const [straight, kinked, curved] = objectsOfKind(GREYBOX_BLOCK, "rail");
    expect(straight.spline).toHaveLength(2);
    expect(kinked.spline).toHaveLength(3);
    expect(curved.spline.length).toBeGreaterThan(3);
  });

  it("gives every grindable a spline with real length", () => {
    const lines = grindables(GREYBOX_BLOCK);
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(polylineLength(line.spline)).toBeGreaterThan(3);
  });

  it("spawns the skater on the street inside the block", () => {
    const bounds = levelBounds(GREYBOX_BLOCK);
    const spawn = GREYBOX_BLOCK.spawn.position;
    expect(spawn.x).toBeGreaterThan(bounds.min.x);
    expect(spawn.x).toBeLessThan(bounds.max.x);
    expect(spawn.z).toBeGreaterThan(bounds.min.z);
    expect(spawn.z).toBeLessThan(bounds.max.z);
  });

  it("puts the ledges on top of the sidewalks, not floating", () => {
    const sidewalkTop = findObject(GREYBOX_BLOCK, "sidewalk-north").shape.size.y;
    for (const id of ["ledge-west", "ledge-east"]) {
      const ledge = findObject(GREYBOX_BLOCK, id);
      const bottom = ledge.shape.position.y - ledge.shape.size.y / 2;
      expect(bottom).toBeCloseTo(sidewalkTop, 6);
      // The spline rides the top face.
      expect(ledge.spline[0].y).toBeCloseTo(ledge.shape.position.y + ledge.shape.size.y / 2, 6);
    }
  });
});
