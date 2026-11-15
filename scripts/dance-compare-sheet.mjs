// Contact sheets and short videos of the Meshy text-to-motion test (#293).
// It opens dance-compare.html in headless Chromium. Each column is one skater
// and one clip source (the hand keys of the game, or a Meshy clip). The
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
// Each sheet: a name, the page query, and the views. The first 2 sheets are
// the first test (prime, Nia and Marcus). "r2" is the second round of prompts
// (swift, Nia). "lib" is 6 dances of the Meshy animation library (Nia).
const r2 = (d, hand = true) => [...(hand ? [`nia:hand:${d}`] : []), `nia:meshy-293-r2:${d}`].join(",");
const SHEETS = [
  { name: "bankhead", query: "dance=bankhead", views: ["front", "side"] },
  { name: "prep", query: "dance=prep", views: ["front", "side"] },
  { name: "r2-bankhead-prep", query: `title=r2&cols=nia:hand:bankhead,nia:meshy-293:bankhead,nia:meshy-293-r2:bankhead,nia:hand:prep,nia:meshy-293:prep,nia:meshy-293-r2:prep`, views: ["front"] },
  { name: "r2-more", query: `title=r2&cols=${[r2("swagsurf"), r2("snaplean"), r2("walkitout"), r2("naenae", false)].join(",")}`, views: ["front"] },
  { name: "lib", query: `title=library&cols=${["hiphop", "hiphop2", "bassbeats", "boom", "joyful", "cheer"].map((d) => `nia:meshy-293-lib:${d}`).join(",")}`, views: ["front"] },
];
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
for (const { name: dance, query, views } of SHEETS) {
  probe[dance] = {};
  for (const view of views) {
    await open(`${query}&view=${view}`);
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
  await open(`${query}&view=front`);
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
