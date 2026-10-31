// The surface under a point. The skate controller is a pure module, so it
// cannot ask Rapier what it is standing on; it asks this instead.
//
// Built from the same level data and the same decomposition helpers as the
// Rapier colliders (src/sim/level/parts.js, quarter-pipe.js), so the two agree.

import { stairBoxes } from "./parts.js";
import { quarterPipeHeightAt } from "./quarter-pipe.js";

export const VOID = Object.freeze({ height: -Infinity, kind: "void", objectId: null });

// Returns (x, z) -> { height, kind, objectId }: the highest solid top face at
// that column, or VOID over open air.
export function createSurfaceProbe(level) {
  const faces = [];

  for (const object of level.objects) {
    const shape = object.shape;
    switch (shape.type) {
      case "box":
        faces.push(boxFace(object, shape.position, shape.size, shape.yaw ?? 0));
        break;
      case "stairs":
        for (const box of stairBoxes(shape)) faces.push(boxFace(object, box.position, box.size, box.yaw));
        break;
      case "quarterPipe":
        faces.push(quarterPipeFace(object, shape));
        break;
      case "segments":
        // Rails are grind targets, not standing surfaces. M0-05 owns them.
        break;
      default:
        throw new Error(`probe: unhandled shape ${shape.type}`);
    }
  }

  return function probe(x, z) {
    let best = VOID;
    for (const face of faces) {
      const height = face.heightAt(x, z);
      // >= so that where two faces meet at the same height, the one declared
      // later in the level wins. Level data runs general to specific: ground,
      // then sidewalks, then the things sitting on them. At the roll-in seam
      // this hands back the ramp rather than the street, so the surface
      // normal starts tilting the moment the skater touches the transition.
      if (height !== null && height >= best.height) {
        best = { height, kind: face.kind, objectId: face.objectId };
      }
    }
    return best;
  };
}

function boxFace(object, position, size, yaw) {
  const halfX = size.x / 2;
  const halfZ = size.z / 2;
  const top = position.y + size.y / 2;
  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);

  return {
    kind: object.kind,
    objectId: object.id,
    heightAt(x, z) {
      const dx = x - position.x;
      const dz = z - position.z;
      // Rotate the query into the box's own frame rather than rotating the box.
      const localX = dx * cos + dz * sin;
      const localZ = -dx * sin + dz * cos;
      if (Math.abs(localX) > halfX || Math.abs(localZ) > halfZ) return null;
      return top;
    },
  };
}

function quarterPipeFace(object, shape) {
  const { position, radius, width, yaw = 0 } = shape;
  const halfWidth = width / 2;
  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);

  return {
    kind: object.kind,
    objectId: object.id,
    heightAt(x, z) {
      const dx = x - position.x;
      const dz = z - position.z;
      const localX = dx * cos + dz * sin;
      const localZ = -dx * sin + dz * cos;
      // The lip is at localX === radius, and the arithmetic that gets us
      // there rarely lands on it exactly, so the far edge gets a tolerance.
      if (localX < 0 || localX > radius + 1e-6 || Math.abs(localZ) > halfWidth) return null;
      return position.y + quarterPipeHeightAt(radius, Math.min(localX, radius));
    },
  };
}

// Slope of the surface at a point, as a unit normal. Sampled, because the
// quarter-pipe is the only curved face and a two-point sample is enough to
// keep the skater's nose pointing up the transition.
export function surfaceNormal(probe, x, z, step = 0.05) {
  const here = probe(x, z).height;
  if (!Number.isFinite(here)) return { x: 0, y: 1, z: 0 };

  const east = probe(x + step, z).height;
  const north = probe(x, z + step).height;
  const dx = Number.isFinite(east) ? (east - here) / step : 0;
  const dz = Number.isFinite(north) ? (north - here) / step : 0;

  const length = Math.hypot(-dx, 1, -dz);
  return { x: -dx / length, y: 1 / length, z: -dz / length };
}
