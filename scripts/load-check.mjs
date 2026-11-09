// First-load check on a phone profile (#74). It serves the built dist/ with
// `vite preview`, opens the BeltLine level as a Pixel 7 on an emulated
// Fast 4G link (9 Mbps down, 1.5 Mbps up, 60 ms RTT) with a 4x CPU
// throttle, and measures:
// - the first paint (the load screen),
// - the first game frame,
// - the time when the skater model is in the scene,
// - the bytes on the wire, and the five biggest files.
//
// Run `npm run build` first. Usage:
//   node scripts/load-check.mjs [--cpu 4] [--gpu] [--out reports/load-check.json] [--budget 4000] [--down 9] [--rtt 60]
// --gpu uses the machine GPU (ANGLE Metal on a Mac); without it, Chromium
// uses SwiftShader. --budget fails the run when the first game frame is
// later than that many ms.
//
// The byte counts are the encoded (on the wire) sizes. `vite preview`
// compresses the text files. It does not compress .wasm, but Vercel (the
// planned host, M2-06) does (https://vercel.com/docs/compression lists
// application/wasm). So this script gzips the .wasm files too.

import { loadavg } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, resolve, sep } from "node:path";
import { preview } from "vite";
import { chromium, devices } from "@playwright/test";
import { firstFrameMB } from "./perf-lib.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const cpu = Number(arg("cpu", "4"));
const out = arg("out", null);
const budget = arg("budget", null);
const gpu = args.includes("--gpu");
const port = Number(arg("port", "5187"));
// --dist serves another build folder, to compare two builds.
const dist = arg("dist", "dist");
// --down <Mbps> and --rtt <ms> set another link (#190: 1.6 and 150 for a 3G link).
const downMbps = Number(arg("down", "9"));
const rttMs = Number(arg("rtt", "60"));

// Gzip the .wasm files, as the host does.
const wasmGzip = {
  name: "load-check-wasm-gzip",
  configurePreviewServer(server) {
    const cache = new Map();
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? "").split("?")[0];
      if (!path.endsWith(".wasm") || !/gzip/.test(req.headers["accept-encoding"] ?? "")) return next();
      // Serve only a file inside dist/. A path with ".." goes to Vite.
      const root = resolve(dist);
      try {
        const file = resolve(root, `.${decodeURIComponent(path)}`);
        if (!file.startsWith(`${root}${sep}`)) return next();
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
const launchArgs = ["--no-sandbox", "--disable-dev-shm-usage", gpu ? "--use-angle=metal" : "--enable-unsafe-swiftshader"];
if (gpu) launchArgs.push("--enable-gpu", "--ignore-gpu-blocklist");
const browser = await chromium.launch({ args: launchArgs });

let result;
try {
  const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars
  const ctx = await browser.newContext(pixel);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: rttMs, downloadThroughput: (downMbps * 1e6) / 8, uploadThroughput: 1.5e6 / 8 });
  if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  const reqs = new Map();
  cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, { url: e.response.url }));
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.bytes = e.encodedDataLength;
  });

  // The long tasks (over 50 ms) on the main thread, up to the first game frame (#98).
  await page.addInitScript(() => {
    // Keep a start time for every file (the default buffer keeps 250).
    performance.setResourceTimingBufferSize(2000);
    window.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__longTasks.push({ start: Math.round(e.startTime), ms: Math.round(e.duration) });
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // No long task API: the list stays empty.
    }
  });
  const t0 = Date.now();
  await page.goto(`${base}/?level=beltline-eastside&mute=1${arg("query", "")}`, { waitUntil: "commit" });
  const fcp = await page
    .waitForFunction(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null, null, { timeout: 120000, polling: 50 })
    .then((h) => h.jsonValue());
  const loadScreen = await page.evaluate(() => Boolean(document.getElementById("loader")));
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 0, null, { timeout: 180000, polling: 50 });
  const firstFrame = Date.now() - t0;
  const longTasks = await page.evaluate(() => {
    const ff = performance.getEntriesByName("atl:first-frame")[0]?.startTime ?? Infinity;
    return window.__longTasks.filter((t) => t.start < ff);
  });
  await page.waitForFunction(() => window.__atl.skaterModel && window.__atl.skaterModel.loaded, null, { timeout: 180000, polling: 50 });
  const skaterReady = Date.now() - t0;
  await page.waitForTimeout(2000);
  const files = [...reqs.values()].filter((r) => r.bytes != null);
  const total = files.reduce((a, r) => a + r.bytes, 0);
  // The bytes asked for before the first game frame (#190).
  const timing = await page.evaluate(() => ({ ff: performance.getEntriesByName("atl:first-frame")[0]?.startTime ?? null, started: performance.getEntriesByType("resource").map((e) => [e.name, Math.round(e.startTime)]) }));
  const started = new Map(timing.started);
  const beforeFirstFrame = firstFrameMB(files.filter((r) => !r.url.startsWith("data:")).map((r) => ({ file: r.url, kB: r.bytes / 1024, startMs: started.get(r.url) ?? null })), timing.ff);
  result = {
    date: new Date().toISOString(),
    device: "Pixel 7",
    cpuThrottle: cpu,
    gpu: gpu ? "machine" : "swiftshader",
    network: `${downMbps} Mbps / 1.5 Mbps / ${rttMs} ms`,
    firstContentfulPaintMs: Math.round(fcp),
    loadScreen,
    firstGameFrameMs: firstFrame,
    skaterReadyMs: skaterReady,
    quality: await page.evaluate(() => window.__atl.quality),
    // The startup steps (performance marks in src/main.js), in ms from the start.
    marks: await page.evaluate(() => Object.fromEntries(performance.getEntriesByType("mark").filter((m) => m.name.startsWith("atl:")).map((m) => [m.name.slice(4), Math.round(m.startTime)]))),
    // Long tasks before the first game frame: the count, the sum, the longest.
    longTasks: { count: longTasks.length, totalMs: longTasks.reduce((a, t) => a + t.ms, 0), maxMs: longTasks.reduce((a, t) => Math.max(a, t.ms), 0), list: longTasks },
    requests: files.length,
    transferMB: +(total / 1048576).toFixed(2),
    beforeFirstFrameMB: beforeFirstFrame,
    top5: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 5).map((r) => ({ file: r.url.replace(/^https?:\/\/[^/]+/, ""), kB: Math.round(r.bytes / 1024) })),
    loadAverage: loadavg().map((n) => +n.toFixed(2)).join(" "),
  };
  await ctx.close();
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

console.log(JSON.stringify(result, null, 2));
if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify(result, null, 2));
}
if (budget && result.firstGameFrameMs > Number(budget)) {
  console.error(`first game frame ${result.firstGameFrameMs} ms is over the ${budget} ms budget`);
  process.exit(1);
}
