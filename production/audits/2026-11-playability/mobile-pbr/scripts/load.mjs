// First load on a "Fast 4G"-like network (9 Mbps down, 1.5 Mbps up, 60 ms
// RTT) with a 4x CPU throttle, empty cache, against `vite preview` of dist/
// on port 5184. Same network as the #65 load.mjs. The phone tier is forced
// (SwiftShader alone gets the low tier). Both looks, Pixel 7 and the small
// phone. Writes load.json. Also counts the bytes before the first game frame
// and after it (the late loads, #190).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OUT, LEVEL_URL, launch, profile, loadAverage } from "./common.mjs";

const CPU = Number(process.env.CPU ?? 4);
const RUNS = [
  { device: "Pixel 7", key: "Pixel7-port", look: "toon" },
  { device: "Pixel 7", key: "Pixel7-port", look: "pbr" },
  { device: "Galaxy S5", key: "small-360x640", look: "toon" },
];
const browser = await launch();
const runs = [];
for (const r of RUNS) {
  const ctx = await browser.newContext(profile(r.device));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const reqs = new Map();
  let firstFrameAt = Infinity;
  cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, { url: e.response.url, type: e.type, status: e.response.status }));
  let lastNet = Date.now();
  cdp.on("Network.requestWillBeSent", () => (lastNet = Date.now()));
  cdp.on("Network.loadingFinished", (e) => {
    lastNet = Date.now();
    const q = reqs.get(e.requestId);
    if (q) {
      q.bytes = e.encodedDataLength;
      q.at = Date.now();
    }
  });
  const load = loadAverage();
  const t0 = Date.now();
  await page.goto(LEVEL_URL(`mute=1&quality=phone&look=${r.look}`), { waitUntil: "commit" });
  const tFcp = await page.waitForFunction(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null, null, { timeout: 300000, polling: 100 }).then((h) => h.jsonValue());
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 0, null, { timeout: 600000, polling: 50 });
  firstFrameAt = Date.now();
  const firstFrameMs = firstFrameAt - t0;
  const loaderHiddenMs = await page
    .waitForFunction(() => document.getElementById("loader")?.dataset.hidden === "1" || !document.getElementById("loader"), null, { timeout: 60000, polling: 50 })
    .then(() => Date.now() - t0)
    .catch(() => null);
  // Wait for the late loads and the lazy chunks. Quiet for 5 s, or 180 s at most.
  while (Date.now() - lastNet < 5000 && Date.now() - t0 < 180000) await page.waitForTimeout(250);
  const settledMs = lastNet - t0;
  await page.screenshot({ path: resolve(OUT, `load-settled-${r.key}-${r.look}-cpu${CPU}x.jpg`), type: "jpeg", quality: 70 });
  const list = [...reqs.values()].filter((q) => q.bytes != null);
  const total = list.reduce((a, q) => a + q.bytes, 0);
  const before = list.filter((q) => q.at <= firstFrameAt);
  const beforeBytes = before.reduce((a, q) => a + q.bytes, 0);
  const top = [...list].sort((a, b) => b.bytes - a.bytes).slice(0, 8).map((q) => ({ url: q.url.replace(/^https?:\/\/[^/]+/, ""), type: q.type, kB: Math.round(q.bytes / 1024), beforeFirstFrame: q.at <= firstFrameAt }));
  const atl = await page.evaluate(() => ({ quality: window.__atl.quality, look: window.__atl.look, lateLoads: window.__atl.lateLoads }));
  runs.push({ profile: r.key, device: r.device, look: r.look, tier: atl.quality, cpuThrottle: CPU, network: "9 Mbps / 1.5 Mbps / 60 ms", firstContentfulPaintMs: Math.round(tFcp), timeToFirstGameFrameMs: firstFrameMs, loaderHiddenMs, lastNetworkActivityMs: settledMs, requests: list.length, transferMB: +(total / 1048576).toFixed(2), requestsBeforeFirstFrame: before.length, transferBeforeFirstFrameMB: +(beforeBytes / 1048576).toFixed(2), top8: top, lateLoads: atl.lateLoads, load });
  console.log(JSON.stringify(runs.at(-1)));
  await ctx.close();
}
await browser.close();
writeFileSync(resolve(OUT, "load.json"), JSON.stringify({ note: "vite preview of dist/ (as served, no CDN compression). SwiftShader, phone tier forced. CPU throttle via CDP.", runs }, null, 2));
