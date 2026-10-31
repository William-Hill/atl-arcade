import { segmentFrames, stairBoxes } from "../../src/sim/level/parts.js";

// How many Rapier colliders a level should produce. Kept beside the specs so
// the browser number is checked against a number derived from the data.
export function colliderCountFor(level) {
  let count = 0;
  for (const object of level.objects) {
    switch (object.shape.type) {
      case "box":
      case "quarterPipe":
        count += 1;
        break;
      case "stairs":
        count += stairBoxes(object.shape).length;
        break;
      case "segments":
        count += segmentFrames(object.shape.points).length;
        break;
      default:
        throw new Error(`level-counts: unhandled shape ${object.shape.type}`);
    }
  }
  return count;
}
