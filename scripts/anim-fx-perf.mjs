// The CPU cost of the procedural animation layers (#291). It opens
// anim-fx.html in headless Chromium, makes 6 skater views (the player and
// the 5 NPC skaters that the phone tier draws, src/render/npc-skaters-view.js
// NPC_DRAW.phone), and times view.sync() with the layers and without them.
// The two sets run in turns, so a change in the machine load hits both.
// The CDP CPU throttle (--throttle 4) slows the page to about phone speed.
//
// The layers add only CPU work (bone rotations): no draw call and no vertex.
// So this time difference is the frame time growth on the phone tier.
//
// Usage:
//   node scripts/anim-fx-perf.mjs [--base http://localhost:5173] [--throttle 4]
//     [--count 6] [--frames 600] [--runs 7] [--out reports/anim-fx/perf.json]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = arg("base", "http://localhost:5173");
const throttle = Number(arg("throttle", "4"));
const count = Number(arg("count", "6"));
const frames = Number(arg("frames", "600"));
const runs = Number(arg("runs", "7"));
const out = arg("out", null);

const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}/anim-fx.html?dances=dance_bankhead`);
await page.waitForFunction(() => window.__fx && (window.__fx.ready || window.__fx.error), null, { timeout: 60000 });
const cdp = await page.context().newCDPSession(page);
if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
const result = await page.evaluate((o) => window.__fx.bench(o), { count, frames, runs });
await browser.close();

const report = { date: new Date().toISOString(), throttle, ...result, budgetMs: 0.3, pass: result.deltaMs <= 0.3, errors };
console.log(`views ${count}, throttle ${throttle}x: sync ${result.offMs.toFixed(3)} ms without the layers, ${result.fxMs.toFixed(3)} ms with them, +${result.deltaMs.toFixed(3)} ms (budget 0.3 ms)`);
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
}
if (errors.length) console.error(errors);
process.exit(report.pass && errors.length === 0 ? 0 : 1);
