// Saves high tier screenshots of three facades with the facade depth on and
// off, and the near depth triangle count. The dev server must run.
//
//   node scripts/facade-depth-capture.mjs http://localhost:5174 reports/facade-depth

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
const [base, outDir] = process.argv.slice(2);
const cams = {
  "brick-loft": "-37.5,4,-907.5,-61,9,-913.4",
  "storefront": "-296.7,4,-769,-317.9,4.5,-780.7",
  "stucco": "126.4,4,-271.7,124.6,5.3,-247.6",
};
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const rows = [];
for (const [name, cam] of Object.entries(cams)) {
  for (const depth of ["1", "0"]) {
    await page.goto(`${base}/?level=beltline-eastside&quality=high&view=fixed&depth=${depth}&cam=${cam}`);
    await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 20, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => ({ r: window.__atl.rendererInfo, d: window.__atl.level.facadeDepth, gpu: window.__atl.gpu }));
    const path = resolve(outDir, `${name}-depth${depth}.png`);
    await page.screenshot({ path });
    rows.push({ name, depth: depth === "1", near: info.d?.near ?? null, nearTriangles: info.d?.nearTriangles ?? null, gpu: info.gpu, shot: path.split("/").slice(-2).join("/") });
  }
}
await browser.close();
const out = { date: new Date().toISOString(), rows, errors };
writeFileSync(resolve(outDir, "depth-capture.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
