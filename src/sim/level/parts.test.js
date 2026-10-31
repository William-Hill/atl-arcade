import { describe, expect, it } from "vitest";
import { segmentFrames, stairBoxes, stairTopEdges } from "./parts.js";
import { rotateVector } from "../math/quat.js";
import { distance, v3 } from "../math/vec3.js";

const stairs = { position: { x: 0, y: 0, z: 0 }, steps: 4, rise: 0.2, run: 0.5, width: 3, yaw: 0 };

describe("stair boxes", () => {
  it("makes one box per step, each resting on the ground", () => {
    const boxes = stairBoxes(stairs);
    expect(boxes).toHaveLength(4);
    for (const box of boxes) expect(box.position.y - box.size.y / 2).toBeCloseTo(0, 10);
  });

  it("climbs by the rise and steps forward by the run", () => {
    expect(stairTopEdges(stairs)).toEqual([0.2, 0.4, 0.6000000000000001, 0.8]);
    const boxes = stairBoxes(stairs);
    expect(boxes[0].position.x).toBeCloseTo(0.25, 10);
    expect(boxes[3].position.x).toBeCloseTo(1.75, 10);
  });

  it("turns the whole flight with yaw", () => {
    const turned = stairBoxes({ ...stairs, yaw: Math.PI / 2 });
    // +X local becomes +X world rotated a quarter turn, so the run goes to Z.
    expect(turned[0].position.x).toBeCloseTo(0, 10);
    expect(Math.abs(turned[0].position.z)).toBeCloseTo(0.25, 10);
  });
});

describe("segment frames", () => {
  it("makes one frame per segment", () => {
    const frames = segmentFrames([v3(0, 1, 0), v3(4, 1, 0), v3(4, 1, 3)]);
    expect(frames).toHaveLength(2);
    expect(frames[0].length).toBe(4);
    expect(frames[1].length).toBe(3);
    expect(frames[0].center).toEqual({ x: 2, y: 1, z: 0 });
  });

  it("rotates +Y onto the segment direction", () => {
    for (const frame of segmentFrames([v3(0, 1, 0), v3(4, 1, 0), v3(4, 2.5, 3)])) {
      const spun = rotateVector(frame.rotation, v3(0, 1, 0));
      expect(distance(spun, frame.direction)).toBeLessThan(1e-9);
    }
  });

  it("drops zero-length segments and rejects an empty chain", () => {
    const frames = segmentFrames([v3(0, 0, 0), v3(0, 0, 0), v3(1, 0, 0)]);
    expect(frames).toHaveLength(1);
    expect(() => segmentFrames([v3(0, 0, 0)])).toThrow();
    expect(() => segmentFrames([v3(2, 2, 2), v3(2, 2, 2)])).toThrow(/no length/);
  });
});
