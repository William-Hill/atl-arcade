// Counts how the facade style of each building is decided (issue #406).
//
//   node scripts/style-coverage.mjs levels/beltline-eastside/level.json
//
// A building is "hash-decided" when its style depends on its id: the script
// gives the building other ids, and a style change shows that the hash
// (hash32 of the id) picks the style. Else the name, the OSM type, the OSM
// material, the size, or the parcel data decides.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chooseStyle } from "../src/level/geo/styles.js";

// The ids to try. 24 ids give each 1% hash band of chooseStyle() a high
// chance to show.
const PROBES = Array.from({ length: 24 }, (_, i) => `probe-${i}`);

// Does the style of `b` depend on its id?
export function hashDecided(b, level = null) {
  const style = chooseStyle(b, level);
  return PROBES.some((id) => chooseStyle({ ...b, id }, level) !== style);
}

// The counts for a level: { buildings, hash, data, styles }.
// `styles` counts the style ids.
export function styleCoverage(level) {
  const out = { buildings: 0, hash: 0, data: 0, styles: {} };
  for (const b of level.buildings ?? []) {
    out.buildings += 1;
    if (hashDecided(b, level)) out.hash += 1;
    else out.data += 1;
    const s = chooseStyle(b, level);
    out.styles[s] = (out.styles[s] ?? 0) + 1;
  }
  out.styles = Object.fromEntries(Object.entries(out.styles).sort());
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const file = process.argv[2] ?? "levels/beltline-eastside/level.json";
  console.log(JSON.stringify(styleCoverage(JSON.parse(readFileSync(resolve(file), "utf8"))), null, 1));
}
