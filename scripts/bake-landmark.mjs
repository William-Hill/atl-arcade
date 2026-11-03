// Bakes an img2threejs landmark preview into one vertex-colored template
// for the game: <out>.json with positions, normals, colors, and indices.
// The dev server must run (npm run dev).
//
//   node scripts/bake-landmark.mjs <preview-url> <out.json>

import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node scripts/bake-landmark.mjs <preview-url> <out.json>");
  process.exit(2);
}
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.goto(`${url}${url.includes("?") ? "&" : "?"}bake=1`);
await page.waitForFunction(() => window.__bake, null, { timeout: 30000 });
const bake = await page.evaluate(() => window.__bake);
await browser.close();
writeFileSync(out, `${JSON.stringify({ format: "landmark-template/1", source: url, ...bake })}\n`);
console.log(`bake-landmark: ${out} ${bake.positions.length / 3} vertices, ${bake.indices.length / 3} triangles`);
