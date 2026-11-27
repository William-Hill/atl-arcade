// MetaHuman spike measurement (docs/research/2026-11-27-metahuman-nia-spike.md).
// Serves a built game, swaps the Nia GLB for a candidate GLB at the network
// layer (the shipped files stay as they are), and measures in headless
// Chromium:
// - skater.html: the frame time with the model in its bind pose, the model
//   info, and screenshots (front, three-quarter, face, clip contact sheets);
// - the BeltLine Eastside on one tier: the same 15 s trail ride as
//   scripts/perf.mjs, the frame time, renderer.info, and a screenshot.
//
// Usage (run from the root of a checkout that has the realistic Nia):
//   node <this file> --dist dist --label baseline --out reports/mh/baseline.json --shots reports/mh/shots
//   node <this file> --dist dist --glb nia-mh-high.glb --label mh-high ...
// Options: --tier high, --look pbr, --seconds 15, --gpu (ANGLE Metal), --port 5791,
// --match assets/skaters/nia/skater.glb (the file to swap, found in dist by size).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { preview } from "vite";
import { chromium } from "@playwright/test";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const dist = resolve(arg("dist", "dist"));
const glb = arg("glb", null);
const label = arg("label", glb ? "candidate" : "baseline");
const tier = arg("tier", "high");
const look = arg("look", "pbr");
const seconds = Number(arg("seconds", "15"));
const port = Number(arg("port", "5791"));
const out = resolve(arg("out", `reports/mh/${label}.json`));
const shots = resolve(arg("shots", "reports/mh/shots"));
const gpu = args.includes("--gpu");
const skipGame = args.includes("--no-game");
const match = resolve(arg("match", "assets/skaters/nia/skater.glb"));
const LEVEL = "beltline-eastside";

const { chainStrips, followLineScript } = await import(pathToFileURL(resolve(ROOT, "src/playtest/trail-script.js")));
const { createLevelEnv } = await import(pathToFileURL(resolve(ROOT, "src/level/ground.js")));
// The same statistics as scripts/perf-lib.mjs (not on every branch).
function frameStats(frameMs) {
  const ms = frameMs.slice(5).filter((v) => v > 0);
  const sorted = [...ms].sort((a, b) => a - b);
  const at = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const mean = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null;
  return { frames: ms.length, meanMs: r1(mean), p95Ms: r1(at(0.95)), medianFps: at(0.5) ? r1(1000 / at(0.5)) : null, meanFps: mean ? r1(1000 / mean) : null };
}

// The built Nia GLB is the asset with the same size as the source file.
const size = statSync(match).size;
const swapName = readdirSync(resolve(dist, "assets")).find((f) => f.endsWith(".glb") && statSync(resolve(dist, "assets", f)).size === size);
if (!swapName) throw new Error(`no GLB of ${size} bytes in ${dist}/assets`);
const body = glb ? readFileSync(resolve(glb)) : null;

const levelJson = JSON.parse(readFileSync(resolve(ROOT, "levels", LEVEL, "level.json"), "utf8"));
const [trail] = chainStrips(levelJson.strips, "trail");
const ride = followLineScript(trail, levelJson.spawn, createLevelEnv(levelJson), { frames: Math.round(seconds * 60) }).script;

const server = await preview({ build: { outDir: dist }, preview: { host: "127.0.0.1", port, strictPort: true }, logLevel: "error" });
const base = `http://127.0.0.1:${port}`;
const launchArgs = ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required", ...(gpu ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", ...(args.includes("--uncapped") ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : [])] : ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"])];
const browser = await chromium.launch({ headless: true, args: launchArgs });
mkdirSync(shots, { recursive: true });
const result = { date: new Date().toISOString(), label, glb, glbBytes: body ? body.length : size, swapped: swapName, gpu: gpu ? `machine (ANGLE Metal)${args.includes("--uncapped") ? ", vsync off" : ""}` : "swiftshader (software)", tier, look };

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  if (body) await page.route(`**/assets/${swapName}`, (route) => route.fulfill({ status: 200, contentType: "model/gltf-binary", body }));
  return { ctx, page, errors };
}

// Frame times from requestAnimationFrame over `ms`.
const sampleFrames = (page, ms) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        const times = [];
        let last = performance.now();
        const end = last + ms;
        const tick = (t) => {
          times.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else done(times);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

try {
  // The skater viewer.
  {
    const { ctx, page, errors } = await newPage();
    await page.goto(`${base}/skater.html?skater=nia`);
    await page.waitForFunction(() => window.__skater?.ready || window.__skater?.error, null, { timeout: 180000 });
    const info = await page.evaluate(() => ({ info: window.__skater.info, error: window.__skater.error, clips: window.__skater.clips }));
    await page.waitForTimeout(1500);
    const frameMs = await sampleFrames(page, 5000);
    result.viewer = { ...info, frame: frameStats(frameMs), errors };
    for (const view of ["front", "three-quarter", "face"]) {
      await page.evaluate((v) => window.__skater.setView(v), view);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${shots}/${label}-viewer-${view}.png` });
    }
    for (const clip of ["coast", "push", "grind_soul", "air_japan"]) {
      if (!info.clips?.includes(clip)) continue;
      await page.evaluate((c) => window.__skater.sheet(c), clip);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${shots}/${label}-sheet-${clip}.png` });
    }
    await ctx.close();
    console.log(`${label} viewer: mean ${result.viewer.frame.meanMs} ms, p95 ${result.viewer.frame.p95Ms} ms, ${JSON.stringify(info.info)}`);
  }

  // The BeltLine ride.
  if (!skipGame) {
    const { ctx, page, errors } = await newPage();
    await page.goto(`${base}/?level=${LEVEL}&quality=${tier}&look=${look}&perf=1&mute=1&npcseed=1&governor=0&run=free`);
    await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 0, null, { timeout: 300000, polling: 100 });
    await page.waitForFunction(() => (window.__atl.skaterModel?.loaded || window.__atl.skaterModel?.error) && window.__atl.frames > 30, null, { timeout: 300000, polling: 250 });
    await page.waitForTimeout(2000);
    const data = await page.evaluate(
      async ({ script, start, timeoutMs }) => {
        const a = window.__atl;
        a.perf?.reset?.();
        a.fps.start();
        const t0 = performance.now();
        const done = a.runScript(script, start);
        const end = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), timeoutMs))]);
        return { finished: Boolean(end), wallMs: performance.now() - t0, frameMs: a.fps.stop(), info: a.rendererInfo ?? null, systems: a.perf?.report?.().systems ?? null, skaterModel: { name: a.skaterModel?.name, loaded: a.skaterModel?.loaded, error: a.skaterModel?.error } };
      },
      { script: ride, start: { position: levelJson.spawn.position, yaw: levelJson.spawn.yaw }, timeoutMs: 900000 },
    );
    await page.screenshot({ path: `${shots}/${label}-beltline-${tier}.png` });
    result.game = { finished: data.finished, wallSeconds: Math.round(data.wallMs / 100) / 10, frame: frameStats(data.frameMs), calls: data.info?.calls, triangles: data.info?.triangles, render: data.systems?.render, skaterModel: data.skaterModel, errors };
    await ctx.close();
    console.log(`${label} beltline ${tier}/${look}: mean ${result.game.frame.meanMs} ms, p95 ${result.game.frame.p95Ms} ms, ${result.game.calls} calls, ${result.game.triangles} tris, finished ${data.finished}`);
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
  mkdirSync(resolve(out, ".."), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
if (!existsSync(out)) process.exit(1);
