// Load on a "Fast 4G"-like network: 9 Mbps down, 1.5 Mbps up, 60 ms RTT,
// against `vite preview` of dist/ on port 5184. Empty cache. Writes load.json.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OUT, LEVEL_URL, launch, profile, loadAverage } from "./common.mjs";

const browser = await launch({ gpu: true });
const runs = [];
for (const cpu of [1, 4]) {
  const ctx = await browser.newContext(profile("Pixel 7"));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: (9e6 / 8), uploadThroughput: (1.5e6 / 8) });
  if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  const reqs = new Map();
  cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, { url: e.response.url, type: e.type, status: e.response.status }));
  let lastNet = Date.now();
  cdp.on("Network.requestWillBeSent", () => (lastNet = Date.now()));
  cdp.on("Network.loadingFinished", (e) => {
    lastNet = Date.now();
    const r = reqs.get(e.requestId);
    if (r) r.bytes = e.encodedDataLength;
  });
  const load = loadAverage();
  const t0 = Date.now();
  await page.goto(LEVEL_URL("mute=1"), { waitUntil: "commit" });
  const tFcp = await page.waitForFunction(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null, null, { timeout: 300000, polling: 100 }).then((h) => h.jsonValue());
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 0, null, { timeout: 300000, polling: 50 });
  const firstFrameMs = Date.now() - t0;
  // Wait for the lazy chunks (landmarks, skater GLB) to finish.
  // Quiet for 5 s, or 120 s at most.
  while (Date.now() - lastNet < 5000 && Date.now() - t0 < 120000) await page.waitForTimeout(250);
  const settledMs = lastNet - t0;
  const skaterReady = await page.evaluate(() => Boolean(window.__atl.skaterModel ?? window.__atl.skater));
  await page.screenshot({ path: resolve(OUT, `load-settled-cpu${cpu}x.jpg`), type: "jpeg", quality: 70 });
  const list = [...reqs.values()].filter((r) => r.bytes != null);
  const total = list.reduce((a, r) => a + r.bytes, 0);
  const top = [...list].sort((a, b) => b.bytes - a.bytes).slice(0, 5).map((r) => ({ url: r.url.replace(/^https?:\/\/[^/]+/, ""), type: r.type, kB: Math.round(r.bytes / 1024) }));
  runs.push({ device: "Pixel 7", cpuThrottle: cpu, network: "9 Mbps / 1.5 Mbps / 60 ms", firstContentfulPaintMs: Math.round(tFcp), timeToFirstGameFrameMs: firstFrameMs, lastNetworkActivityMs: settledMs, skaterReady, requests: list.length, transferMB: +(total / 1048576).toFixed(2), top5: top, quality: await page.evaluate(() => window.__atl.quality), load });
  console.log(JSON.stringify(runs.at(-1), null, 1));
  await ctx.close();
}
await browser.close();
writeFileSync(resolve(OUT, "load.json"), JSON.stringify(runs, null, 2));
