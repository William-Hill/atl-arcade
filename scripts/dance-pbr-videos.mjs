// Videos of every dance on the PBR Nia (#293). The PBR Nia is the model of
// commit cd8310e (2026-11-07). It has its own rig: the same 65 joint names,
// but other joint positions and bone axes. Thus each clip is made again for
// that rig:
//   - "hand": the current hand keys (after #290 and #292), rekeyed with
//     scripts/blender/skater_reclip.py,
//   - "own": the older dance clip that is in the PBR GLB,
//   - a Meshy set: the Meshy source motion, retargeted with
//     scripts/blender/meshy_retarget.py.
// The model and the clips go to node_modules/.cache/pbr-nia/ (not in git).
// The page keeps the PBR materials (no toon shader).
//
// Usage: npx vite --port 5193 & node scripts/dance-pbr-videos.mjs [base URL]
// Needs Blender and ffmpeg on the PATH.
// Output: docs/characters/reviews/293-meshy-dances/pbr/<name>.mp4 and
// contact-<name>.png.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:5193";
const CACHE = "node_modules/.cache/pbr-nia";
const OUT = "docs/characters/reviews/293-meshy-dances/pbr";
const COMMIT = "cd8310e";
const HAND = ["bankhead", "prep", "swagsurf", "snaplean", "walkitout", "crisscross", "spin", "sitspin"];
const FPS = 30;
const BEATS = 8;
mkdirSync(join(CACHE, "meshy"), { recursive: true });
mkdirSync(OUT, { recursive: true });

// 1. The PBR model, the hand keys on its rig, and the Meshy clips on its rig.
const blender = (script, args) => execFileSync("blender", ["-b", "--factory-startup", "-P", script, "--", ...args], { stdio: ["ignore", "ignore", "inherit"] });
if (!existsSync(join(CACHE, "skater.glb"))) {
  writeFileSync(join(CACHE, "skater.glb"), execFileSync("git", ["show", `${COMMIT}:assets/skaters/nia/skater.glb`], { maxBuffer: 64 << 20 }));
}
if (!existsSync(join(CACHE, "hand-clips.glb"))) {
  blender("scripts/blender/skater_reclip.py", ["--in", join(CACHE, "skater.glb"), "--name", "nia", "--out", join(CACHE, "hand-clips.glb"), "--clips", HAND.map((d) => `dance_${d}`).join(",")]);
}
const SOURCES = { "meshy-293": "source-smplh.glb", "meshy-293-r2": "source-bvh.glb", "meshy-293-lib": "source-rig.glb" };
for (const [set, file] of Object.entries(SOURCES)) {
  for (const d of readdirSync(join("assets/dances", set))) {
    const out = join(CACHE, "meshy", set, `${d}.glb`);
    if (existsSync(out)) continue;
    mkdirSync(join(CACHE, "meshy", set), { recursive: true });
    blender("scripts/blender/meshy_retarget.py", ["--skater", join(CACHE, "skater.glb"), "--name", "nia", "--motion", join("assets/dances", set, d, file), "--clip", `dance_${d}_meshy`, "--out", out, "--report", out.replace(/\.glb$/, ".json")]);
  }
}

// 2. One video for each dance: the old and the current hand keys, and each Meshy clip.
const col = (set, d) => `nia:${set}:${d}`;
const VIDEOS = [
  { name: "bankhead", title: "Bankhead Bounce", cols: [col("own", "bankhead"), col("hand", "bankhead"), col("meshy-293", "bankhead"), col("meshy-293-r2", "bankhead")] },
  { name: "prep", title: "The Prep", cols: [col("own", "prep"), col("hand", "prep"), col("meshy-293", "prep"), col("meshy-293-r2", "prep")] },
  ...["swagsurf", "snaplean", "walkitout"].map((d) => ({ name: d, title: d, cols: [col("own", d), col("hand", d), col("meshy-293-r2", d)] })),
  ...["crisscross", "spin", "sitspin"].map((d) => ({ name: d, title: d, cols: [col("own", d), col("hand", d)] })),
  { name: "smoothquad", title: "Smooth Quad (only in the PBR GLB)", cols: [col("own", "smoothquad")] },
  { name: "naenae", title: "Nae Nae (Meshy only)", cols: [col("meshy-293-r2", "naenae")] },
  { name: "library", title: "Meshy library", cols: ["hiphop", "hiphop2", "bassbeats", "boom", "joyful", "cheer"].map((d) => col("meshy-293-lib", d)) },
];

const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 2000, height: 1200 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const contact = {};
for (const v of VIDEOS) {
  await page.goto(`${base}/dance-compare.html?model=pbr&title=${encodeURIComponent(v.title)}&cols=${v.cols.join(",")}`);
  await page.waitForFunction(() => window.__cmp && (window.__cmp.ready || window.__cmp.error), null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__cmp.error);
  if (err) throw new Error(`${v.name}: ${err}`);
  const cell = v.cols.length > 4 ? 280 : 360;
  await page.evaluate((c) => window.__cmp.sheet(c), cell);
  await page.locator("#wrap").screenshot({ path: join(OUT, `contact-${v.name}.png`) });
  contact[v.name] = await page.evaluate(() => window.__cmp.contact());
  const dir = mkdtempSync(join(CACHE, `frames-${v.name}-`));
  const frames = Math.round((BEATS * 60 * FPS) / 100);
  for (let f = 0; f < frames; f += 1) {
    await page.evaluate(([b, c]) => window.__cmp.frame(b, c), [(f / FPS) * (100 / 60), cell]);
    await page.locator("#wrap").screenshot({ path: join(dir, `f${String(f).padStart(4, "0")}.png`) });
  }
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "f%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24", "-movflags", "+faststart", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", join(OUT, `${v.name}.mp4`)]);
  rmSync(dir, { recursive: true, force: true });
  console.log(v.name, JSON.stringify(contact[v.name]));
}
await browser.close();
writeFileSync(join(OUT, "contact.json"), `${JSON.stringify(contact, null, 2)}\n`);
if (errors.length) {
  console.error(errors);
  process.exit(1);
}
