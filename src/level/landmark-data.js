// The landmark spots of each level (#216): data, read by src/sim/landmarks.js.
// A geodata level keeps its spots in levels/<name>/landmarks.json, next to
// its goals.json (the level build does not write that file).

import beltline from "../../levels/beltline-eastside/landmarks.json" with { type: "json" };

export const LEVEL_LANDMARKS = {
  "beltline-eastside": beltline,
};

// `name` is a level name (level.name). Null for a level with no landmark file.
export function landmarksFor(name) {
  return Object.hasOwn(LEVEL_LANDMARKS, name) ? LEVEL_LANDMARKS[name] : null;
}
