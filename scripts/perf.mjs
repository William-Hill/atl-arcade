// Performance baseline (npm run perf). It builds the game (or serves a given
// build), opens the BeltLine Eastside in headless Chromium for each quality
// tier (low, phone, high) and each look (pbr, toon), rides the same trail
// path in every run, and records:
// - the frame time over the ride (mean, p95, median FPS),
// - renderer.info: draw calls, triangles, geometries, textures,
// - the JS heap (CDP Runtime.getHeapUsage),
// - the time to the first game frame (the atl:first-frame mark),
// - the bytes on the wire by type (JS, GLB, textures, WASM, data, other),
// - the cost of each system per frame (?perf=1, src/perf/frame-cost.js).
//
// Headless Chromium draws with SwiftShader, a software GPU on the CPU. The
// GPU numbers (frame time, render cost) are relative only: compare two runs
// on the same machine, not with a phone.
//
// Usage:
//   npm run perf
//   npm run perf -- --dist dist --repeat 2 --seconds 15 --tiers low,phone --looks toon
//   npm run perf -- --out docs/perf/baseline.json --md docs/perf/baseline.md
//   npm run perf -- --budget docs/perf/budget.json   (exit 1 when a run is over the budget)
// --no-build serves dist/ as it is. --gpu uses the machine GPU (ANGLE Metal).

import { execSync } from "node:child_process";
import { cpus, loadavg } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, resolve, sep } from "node:path";
import { preview } from "vite";
import { chromium } from "@playwright/test";
import { chainStrips, followLineScript } from "../src/playtest/trail-script.js";
import { createLevelEnv } from "../src/level/ground.js";
import { checkBudget, classifyUrl, frameStats, renderMarkdown, spliceMarkdown } from "./perf-lib.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const LEVEL = "beltline-eastside";
const tiers = arg("tiers", "low,phone,high").split(",");
const looks = arg("looks", "pbr,toon").split(",");
const repeat = Number(arg("repeat", "1"));
const seconds = Number(arg("seconds", "15"));
const port = Number(arg("port", "5790"));
const dist = resolve(arg("dist", "dist"));
const out = arg("out", "reports/perf/perf.json");
const md = arg("md", null);
const budgetPath = arg("budget", null);
const gpu = args.includes("--gpu");
const maxWall = Number(arg("max-wall", "150"));
// Extra URL parameters for every run, for example "&peds=0".
const extra = arg("extra", "");

if (!args.includes("--no-build") && !args.includes("--dist")) {
  console.log("building dist/ ...");
  execSync("npx vite build", { cwd: ROOT, stdio: "ignore" });
}
if (!existsSync(dist)) throw new Error(`no build at ${dist}`);

// The fixed path: the same trail ride as the playtest, planned with the pure
// controller, so each run sees the same views.
const levelJson = JSON.parse(readFileSync(resolve(ROOT, "levels", LEVEL, "level.json"), "utf8"));
const [trail] = chainStrips(levelJson.strips, "trail");
const ride = followLineScript(trail, levelJson.spawn, createLevelEnv(levelJson), { frames: Math.round(seconds * 60) }).script;

// Gzip the .wasm files, as the host (Vercel) does (see scripts/load-check.mjs).
const wasmGzip = {
  name: "perf-wasm-gzip",
  configurePreviewServer(server) {
    const cache = new Map();
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? "").split("?")[0];
      if (!path.endsWith(".wasm") || !/gzip/.test(req.headers["accept-encoding"] ?? "")) return next();
      try {
        const file = resolve(dist, `.${decodeURIComponent(path)}`);
        if (!file.startsWith(`${dist}${sep}`)) return next();
        if (!cache.has(path)) cache.set(path, gzipSync(readFileSync(file)));
      } catch {
        return next();
      }
      res.setHeader("Content-Type", "application/wasm");
      res.setHeader("Content-Encoding", "gzip");
      res.end(cache.get(path));
    });
  },
};

const server = await preview({ plugins: [wasmGzip], build: { outDir: dist }, preview: { port, strictPort: true }, logLevel: "error" });
const base = `http://localhost:${port}`;
const launchArgs = ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required", ...(gpu ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"])];
const browser = await chromium.launch({ headless: true, args: launchArgs });

// --append adds the runs to the ones already in --out (a second pass).
const runs = args.includes("--append") && out && existsSync(resolve(ROOT, out)) ? JSON.parse(readFileSync(resolve(ROOT, out), "utf8")).runs : [];
const errors = [];
const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

async function oneRun(quality, look, n) {
  // One viewport for every tier (1280 x 720, pixel ratio 1), so the tiers
  // differ only in their settings. The governor is off, so a slow software
  // frame does not step the tier down during the ride.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const reqs = new Map();
  cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, { url: e.response.url, mime: e.response.mimeType }));
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.bytes = e.encodedDataLength;
  });
  const runErrors = [];
  page.on("pageerror", (e) => runErrors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && runErrors.push(m.text()));

  const load = loadavg()[0];
  await page.goto(`${base}/?level=${LEVEL}&quality=${quality}&look=${look}&perf=1&mute=1&npcseed=1&governor=0&run=free${extra}`);
  await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 0, null, { timeout: 240000, polling: 100 });
  const firstFrameMs = await page.evaluate(() => performance.getEntriesByName("atl:first-frame")[0]?.startTime ?? null);
  // Wait for the late loads (props, skater, NPC skaters, people, cars), then
  // two more seconds for the shader compiles.
  await page.waitForFunction(
    () => {
      const a = window.__atl;
      return (a.level.props?.loaded || a.level.props?.error) && (a.skaterModel?.loaded || a.skaterModel?.error) && a.frames > 30;
    },
    null,
    { timeout: 240000, polling: 250 },
  );
  const settledMs = await page.evaluate(() => Math.round(performance.now()));
  await page.waitForTimeout(2000);

  // The ride. runScript plays one script tick per fixed step, so a slow frame
  // makes the ride longer in wall time, not shorter in distance.
  // A software GPU can take seconds per frame on the high tier; past
  // --max-wall seconds the ride stops and the row has finished: false.
  const timeoutMs = maxWall * 1000;
  const data = await page.evaluate(
    async ({ script, start, timeoutMs }) => {
      const a = window.__atl;
      a.perf.reset();
      a.fps.start();
      const t0 = performance.now();
      const done = a.runScript(script, start);
      const end = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), timeoutMs))]);
      const wallMs = performance.now() - t0;
      return { finished: Boolean(end), wallMs, frameMs: a.fps.stop(), perf: a.perf.report(), info: a.rendererInfo, render: a.render };
    },
    { script: ride, start: { position: levelJson.spawn.position, yaw: levelJson.spawn.yaw }, timeoutMs },
  );
  const heap = await cdp.send("Runtime.getHeapUsage");
  const bytes = { js: 0, glb: 0, textures: 0, wasm: 0, data: 0, other: 0 };
  let requests = 0;
  for (const r of reqs.values()) {
    if (r.bytes == null || r.url.startsWith("data:")) continue;
    bytes[classifyUrl(r.url, r.mime)] += r.bytes;
    requests += 1;
  }
  const total = Object.values(bytes).reduce((a, b) => a + b, 0);
  const row = {
    quality,
    look,
    run: n + passOffset,
    load: round(load),
    finished: data.finished,
    wallSeconds: round(data.wallMs / 1000),
    frame: frameStats(data.frameMs),
    calls: data.info.calls,
    triangles: data.info.triangles,
    geometries: data.info.geometries,
    textures: data.info.textures,
    heapMB: round(heap.usedSize / 1048576),
    firstFrameMs: round(firstFrameMs, 0),
    settledMs,
    requests,
    downloadMB: Object.fromEntries(Object.entries({ ...bytes, total }).map(([k, v]) => [k, round(v / 1048576, 2)])),
    stepsPerFrame: data.perf.stepsPerFrame,
    systems: data.perf.systems,
    top: [...reqs.values()].filter((r) => r.bytes != null).sort((a, b) => b.bytes - a.bytes).slice(0, 8).map((r) => ({ file: r.url.replace(/^https?:\/\/[^/]+/, ""), kB: Math.round(r.bytes / 1024) })),
    perfFrames: data.perf.frames,
    pixelRatio: data.render.pixelRatio,
    post: data.render.post,
    errors: runErrors.slice(0, 5),
  };
  errors.push(...runErrors.map((e) => `${quality}/${look}: ${e}`));
  await ctx.close();
  return row;
}

const passOffset = Math.max(0, ...runs.map((r) => r.run ?? 0));

// Writes the JSON after each run, so a stopped run keeps the rows so far.
function save() {
  const result = {
    date: new Date().toISOString(),
    level: LEVEL,
    gpu: gpu ? "machine" : "swiftshader (software, CPU)",
    machine: { cpus: cpus().length, model: cpus()[0]?.model ?? null, platform: process.platform },
    viewport: "1280x720 @1",
    rideSeconds: seconds,
    maxWallSeconds: maxWall,
    extra,
    runs,
  };
  if (out) {
    mkdirSync(dirname(resolve(ROOT, out)), { recursive: true });
    writeFileSync(resolve(ROOT, out), `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

try {
  for (let n = 1; n <= repeat; n += 1) {
    for (const quality of tiers) {
      for (const look of looks) {
        const row = await oneRun(quality, look, n);
        runs.push(row);
        save();
        const s = row.systems;
        console.log(
          `${quality.padEnd(5)} ${look.padEnd(4)} mean ${row.frame.meanMs} ms, p95 ${row.frame.p95Ms} ms, ${row.calls} calls, ${row.triangles} tris, heap ${row.heapMB} MB, first frame ${row.firstFrameMs} ms, ${row.downloadMB.total} MB` +
            ` | render ${s.render?.meanMs} ms, walkers ${s.walkers?.meanMs}+${s.walkersView?.meanMs}, traffic ${s.traffic?.meanMs}+${s.trafficView?.meanMs}, npc ${s.npcSkaters?.meanMs}+${s.npcSkatersView?.meanMs} (load ${row.load})`,
        );
      }
    }
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

const result = save();
console.log(`wrote ${out}`);
if (md) {
  const mdPath = resolve(ROOT, md);
  const doc = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";
  writeFileSync(mdPath, spliceMarkdown(doc, renderMarkdown(result)));
  console.log(`wrote ${md}`);
}
if (budgetPath) {
  const budget = JSON.parse(readFileSync(resolve(ROOT, budgetPath), "utf8"));
  const over = checkBudget(runs, budget);
  for (const o of over) console.error(`OVER BUDGET ${o}`);
  if (over.length) process.exit(1);
  console.log("budget: PASS");
}
