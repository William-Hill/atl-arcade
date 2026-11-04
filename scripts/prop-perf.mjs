// Prop render cost check (#89). It serves one or more built dist folders
// with `vite preview`, opens the BeltLine level in headless Chromium
// (SwiftShader, the playtest harness) at fixed cameras, and records:
// - the draw calls and the triangles of one frame (`__atl.rendererInfo`),
// - the frame times over a sample window (`__atl.fps`): median FPS and the
//   90th percentile frame time,
// - the load average of the machine at the start of each run.
//
// Build each version first, for example:
//   npx vite build --outDir /tmp/dist-before   (on the old commit)
//   npx vite build --outDir /tmp/dist-after
// Usage:
//   node scripts/prop-perf.mjs --dist before=/tmp/dist-before --dist after=/tmp/dist-after \
//     [--repeat 3] [--seconds 6] [--quality low] [--gpu] [--cams spawn,overview] [--extra "&props=0"]
//     [--shots <dir>] [--port 5760] [--out reports/prop-perf/run.json]
// The runs alternate between the builds (before, after, before, after, ...),
// so a change in the machine load hits both builds.

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
const dists = [];
args.forEach((a, i) => {
  if (a === "--dist") {
    const [label, path] = args[i + 1].split("=");
    dists.push({ label, path: resolve(path) });
  }
});
if (dists.length === 0) dists.push({ label: "dist", path: resolve("dist") });
const repeat = Number(arg("repeat", "3"));
const seconds = Number(arg("seconds", "6"));
const quality = arg("quality", "low");
const basePort = Number(arg("port", "5760"));
const out = arg("out", null);
const shotDir = arg("shots", null);
// --extra appends URL parameters, for example "&props=0" to take the props out.
const extra = arg("extra", "");
// --cams picks cameras by name, comma separated.
const camPick = arg("cams", null);

// Cameras: x,y,z,lookX,lookY,lookZ. The spawn view looks down the trail.
const CAMS = {
  spawn: null,
  "trail-north": "-37.5,6,-907.5,-61,5,-1000",
  storefront: "-296.7,4,-769,-317.9,4.5,-780.7",
  overview: "126.4,30,-271.7,124.6,5.3,-120",
};

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function stats(frameMs) {
  // The first frames after a camera move can include a shader compile.
  const ms = frameMs.slice(5).filter((v) => v > 0);
  const sorted = [...ms].sort((a, b) => a - b);
  const med = percentile(sorted, 0.5);
  return { frames: ms.length, medianFps: med ? Math.round((1000 / med) * 10) / 10 : null, p90Ms: Math.round(percentile(sorted, 0.9) * 10) / 10, p99Ms: Math.round(percentile(sorted, 0.99) * 10) / 10 };
}

const servers = [];
for (const [i, d] of dists.entries()) {
  const server = await preview({ build: { outDir: d.path }, preview: { port: basePort + i, strictPort: true }, logLevel: "silent" });
  servers.push(server);
  d.base = `http://localhost:${basePort + i}`;
}

// --gpu uses the machine GPU (ANGLE Metal on a Mac), as load-check.mjs does.
const gpu = args.includes("--gpu");
const launchArgs = ["--no-sandbox", "--disable-dev-shm-usage", ...(gpu ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"])];
const browser = await chromium.launch({ headless: true, args: launchArgs });
const rows = [];
const errors = [];
for (let r = 0; r < repeat; r += 1) {
  for (const d of dists) {
    for (const [cam, value] of Object.entries(CAMS).filter(([name]) => !camPick || camPick.split(",").includes(name))) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.on("pageerror", (e) => errors.push(`${d.label} ${cam}: ${e}`));
      const view = value ? `&view=fixed&cam=${value}` : "";
      await page.goto(`${d.base}/?level=beltline-eastside&quality=${quality}&mute=1&npcseed=1${view}${extra}`);
      await page.waitForFunction(() => window.__atl?.ready && (window.__atl.level.props?.loaded || !window.__atl.level.props || new URL(location.href).searchParams.get("props") === "0") && window.__atl.frames > 30, null, { timeout: 180000 });
      await page.waitForTimeout(1500);
      const load = loadavg()[0];
      const info = await page.evaluate(() => ({ r: window.__atl.rendererInfo, props: window.__atl.level.props }));
      await page.evaluate(() => window.__atl.fps.start());
      await page.waitForTimeout(seconds * 1000);
      const frameMs = await page.evaluate(() => window.__atl.fps.stop());
      if (shotDir && r === 0) {
        mkdirSync(shotDir, { recursive: true });
        await page.screenshot({ path: resolve(shotDir, `${cam}-${quality}${gpu ? "-gpu" : ""}-${d.label}.png`) });
      }
      const row = { run: r + 1, build: d.label, cam, quality, gpu: gpu ? "machine" : "swiftshader", load: Math.round(load * 10) / 10, calls: info.r.calls, triangles: info.r.triangles, propCount: info.props.count, ...stats(frameMs) };
      rows.push(row);
      console.log(JSON.stringify(row));
      await page.close();
    }
  }
}
await browser.close();
for (const s of servers) await new Promise((done) => s.httpServer.close(done));

// The summary per build and camera: draw calls and triangles are exact; the
// FPS figures are the median of the runs.
const summary = {};
for (const row of rows) {
  const key = `${row.build}|${row.cam}`;
  (summary[key] ??= { build: row.build, cam: row.cam, calls: new Set(), triangles: new Set(), medianFps: [], p90Ms: [], load: [] });
  const s = summary[key];
  s.calls.add(row.calls);
  s.triangles.add(row.triangles);
  s.medianFps.push(row.medianFps);
  s.p90Ms.push(row.p90Ms);
  s.load.push(row.load);
}
const mid = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const table = Object.values(summary).map((s) => ({ build: s.build, cam: s.cam, calls: [...s.calls].join("/"), triangles: [...s.triangles].join("/"), medianFps: mid(s.medianFps), p90Ms: mid(s.p90Ms), runsP90Ms: s.p90Ms, load: s.load }));
console.table(table.map((t) => ({ ...t, runsP90Ms: t.runsP90Ms.join(" "), load: t.load.join(" ") })));
const result = { date: new Date().toISOString(), gpu: gpu ? "machine" : "swiftshader", quality, seconds, repeat, rows, table, errors };
if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify(result, null, 2));
}
if (errors.length) console.error(errors);
