// Validates the landmark data file of each level (#216).
//
//   node scripts/validate-landmarks.mjs [level ...]
//
// With no level it checks every level that has a landmarks.json. It exits
// with code 1 on the first file with an error, so `npm run build` fails
// (the `prebuild` script runs it).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createLevelEnv } from "../src/level/ground.js";
import { landmarkCounts, validateLandmarks } from "../src/landmarks/validate.js";

const root = resolve(import.meta.dirname, "..");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

// The facts about a level that the validator needs.
export function landmarkContext(name) {
  const dir = resolve(root, "levels", name);
  const level = read(resolve(dir, "level.json"));
  const goalsFile = resolve(dir, "goals.json");
  const permissions = resolve(root, "docs/permissions");
  return {
    level,
    grindables: createLevelEnv(level).grindables,
    goals: existsSync(goalsFile) ? read(goalsFile).goals : [],
    permissions: existsSync(permissions) ? readdirSync(permissions) : [],
  };
}

export function checkLevel(name) {
  const data = read(resolve(root, "levels", name, "landmarks.json"));
  return { data, errors: validateLandmarks(data, landmarkContext(name)) };
}

if (import.meta.filename === resolve(process.argv[1] ?? "")) {
  const asked = process.argv.slice(2);
  const levels = asked.length > 0 ? asked : readdirSync(resolve(root, "levels")).filter((n) => existsSync(resolve(root, "levels", n, "landmarks.json")));
  let failed = false;
  for (const name of levels) {
    const { data, errors } = checkLevel(name);
    if (errors.length > 0) {
      failed = true;
      console.error(`levels/${name}/landmarks.json: ${errors.length} error(s)`);
      for (const e of errors) console.error(`  ${e}`);
    } else {
      const c = landmarkCounts(data);
      console.log(`levels/${name}/landmarks.json: OK, ${c.claim} claim spots and ${c.edge} edge markers`);
    }
  }
  process.exit(failed ? 1 : 0);
}
