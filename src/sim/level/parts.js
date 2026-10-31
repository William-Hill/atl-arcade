// Composite shapes broken into the boxes they are made of. Rendering and the
// Rapier world both build from these lists, so a stair tread you can see is a
// stair tread you can land on.

import { distance, normalize, scale, sub } from "../math/vec3.js";
import { quatFromUnitVectors, quatFromYaw, rotateVector } from "../math/quat.js";

const UP = { x: 0, y: 1, z: 0 };

// A stair set rises in its own +X. Step i is a box resting on the ground, so
// the collider under each tread is solid all the way down.
export function stairBoxes(shape) {
  const { position, steps, rise, run, width, yaw = 0 } = shape;
  const turn = quatFromYaw(yaw);
  const boxes = [];

  for (let i = 0; i < steps; i += 1) {
    const height = rise * (i + 1);
    const local = { x: run * (i + 0.5), y: height / 2, z: 0 };
    const offset = rotateVector(turn, local);
    boxes.push({
      position: { x: position.x + offset.x, y: position.y + offset.y, z: position.z + offset.z },
      size: { x: run, y: height, z: width },
      yaw,
    });
  }
  return boxes;
}

// The top front edge of each tread, which is the line a skater grinds or
// clips. Handy for the surface probe and for debug drawing.
export function stairTopEdges(shape) {
  return stairBoxes(shape).map((box) => box.position.y + box.size.y / 2);
}

// One oriented capsule per polyline segment. `rotation` takes +Y onto the
// segment direction, which is what both a Three.js cylinder and a Rapier
// capsule expect.
export function segmentFrames(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error("parts: a segment chain needs at least two points");
  }
  const frames = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const length = distance(a, b);
    if (length <= 1e-9) continue;
    const direction = normalize(sub(b, a));
    frames.push({
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 },
      length,
      direction,
      rotation: quatFromUnitVectors(UP, direction),
    });
  }
  if (frames.length === 0) throw new Error("parts: segment chain has no length");
  return frames;
}

export const midpoint = (a, b) => scale({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }, 0.5);
