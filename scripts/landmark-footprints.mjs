// Renders the visible-footprint evidence for the patched img2threejs Tier 1
// color check: full.png (unlit) and hide-<componentId>.png for every part,
// all from one camera. The dev server must run (npm run dev).
//
//   node scripts/landmark-footprints.mjs <preview-url-with-camera-params> <spec.json> <out-dir> <WxH>

import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const [url, specPath, outDir, sizeArg = "768x768"] = process.argv.slice(2);
if (!url || !specPath || !outDir) {
  console.error("usage: node scripts/landmark-footprints.mjs <preview-url> <spec.json> <out-dir> [WxH]");
  process.exit(2);
}
const [vw, vh] = sizeArg.split("x").map(Number);
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const ids = spec.componentTree.map((c) => c.id);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const sep = url.includes("?") ? "&" : "?";
async function shot(query, name) {
  await page.goto(`${url}${sep}unlit=1${query}`);
  await page.waitForFunction(() => window.__preview && window.__preview.ready && window.__frames > 3, null, { timeout: 30000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(outDir, name) });
}
await shot("", "full.png");
for (const id of ids) await shot(`&hidePart=${encodeURIComponent(id)}`, `hide-${id}.png`);
await browser.close();
console.log(`landmark-footprints: ${ids.length + 1} renders in ${outDir}`);
