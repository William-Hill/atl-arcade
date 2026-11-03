// Dumps the built part tree of a landmark preview for the img2threejs part
// coverage gate (check_part_coverage.py --manifest).
//   node scripts/landmark-parts.mjs <preview-url> <model-name> <out.json>

import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [url, name, out] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.goto(url);
await page.waitForFunction(() => window.__preview && window.__previewModel, null, { timeout: 30000 });
const manifest = await page.evaluate((model) => {
  const parts = [];
  let unnamed = 0;
  window.__previewModel.traverse((o) => {
    if (!o.isMesh) return;
    const id = o.userData?.sculptComponent?.id;
    const g = o.geometry;
    const triangles = (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (id) parts.push({ name: id, kind: "part", module: id, triangles });
    else unnamed += 1;
  });
  return { model, parts, unnamedMeshes: unnamed, integralMeshes: 0 };
}, name);
await browser.close();
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`landmark-parts: ${manifest.parts.length} parts, ${manifest.unnamedMeshes} unnamed meshes -> ${out}`);
