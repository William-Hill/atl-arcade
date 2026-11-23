// The leaf card cost at fixed tree cameras (#191). The method of PR #224:
// headless Chromium with SwiftShader at 1280 x 720, pixel ratio 1, a fixed
// camera with no NPCs, no cars and no wind, and the frame time of each frame
// read rAF to rAF with a 1-pixel `readPixels`, so the software GPU completes
// each frame. A row is the median of `--frames` frames.
//
// Build each version first, for example:
//   npx vite build --outDir /tmp/dist-before   (on the old commit)
//   npx vite build --outDir /tmp/dist-after
// Usage:
//   node scripts/leaf-perf.mjs --dist before=/tmp/dist-before --dist after=/tmp/dist-after \
//     [--variant name="&leafcut=proc"] [--quality phone] [--cams spawn,street,park] \
//     [--repeat 2] [--frames 7] [--shots <dir>] [--out reports/leaf-perf/run.json]
// The runs alternate between the builds and the variants, so a change in the
// machine load hits each of them.

import { loadavg } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { preview } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const pairs = (name) =>
  args.flatMap((a, i) => {
    if (a !== `--${name}`) return [];
    const at = args[i + 1].indexOf("=");
    return [{ label: args[i + 1].slice(0, at), value: args[i + 1].slice(at + 1) }];
  });
const dists = pairs("dist").map((d) => ({ label: d.label, path: resolve(d.value) }));
if (dists.length === 0) dists.push({ label: "dist", path: resolve("dist") });
const variants = pairs("variant");
if (variants.length === 0) variants.push({ label: "default", value: "" });
const quality = arg("quality", "phone");
const look = arg("look", "pbr");
const repeat = Number(arg("repeat", "1"));
const frames = Number(arg("frames", "7"));
const basePort = Number(arg("port", "5780"));
const out = arg("out", null);
const shotDir = arg("shots", null);
const camPick = arg("cams", null);

// Cameras: x,y,z,lookX,lookY,lookZ. `spawn` is the PR #224 camera on the
// trail by the spawn; `street` (a North Avenue tree row) and `park` (the
// canopy of Historic Fourth Ward Park) are the tree cameras of prop-perf.mjs.
export const LEAF_CAMS = {
  spawn: "312,2,-175,334,3,-80",
  street: "-125,9.5,-706,20,16.5,-700",
  park: "-175,15,-385,-160,11,-260",
};

const servers = [];
for (const [i, d] of dists.entries()) {
  const server = await preview({ build: { outDir: d.path }, preview: { port: basePort + i, strictPort: true }, logLevel: "silent" });
  servers.push(server);
  d.base = `http://localhost:${basePort + i}`;
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const rows = [];
const errors = [];
const cams = Object.entries(LEAF_CAMS).filter(([name]) => !camPick || camPick.split(",").includes(name));
for (let r = 0; r < repeat; r += 1) {
  for (const [cam, value] of cams) {
    for (const d of dists) {
      for (const v of variants) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
        page.on("pageerror", (e) => errors.push(`${d.label}/${v.label} ${cam}: ${e}`));
        const url = `${d.base}/?level=beltline-eastside&quality=${quality}&look=${look}&mute=1&npcseed=1&skater=capsule&view=fixed&cam=${value}&npcs=0&peds=0&cars=0&wind=0&governor=0&time=14&weather=clear${v.value}`;
        await page.goto(url);
        await page.waitForFunction(() => window.__atl?.ready && (window.__atl.level.props?.loaded || !window.__atl.level.props) && window.__atl.frames > 4, null, { timeout: 600000 });
        await page.waitForTimeout(1000);
        const load = loadavg()[0];
        const ms = await page.evaluate(async (n) => {
          const gl = document.querySelector("canvas").getContext("webgl2");
          const px = new Uint8Array(4);
          const times = [];
          let last = null;
          // Two frames more than asked: the first gives the start time, the
          // second can hold a late shader compile.
          for (let i = 0; i < n + 2; i += 1) {
            await new Promise((done) => requestAnimationFrame(done));
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            const now = performance.now();
            if (last !== null && i > 1) times.push(now - last);
            last = now;
          }
          return times;
        }, frames);
        const sorted = [...ms].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        if (shotDir && r === 0) {
          mkdirSync(shotDir, { recursive: true });
          await page.screenshot({ path: resolve(shotDir, `${cam}-${quality}-${d.label}-${v.label}.png`) });
        }
        const row = { run: r + 1, build: d.label, variant: v.label, cam, quality, load: Math.round(load * 10) / 10, medianMs: Math.round(median), framesMs: ms.map(Math.round) };
        rows.push(row);
        console.log(JSON.stringify(row));
        await page.close();
      }
    }
  }
}
await browser.close();
for (const s of servers) await new Promise((done) => s.httpServer.close(done));

const table = {};
for (const row of rows) (table[`${row.build}/${row.variant}`] ??= {})[row.cam] = [...(table[`${row.build}/${row.variant}`]?.[row.cam] ?? []), row.medianMs];
console.table(Object.fromEntries(Object.entries(table).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([c, m]) => [c, m.join(" / ")]))])));
if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify({ date: new Date().toISOString(), renderer: "swiftshader", quality, look, frames, repeat, rows, errors }, null, 2));
}
if (errors.length) console.error(errors);
