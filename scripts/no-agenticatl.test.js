import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureFacts } from "../src/facts/client.js";

// #372: Skate ATL and agenticatl.ai are separate products (owner decision,
// 2026-11-24, #23). The game has no link to the site and sends no request to
// it. This test is outside src/, so src/ holds no copy of the string.

const NAME = /agenticatl/i;
const ROOT = fileURLToPath(new URL("../", import.meta.url));

function filesUnder(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

describe("no agenticatl.ai in the game", () => {
  it("has no agenticatl string in a fact card of a level", () => {
    for (const level of readdirSync(join(ROOT, "src/facts/fixtures")).map((f) => f.replace(/\.json$/, ""))) {
      const specs = JSON.parse(readFileSync(join(ROOT, "levels", level, "facts.json"), "utf8")).cards;
      const fixture = JSON.parse(readFileSync(join(ROOT, "src/facts/fixtures", `${level}.json`), "utf8"));
      for (const c of fixtureFacts(specs, fixture)) expect(JSON.stringify(c), c.id).not.toMatch(NAME);
    }
  });
  it("has no agenticatl string in src/, index.html, or vite.config.js", () => {
    const files = [...filesUnder(join(ROOT, "src")), join(ROOT, "index.html"), join(ROOT, "vite.config.js")];
    const hits = files.filter((p) => NAME.test(readFileSync(p, "latin1"))).map((p) => relative(ROOT, p));
    expect(hits).toEqual([]);
  });
});
