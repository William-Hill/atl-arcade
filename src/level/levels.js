// The level list for the shell. `?level=<name>` picks one. The BeltLine
// Eastside is the default. The greybox is the debug level: open it with
// `?level=greybox`. A geodata level loads on demand, so the greybox page does
// not download it.

import { GREYBOX } from "./greybox.js";
import { withSkatepark } from "./skatepark.js";

export const LEVELS = {
  greybox: async () => GREYBOX,
  "beltline-eastside": async () => {
    const [level, canopy, skatepark, features] = await Promise.all([
      import("../../levels/beltline-eastside/level.json"),
      import("../../levels/beltline-eastside/canopy.json"),
      import("../../levels/beltline-eastside/skatepark.json"),
      import("../../assets/skate-features/features.json"),
    ]);
    // The skatepark (#222) grades the terrain under its pad, so it goes in
    // before anything reads the ground.
    return withSkatepark(withCanopy(level.default, canopy.default), skatepark.default, features.default);
  },
};

// Pure: the level with its canopy grid (scripts/city-canopy.py, issue #137).
// The grid is a file of its own, so the level build does not write it.
// Props use it for the canopy trees, and its credit goes on the level
// attribution.
export function withCanopy(level, canopy) {
  if (!canopy) return level;
  const credit = canopy.attribution;
  const attribution = credit && level.attribution && !level.attribution.includes(credit) ? `${level.attribution}. ${credit}` : level.attribution;
  return { ...level, canopy, attribution };
}

export const DEFAULT_LEVEL = "beltline-eastside";

export const LEVEL_ALIASES = { beltline: "beltline-eastside" };

export function resolveLevelName(name) {
  const n = name || DEFAULT_LEVEL;
  const resolved = LEVEL_ALIASES[n] ?? n;
  // Own keys only: "constructor" or "toString" is not a level.
  if (!Object.hasOwn(LEVELS, resolved)) throw new Error(`unknown level "${n}". Known: ${Object.keys(LEVELS).join(", ")}`);
  return resolved;
}

export function loadLevel(name) {
  return LEVELS[resolveLevelName(name)]();
}
