// Screenshots of skater clips at 3 frames, and the lowest wheel at each
// frame, from skater.html in headless Chromium. Used for the before and
// after evidence of the physics pass (scripts/blender/skater_physics_pass.py).
//
// Start the dev server first (npm run dev -- --port 5180), then:
//   node scripts/skater-clip-shots.mjs --label after --out docs/characters/physics-pass \
//     [--base http://localhost:5180] [--clips push,coast,carve_left,carve_right]
// It writes <out>/<label>/<skater>-<clip>-<view>.png and <out>/<label>.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const label = arg("label", "after");
const out = arg("out", "docs/characters/physics-pass");
const base = arg("base", "http://localhost:5180");
const clips = arg("clips", "push,coast,carve_left,carve_right").split(",");
const skaters = arg("skaters", "nia,marcus").split(",");
const VIEWS = ["three-quarter", "left"];
// 3 frames: t = 0, 1/3, and 2/3 of the clip (the clips loop, so t = 1 is t = 0).
const COLS = 4;
const W = 300;
const H = 420;

mkdirSync(join(out, label), { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
const report = {
  label,
  frames: "lowest point: every 30 fps frame (t = i / 30); screenshots: t = 0, 1/3, 2/3 of each clip",
  skaters: {},
};
let errors = 0;
try {
  for (const skater of skaters) {
    const page = await browser.newPage({ viewport: { width: W * COLS, height: H }, deviceScaleFactor: 1 });
    const errs = [];
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`${base}/skater.html?skater=${skater}`);
    await page.waitForFunction(() => window.__skater && (window.__skater.ready || window.__skater.error), null, { timeout: 60000 });
    const loadError = await page.evaluate(() => window.__skater.error || null);
    if (loadError) {
      // The skater did not load: record the error and go to the next skater.
      report.skaters[skater] = { load_error: String(loadError), console_errors: errs };
      errors += 1 + errs.length;
      console.log(skater, "load error:", loadError);
      await page.close();
      continue;
    }
    report.skaters[skater] = { clips: {} };
    for (const clip of clips) {
      const row = {};
      for (const view of VIEWS) {
        const info = await page.evaluate(([c, v, n]) => window.__skater.sheet(c, n, v), [clip, view, COLS]);
        row.duration = info.duration;
        await page.screenshot({ path: join(out, label, `${skater}-${clip}-${view}.png`), clip: { x: 0, y: 0, width: W * 3, height: H } });
      }
      // The lowest point at every 30 fps frame of the clip.
      const times = Array.from({ length: Math.round(row.duration * 30) }, (_, i) => i / 30);
      const low = await page.evaluate(([c, t]) => window.__skater.lowest(c, t), [clip, times]);
      row.lowest_min_m = Number(Math.min(...low).toFixed(4));
      row.lowest_max_m = Number(Math.max(...low).toFixed(4));
      row.frames_below_minus_5mm = low.filter((y) => y < -0.005).length;
      row.frames_above_5mm = low.filter((y) => y > 0.005).length;
      row.frames = low.length;
      report.skaters[skater].clips[clip] = row;
      console.log(skater, clip, JSON.stringify(row));
    }
    report.skaters[skater].console_errors = errs;
    errors += errs.length;
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, `${label}.json`), JSON.stringify(report, null, 1) + "\n");
console.log("console errors:", errors);
process.exit(errors ? 1 : 0);
