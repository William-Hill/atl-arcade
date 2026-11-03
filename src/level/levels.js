// The level list for the shell. `?level=<name>` picks one; the greybox is
// the default. A geodata level loads on demand, so the greybox page does not
// download it.

import { GREYBOX } from "./greybox.js";

export const LEVELS = {
  greybox: async () => GREYBOX,
  "beltline-eastside": async () => (await import("../../levels/beltline-eastside/level.json")).default,
};

export const LEVEL_ALIASES = { beltline: "beltline-eastside" };

export function resolveLevelName(name) {
  const n = name ?? "greybox";
  const resolved = LEVEL_ALIASES[n] ?? n;
  // Own keys only: "constructor" or "toString" is not a level.
  if (!Object.hasOwn(LEVELS, resolved)) throw new Error(`unknown level "${n}". Known: ${Object.keys(LEVELS).join(", ")}`);
  return resolved;
}

export function loadLevel(name) {
  return LEVELS[resolveLevelName(name)]();
}
