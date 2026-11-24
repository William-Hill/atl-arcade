// Makes the card art of the landmark story cards (#220) again: one in-game
// render of each landmark from the fixed camera of src/landmarks/card-art.js,
// in the day pbr look. It writes public/landmark-cards/<id>.jpg and
// public/landmark-cards/provenance.json (the commit, the cameras, the date).
//
// The dev server must run (npm run dev). One page load renders all the
// spots: the camera moves from one landmark to the next.
//
//   node scripts/card-art.mjs [--url http://localhost:5173] [--level beltline-eastside] [--only id,id] [--wait 2500]

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { CARD_ART, cardCamera } from "../src/landmarks/card-art.js";

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const base = arg("url", "http://localhost:5173").replace(/\/$/, "");
const levelName = arg("level", "beltline-eastside");
const only = arg("only", "") ? arg("only").split(",") : null;
const wait = Number(arg("wait", "2500"));

const root = resolve(import.meta.dirname, "..");
const data = JSON.parse(readFileSync(resolve(root, "levels", levelName, "landmarks.json"), "utf8"));
const outDir = resolve(root, "public", CARD_ART.dir);
mkdirSync(outDir, { recursive: true });
const spots = data.spots.filter((s) => !only || only.includes(s.id));

// The provenance of all the renders has one commit and one query. A run
// with --only keeps the other renders, so it must run at the same commit,
// with the same query and no local changes; else make all the renders again.
const query = `level=${levelName}&mute=1&intro=0&view=fixed&skater=capsule&${CARD_ART.query}`;
const provPath = resolve(outDir, "provenance.json");
const old = existsSync(provPath) ? JSON.parse(readFileSync(provPath, "utf8")) : {};
const commit = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
// The renders themselves do not count as a local change.
const dirty = execSync(`git status --porcelain -- . ":(exclude)public/${CARD_ART.dir}"`, { cwd: root }).toString().trim() !== "";
const commitText = dirty ? `${commit} (with local changes)` : commit;
if (only && (old.commit !== commitText || old.query !== query || old.level !== levelName)) {
  console.error(`--only needs the commit, the query and the level of the last full run (${old.commit ?? "none"}). Run without --only.`);
  process.exit(2);
}

const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: CARD_ART.width, height: CARD_ART.height } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// No intro, a capsule skater at the spawn, no sound, the fixed camera.
await page.goto(`${base}/?${query}`);
await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 8, null, { timeout: 300000 });
// Every landmark model is placed, and every late load that started is
// done or failed. A fixed wait alone could capture a landmark before its
// GLB is in.
await page.waitForFunction(
  () => {
    const a = window.__atl;
    const lm = a.level.landmarks;
    const late = a.lateLoads;
    const lateDone = !late || Object.keys(late.started).every((g) => g in late.done || g in late.failed);
    return (!lm || lm.loaded) && lateDone;
  },
  null,
  { timeout: 300000 },
);
await page.evaluate(() => {
  window.__cardArt = true;
});
// Only the 3D view: no HUD, no maps, no buttons.
await page.addStyleTag({ content: "body > *:not(canvas) { visibility: hidden !important; }" });

const cameras = {};
for (const spot of spots) {
  const cam = cardCamera(spot);
  await page.evaluate(({ from, at }) => {
    const h = window.__atl.level.terrainHeight;
    window.__atl.setFixedCamera(from[0], from[1] + h(from[0], from[2]), from[2], at[0], at[1] + h(at[0], at[2]), at[2]);
  }, cam);
  // The tiles near the camera and the late loads come in.
  const frames = await page.evaluate(() => window.__atl.frames);
  await page.waitForFunction((f) => window.__atl && window.__atl.frames > f + 6, frames, { timeout: 120000 });
  await page.waitForTimeout(wait);
  // A reload of the page (a dev server reload) puts the camera back: stop.
  if (!(await page.evaluate(() => window.__cardArt === true))) throw new Error("the page loaded again during the renders: run the script again");
  const path = resolve(outDir, `${spot.id}.${CARD_ART.ext}`);
  await page.screenshot({ path, type: "jpeg", quality: CARD_ART.quality });
  cameras[spot.id] = cam;
  console.log(spot.id, JSON.stringify(cam));
}
await browser.close();

const prov = {
  tool: "Skate ATL in-game render (Three.js, headless Chromium), scripts/card-art.mjs",
  prompt: null,
  credits: "Original in-game renders of the Skate ATL level. Map data © OpenStreetMap contributors (ODbL).",
  license: "Project art",
  // The date of the last full run; `dates` has the date of each render.
  date: only ? old.date : new Date().toISOString().slice(0, 10),
  dates: { ...(old.dates ?? {}), ...Object.fromEntries(Object.keys(cameras).map((id) => [id, new Date().toISOString().slice(0, 10)])) },
  commit: commitText,
  level: levelName,
  query,
  size: [CARD_ART.width, CARD_ART.height],
  note: "Each camera is { from: [x, h, z], at: [x, h, z] }, h in m over the terrain. Rebuild: npm run dev, then node scripts/card-art.mjs --url http://localhost:5173",
  cameras: { ...(old.cameras ?? {}), ...cameras },
};
writeFileSync(provPath, `${JSON.stringify(prov, null, 2)}\n`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
