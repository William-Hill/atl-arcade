// Saves turntable screenshots of a landmark preview page for the img2threejs
// review gates. The dev server must run (npm run dev).
//
//   node scripts/landmark-capture.mjs <preview-url> <out-dir> [azimuths, default 0,90,180,270] [elevation, default 15] [WxH, default 768x768]

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const [url, outDir, azArg = "0,90,180,270", elArg = "15", sizeArg = "768x768"] = process.argv.slice(2);
const [vw, vh] = sizeArg.split("x").map(Number);
if (!url || !outDir) {
  console.error("usage: node scripts/landmark-capture.mjs <preview-url> <out-dir> [azimuths] [elevation]");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const shots = [];
for (const az of azArg.split(",").map(Number)) {
  const sep = url.includes("?") ? "&" : "?";
  await page.goto(`${url}${sep}az=${az}&el=${elArg}`);
  await page.waitForFunction(() => window.__preview && window.__preview.ready, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  const path = resolve(outDir, `az${String(az).padStart(3, "0")}.png`);
  await page.screenshot({ path, omitBackground: url.includes("bg=none") });
  shots.push(path);
}
const info = await page.evaluate(() => window.__preview);
await browser.close();
console.log(JSON.stringify({ shots, info, errors }, null, 2));
if (errors.length) process.exit(1);
