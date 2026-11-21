// Key art for issue #300: a skater on the BeltLine Eastside Trail, in the city look of the game.
//
// Step 1 (capture): render the real game (?look=pbr) with a fixed camera on the skater, hide
// every DOM overlay (HUD, notices), and save the canvas. Same method as
// scripts/art/pbr-frames.mjs (Vite dev server + Playwright Chromium, SwiftShader).
// Step 2 (compose): put the chosen logo (option B, assets/brand/logo/) and a soft grade over the
// frame in a page, and save the 1920 x 1080 key art. No image model.
//
//   node scripts/brand/key-art.mjs --shot <name> [--out assets/brand/key-art] [--raw <png>]
//   (--raw skips step 1 and composes an earlier capture)
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = path.resolve(opt("--out", "assets/brand/key-art"));
const shotName = opt("--shot", "trail-roll");
const W = Number(opt("--width", "1920"));
const H = Number(opt("--height", "1080"));
mkdirSync(out, { recursive: true });

// cam = eye x, eye height over the ground, eye z, target x, target height, target z (src/main.js).
const SHOTS = JSON.parse(readFileSync(new URL("./key-art-shots.json", import.meta.url), "utf8")).shots;
const shot = SHOTS.find((s) => s.name === shotName);
if (!shot) throw new Error(`No shot ${shotName}`);

const BASE = {
  level: "beltline-eastside",
  quality: "high",
  look: "pbr",
  date: "06-21",
  time: "9.5",
  weather: "clear",
  governor: "0",
  view: "fixed",
  mute: "1",
  npcs: "0",
  cars: "0",
};

const port = Number(opt("--port", "5197"));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let rawPath = opt("--raw", null);
let info = null;
if (!rawPath) {
  const server = await createServer({ server: { port, strictPort: true }, logLevel: "error" });
  await server.listen();
  try {
    const q = new URLSearchParams({ ...BASE, ...(shot.params ?? {}), cam: shot.cam.join(",") });
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    page.setDefaultTimeout(1200000);
    page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
    const t0 = Date.now();
    await page.goto(`http://localhost:${port}/?${q}`, { waitUntil: "commit" });
    await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 8, null, { timeout: 1200000 });
    if (shot.tune) {
      await page.evaluate((t) => {
        const a = window.__atl;
        if (t.look) a.tuneLook(t.look);
        const g = a.post?.grade?.uniforms;
        if (g && t.grade) for (const [k, v] of Object.entries(t.grade)) g[k].value = v;
      }, shot.tune);
    }
    // Let the late downloads (trees, props) arrive, then a few more frames.
    await page.waitForTimeout(Number(shot.settleMs ?? 20000));
    await page.addStyleTag({ content: "body > *:not(#stage) { visibility: hidden !important; }" });
    // Optional: hold a key so the skater rolls (the push pose), then freeze the game and let go.
    if (shot.hold) {
      await page.keyboard.down(shot.hold.key);
      const f = await page.evaluate(() => window.__atl.frames);
      await page.waitForFunction(([f0, n]) => window.__atl.frames > f0 + n, [f, shot.hold.frames]);
      // Freeze: the settings menu stops the simulation and the clips, and the frame still
      // draws (src/main.js, "Photo mode and the full map stop the game"). The menu DOM is hidden.
      if (shot.hold.freeze) await page.evaluate(() => window.__atl.settings.open());
      await page.keyboard.up(shot.hold.key);
    }
    // The skater's place and facing: heading(yaw) = (cos yaw, -sin yaw) in x, z
    // (src/sim/skate/controller.js). Read again before each view: a rolling skater moves.
    const where = async () => {
      const r = await page.evaluate(() => ({ p: [...window.__atl.skater.position], yaw: window.__atl.skater.yaw, speed: window.__atl.skater.speed ?? null }));
      if (typeof r.yaw !== "number") throw new Error("window.__atl.skater.yaw is not a number");
      return r;
    };
    info = { views: [] };
    for (const v of shot.views) {
      const sk = await where();
      const fwd = [Math.cos(sk.yaw), -Math.sin(sk.yaw)];
      const right = [Math.sin(sk.yaw), Math.cos(sk.yaw)];
      // angle 0: the camera is in front of the skater and looks back at the skater.
      const a = (v.angle * Math.PI) / 180;
      const dir = [fwd[0] * Math.cos(a) + right[0] * Math.sin(a), fwd[1] * Math.cos(a) + right[1] * Math.sin(a)];
      const eye = [sk.p[0] + dir[0] * v.dist, sk.p[1] + v.height, sk.p[2] + dir[1] * v.dist];
      // shift > 0 moves the look point to the camera's left, so the skater sits right of center.
      const camRight = [dir[1], -dir[0]];
      const look = [sk.p[0] - camRight[0] * (v.shift ?? 0), sk.p[1] + v.lookHeight, sk.p[2] - camRight[1] * (v.shift ?? 0)];
      await page.evaluate(([e, l]) => window.__atl.setFixedCamera(e[0], e[1], e[2], l[0], l[1], l[2]), [eye, look]);
      const f0 = await page.evaluate(() => window.__atl.frames);
      await page.waitForFunction((f) => window.__atl.frames > f + 4, f0);
      const file = path.join(out, `${shot.name}-${v.name}-raw.png`);
      await page.locator("#stage").screenshot({ path: file });
      info.views.push({ ...v, skater: sk, eye, look, raw: path.basename(file) });
      console.log("view", v.name, Math.round((Date.now() - t0) / 1000), "s");
    }
    Object.assign(info, await page.evaluate(() => ({ render: window.__atl.render, weather: window.__atl.weather })));
    info.url = `/?${q}`;
    info.seconds = Math.round((Date.now() - t0) / 1000);
    await page.close();
  } finally {
    await server.close();
  }
}

// Step 2: compose every view (or the --raw file). The view named in shot.final becomes the key art.
const logo = readFileSync(path.resolve("assets/brand/logo/skate-atl-logo.svg"));
const raws = rawPath ? [{ name: "raw", file: rawPath }] : info.views.map((v) => ({ name: v.name, file: path.join(out, v.raw) }));
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const results = [];
for (const r of raws) {
  const raw = readFileSync(r.file);
  const html = `<!doctype html><html><head><style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#1b1f3b}
  .bg{position:absolute;inset:0;background:url(data:image/png;base64,${raw.toString("base64")}) center/cover}
  .grade{position:absolute;inset:0;background:
    linear-gradient(180deg, rgba(27,31,59,0.45) 0%, rgba(27,31,59,0) 32%),
    linear-gradient(0deg, rgba(27,31,59,0.30) 0%, rgba(27,31,59,0) 20%)}
  .logo{position:absolute;left:${Math.round(W * 0.04)}px;top:${Math.round(H * 0.05)}px;width:${Math.round(W * 0.34)}px;
    filter:drop-shadow(0 8px 16px rgba(0,0,0,0.35))}
</style></head><body><div class="bg"></div><div class="grade"></div>
<img class="logo" src="data:image/svg+xml;base64,${logo.toString("base64")}"></body></html>`;
  await page.setContent(html);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  // --final names the output of a --raw compose. A full capture uses shot.final only.
  const isFinal = rawPath ? args.includes("--final") : r.name === shot.final;
  const file = path.join(out, isFinal ? `skate-atl-key-art-${W}x${H}.png` : `${shot.name}-${r.name}-keyart.png`);
  await page.screenshot({ path: file });
  results.push(file);
}
await browser.close();
if (info) writeFileSync(path.join(out, `${shot.name}-capture.json`), JSON.stringify({ shot, ...info }, null, 2) + "\n");
console.log(JSON.stringify({ results, seconds: info?.seconds }));
