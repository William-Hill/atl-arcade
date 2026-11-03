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
//   node scripts/load-check.mjs [--cpu 4] [--gpu] [--out reports/load-check.json] [--budget 4000]
// --gpu uses the machine GPU (ANGLE Metal on a Mac); without it, Chromium
// uses SwiftShader. --budget fails the run when the first game frame is
// later than that many ms.
//
// The byte counts are the encoded (on the wire) sizes. `vite preview`
// compresses the text files. It does not compress .wasm, but Vercel (the
// planned host, M2-06) does (https://vercel.com/docs/compression lists
// application/wasm). So this script gzips the .wasm files too.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { preview } from "vite";
import { chromium, devices } from "@playwright/test";

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

// Gzip the .wasm files, as the host does.
const wasmGzip = {
  name: "load-check-wasm-gzip",
  configurePreviewServer(server) {
    const cache = new Map();
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? "").split("?")[0];
      if (!path.endsWith(".wasm") || !/gzip/.test(req.headers["accept-encoding"] ?? "")) return next();
      try {
        if (!cache.has(path)) cache.set(path, gzipSync(readFileSync(resolve(dist, `.${path}`))));
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
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  const reqs = new Map();
  cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, { url: e.response.url }));
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.bytes = e.encodedDataLength;
  });

  const t0 = Date.now();
  await page.goto(`${base}/?level=beltline-eastside&mute=1`, { waitUntil: "commit" });
  const fcp = await page
    .waitForFunction(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null, null, { timeout: 120000, polling: 50 })
    .then((h) => h.jsonValue());
  const loadScreen = await page.evaluate(() => Boolean(document.getElementById("loader")));
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 0, null, { timeout: 180000, polling: 50 });
  const firstFrame = Date.now() - t0;
  await page.waitForFunction(() => window.__atl.skaterModel && window.__atl.skaterModel.loaded, null, { timeout: 180000, polling: 50 });
  const skaterReady = Date.now() - t0;
  await page.waitForTimeout(2000);
  const files = [...reqs.values()].filter((r) => r.bytes != null);
  const total = files.reduce((a, r) => a + r.bytes, 0);
  result = {
    date: new Date().toISOString(),
    device: "Pixel 7",
    cpuThrottle: cpu,
    gpu: gpu ? "machine" : "swiftshader",
    network: "9 Mbps / 1.5 Mbps / 60 ms",
    firstContentfulPaintMs: Math.round(fcp),
    loadScreen,
    firstGameFrameMs: firstFrame,
    skaterReadyMs: skaterReady,
    quality: await page.evaluate(() => window.__atl.quality),
    // The startup steps (performance marks in src/main.js), in ms from the start.
    marks: await page.evaluate(() => Object.fromEntries(performance.getEntriesByType("mark").filter((m) => m.name.startsWith("atl:")).map((m) => [m.name.slice(4), Math.round(m.startTime)]))),
    requests: files.length,
    transferMB: +(total / 1048576).toFixed(2),
    top5: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 5).map((r) => ({ file: r.url.replace(/^https?:\/\/[^/]+/, ""), kB: Math.round(r.bytes / 1024) })),
    loadAverage: execFileSync("uptime").toString().trim().split("averages: ")[1],
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
