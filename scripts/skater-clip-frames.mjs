// Renders skater clips frame by frame (30 fps) from skater.html in headless
// Chromium, for before and after videos. Each frame is a PNG; ffmpeg makes
// the video (see docs/characters/physics-pass/README.md).
//
// Start the dev server first (npm run dev -- --port 5180), then:
//   node scripts/skater-clip-frames.mjs --out <dir> [--skaters nia,marcus]
//     [--clips push,coast,carve_left,carve_right] [--views three-quarter,left]
// It writes <dir>/<skater>/<view>/<clip>-<frame>.png and <dir>/frames.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const out = arg("out", "frames");
const base = arg("base", "http://localhost:5180");
const skaters = arg("skaters", "nia,marcus").split(",");
const clips = arg("clips", "push,coast,carve_left,carve_right").split(",");
const views = arg("views", "three-quarter,left").split(",");
const W = Number(arg("width", 480));
const H = Number(arg("height", 480));

const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
const index = {};
let errors = 0;
for (const skater of skaters) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("console", (m) => m.type() === "error" && (errors += 1, console.error(m.text())));
  page.on("pageerror", (e) => (errors += 1, console.error(String(e))));
  await page.goto(`${base}/skater.html?skater=${skater}`);
  await page.waitForFunction(() => window.__skater && (window.__skater.ready || window.__skater.error), null, { timeout: 60000 });
  index[skater] = {};
  for (const view of views) {
    const dir = join(out, skater, view);
    mkdirSync(dir, { recursive: true });
    for (const clip of clips) {
      const info = await page.evaluate(([c, v]) => window.__skater.sheet(c, 1, v, [0]), [clip, view]);
      const n = Math.round(info.duration * 30);
      index[skater][clip] = n;
      for (let f = 0; f < n; f += 1) {
        await page.evaluate(([c, v, t]) => window.__skater.sheet(c, 1, v, [t]), [clip, view, f / 30]);
        await page.screenshot({ path: join(dir, `${clip}-${String(f).padStart(4, "0")}.png`) });
      }
      console.log(skater, view, clip, n, "frames");
    }
  }
  await page.close();
}
await browser.close();
writeFileSync(join(out, "frames.json"), JSON.stringify(index) + "\n");
console.log("console errors:", errors);
process.exit(errors ? 1 : 0);
