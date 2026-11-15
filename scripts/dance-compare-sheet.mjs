// Contact sheets and short videos of the Meshy text-to-motion test (#293).
// It opens dance-compare.html in headless Chromium. Each column is one skater
// (Nia, Marcus) and one clip source (the hand keys of the game, Meshy). The
// sheets have one row per time in beats. The videos play 3 loops (6 beats)
// at the game tempo, at 30 frames per second. The page also measures the
// lowest point of the skinned mesh (the wheels) over the loop.
//
// Usage: npx vite --port 5193 & node scripts/dance-compare-sheet.mjs [base URL]
// Needs ffmpeg on the PATH for the videos.
// Output: docs/characters/reviews/293-meshy-dances/{contact-<dance>-<view>.png, <dance>.mp4,
// <dance>.gif, probe.json}.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:5193";
const OUT = "docs/characters/reviews/293-meshy-dances";
const DANCES = ["bankhead", "prep"];
const FPS = 30;
const LOOP_BEATS = 6;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

async function open(query) {
  await page.goto(`${base}/dance-compare.html?${query}`);
  await page.waitForFunction(() => window.__cmp && (window.__cmp.ready || window.__cmp.error), null, { timeout: 90000 });
  const err = await page.evaluate(() => window.__cmp.error);
  if (err) throw new Error(err);
}

const probe = {};
for (const dance of DANCES) {
  probe[dance] = {};
  for (const view of ["front", "side"]) {
    await open(`dance=${dance}&view=${view}`);
    const info = await page.evaluate(() => window.__cmp.sheet(240));
    await page.locator("#wrap").screenshot({ path: `${OUT}/contact-${dance}-${view}.png` });
    probe[dance][view] = info;
    if (view === "front") {
      probe[dance].cols = await page.evaluate(() => window.__cmp.cols);
      probe[dance].contact = await page.evaluate(() => window.__cmp.contact());
      probe[dance].motion = await page.evaluate(() => window.__cmp.motion());
      console.log(dance, JSON.stringify(probe[dance].contact));
    }
  }

  // The video: one screenshot per frame, then ffmpeg.
  await open(`dance=${dance}&view=front`);
  const dir = mkdtempSync(join(tmpdir(), `dance-${dance}-`));
  const bpm = await page.evaluate(() => window.__cmp.bpm);
  const frames = Math.round((LOOP_BEATS * 60 * FPS) / bpm);
  for (let f = 0; f < frames; f += 1) {
    const beats = (f / FPS) * (bpm / 60);
    await page.evaluate((b) => window.__cmp.frame(b, 200), beats);
    await page.locator("#wrap").screenshot({ path: join(dir, `f${String(f).padStart(4, "0")}.png`) });
  }
  const input = ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "f%04d.png")];
  execFileSync("ffmpeg", [...input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-movflags", "+faststart", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", `${OUT}/${dance}.mp4`]);
  execFileSync("ffmpeg", [...input, "-vf", "fps=15,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=bayer", `${OUT}/${dance}.gif`]);
  rmSync(dir, { recursive: true, force: true });
  probe[dance].video = { frames, fps: FPS, beats: LOOP_BEATS, bpm };
}
await browser.close();
writeFileSync(`${OUT}/probe.json`, `${JSON.stringify(probe, null, 2)}\n`);
if (errors.length) {
  console.error(errors);
  process.exit(1);
}
