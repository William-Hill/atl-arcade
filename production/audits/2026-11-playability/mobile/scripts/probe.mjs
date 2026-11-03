// Probe: which GPU and tier does headless Chromium get, with and without
// the Metal flags? Writes probe.json.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OUT, LEVEL_URL, launch, profile, waitReady, loadAverage } from "./common.mjs";

const out = [];
for (const gpu of [false, true]) {
  const browser = await launch({ gpu });
  const ctx = await browser.newContext(profile("Pixel 7"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(LEVEL_URL("mute=1"));
  await waitReady(page);
  out.push({ gpuFlags: gpu, readyMs: Date.now() - t0, gpu: await page.evaluate(() => window.__atl.gpu), quality: await page.evaluate(() => window.__atl.quality), errors, load: loadAverage() });
  await browser.close();
}
console.log(JSON.stringify(out, null, 2));
writeFileSync(resolve(OUT, "probe.json"), JSON.stringify(out, null, 2));
