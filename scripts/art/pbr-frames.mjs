// Frames of the pbr look in the real game renderer, for the art direction
// (docs/art-direction-pbr.md) and the style frames (#114). Each shot is a
// fixed camera plus URL params and an optional runtime tune (tuneLook, the
// grade and bloom uniforms) applied every frame from the page, so no game
// source changes. Serial, one page per shot (SwiftShader is slow).
//   node scripts/art/pbr-frames.mjs --shots scripts/art/shots-today.json --out ~/evidence/art/raw [name ...]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
}
const shotsFile = opt("--shots", "scripts/art/shots-today.json");
const out = opt("--out", "frames");
const port = Number(opt("--port", "5196"));
mkdirSync(out, { recursive: true });
const all = JSON.parse(readFileSync(shotsFile, "utf8")).shots;
const want = args.length ? all.filter((s) => args.includes(s.name)) : all;

const BASE = {
  level: "beltline-eastside",
  quality: "high",
  look: "pbr",
  date: "06-21",
  time: "13.5",
  weather: "clear",
  governor: "0",
  view: "fixed",
  mute: "1",
  npcs: "0",
  cars: "0",
};

const server = await createServer({ server: { port, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const log = [];
try {
  for (const shot of want) {
    const q = new URLSearchParams({ ...BASE, ...(shot.params ?? {}), cam: shot.cam.join(",") });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.setDefaultTimeout(300000);
    page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
    const t0 = Date.now();
    await page.goto(`http://localhost:${port}/?${q}`, { waitUntil: "commit" });
    await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 8, null, { timeout: 300000 });
    if (shot.tune) {
      await page.evaluate((t) => {
        const apply = () => {
          const a = window.__atl;
          if (t.look) a.tuneLook(t.look);
          const g = a.post?.grade?.uniforms;
          if (g && t.grade) for (const [k, v] of Object.entries(t.grade)) g[k].value = v;
          if (a.post?.bloom && t.bloom) Object.assign(a.post.bloom, t.bloom);
          if (t.fog && a.scene.fog) {
            if (t.fog.color) a.scene.fog.color.set(t.fog.color);
            if (t.fog.near !== undefined) a.scene.fog.near = t.fog.near;
            if (t.fog.far !== undefined) a.scene.fog.far = t.fog.far;
            if (t.fog.density !== undefined) a.scene.fog.density = t.fog.density;
          }
          requestAnimationFrame(apply);
        };
        apply();
      }, shot.tune);
    }
    await page.waitForTimeout(5000);
    const f = await page.evaluate(() => window.__atl.frames);
    await page.waitForFunction((f0) => window.__atl.frames > f0 + 6, f, { timeout: 300000 });
    // Frames show the world only: hide the HUD, the hints and the minimap.
    await page.addStyleTag({ content: "* { visibility: hidden !important; } #stage { visibility: visible !important; }" });
    await page.waitForTimeout(500);
    const file = `${out}/${shot.name}.png`;
    await page.screenshot({ path: file, timeout: 300000 });
    const info = await page.evaluate(() => ({ renderer: window.__atl.rendererInfo, look: window.__atl.tuneLook(), grade: Object.fromEntries(Object.entries(window.__atl.post?.grade?.uniforms ?? {}).filter(([k]) => k !== "tDiffuse").map(([k, u]) => [k, u.value])), bloom: window.__atl.post?.bloom?.strength ?? null, weather: window.__atl.weather ? { kind: window.__atl.weather.kind, elevation: window.__atl.weather.elevation } : null }));
    const entry = { name: shot.name, commit, url: `/?${q}`, tune: shot.tune ?? null, ...info, seconds: Math.round((Date.now() - t0) / 1000) };
    log.push(entry);
    console.log(file, JSON.stringify(entry));
    await page.close();
  }
} finally {
  writeFileSync(`${out}/shots-log-${Date.now()}.json`, JSON.stringify(log, null, 2) + "\n");
  await browser.close();
  await server.close();
}
