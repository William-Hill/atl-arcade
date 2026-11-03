// FPS, frame time, draw calls, triangles, and JS heap on emulated phones.
// Chromium with the Metal GPU flags (Apple M4 Max), so the tier logic sees a
// real GPU, as a phone does. This does NOT measure a phone GPU.
//   node measure.mjs            -> measurements.json + screenshots
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OUT, LEVEL_URL, launch, profile, waitReady, loadAverage } from "./common.mjs";

const SW = process.env.GPU === "0";
const RUNS_GPU = [
  { device: "iPhone 15", landscape: false, cpu: 1, q: "low" },
  { device: "iPhone 15", landscape: false, cpu: 1, q: "" },
  { device: "Pixel 7", landscape: false, cpu: 4, q: "low" },
  { device: "Pixel 7", landscape: false, cpu: 4, q: "" },
  { device: "Pixel 7", landscape: true, cpu: 4, q: "" },
  { device: "iPhone 15", landscape: true, cpu: 1, q: "" },
];
// SwiftShader: a software GPU on the CPU. A pessimistic proxy for a weak
// phone GPU: it shows the relative cost of the tiers, not phone FPS.
const RUNS_SW = [
  { device: "Pixel 7", landscape: false, cpu: 4, q: "low" },
  { device: "Pixel 7", landscape: false, cpu: 4, q: "high" },
  { device: "iPhone 15", landscape: false, cpu: 1, q: "low" },
  { device: "iPhone 15", landscape: false, cpu: 1, q: "high" },
];
const RUNS = SW ? RUNS_SW : RUNS_GPU;
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 12000);

function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const median = at(0.5);
  return { frames: s.length, medianMs: +median.toFixed(2), medianFps: +(1000 / median).toFixed(1), p95FrameMs: +at(0.95).toFixed(2), p5Fps: +(1000 / at(0.95)).toFixed(1), maxMs: +s[s.length - 1].toFixed(1) };
}

const browser = await launch({ gpu: !SW });
const results = [];
for (const r of RUNS) {
  const ctx = await browser.newContext(profile(r.device, r.landscape));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (r.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: r.cpu });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(LEVEL_URL(["mute=1", r.q && `quality=${r.q}`].filter(Boolean).join("&")));
  await waitReady(page);
  const readyMs = Date.now() - t0;
  await page.waitForTimeout(3000);
  // Push forward with the keyboard so the camera moves. A phone has no
  // keyboard; this is only to load the renderer like a ride.
  await page.keyboard.down("KeyW");
  await page.evaluate(() => window.__atl.fps.start());
  const loadBefore = loadAverage();
  await page.waitForTimeout(SAMPLE_MS);
  const frameMs = await page.evaluate(() => window.__atl.fps.stop());
  const info = await page.evaluate(() => {
    const a = window.__atl;
    const r = a.post?.composer?.renderer ?? a.post?.renderer ?? null;
    return { render: a.rendererInfo, memory: r?.info?.memory ?? null, quality: a.quality, gpu: a.gpu, dpr: devicePixelRatio, canvas: [document.getElementById("stage").width, document.getElementById("stage").height] };
  });
  // With the post chain, renderer.info resets on each pass, so rendererInfo
  // shows only the last pass. Count all passes over 30 frames instead.
  info.perFrame = await page.evaluate(async () => {
    const r = window.__atl.post?.composer?.renderer;
    if (!r) return null;
    r.info.autoReset = false;
    r.info.reset();
    for (let i = 0; i < 30; i++) await new Promise((ok) => requestAnimationFrame(ok));
    const out = { calls: Math.round(r.info.render.calls / 30), triangles: Math.round(r.info.render.triangles / 30), frames: 30 };
    r.info.autoReset = true;
    return out;
  });
  const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  await page.keyboard.up("KeyW");
  const tag = `${SW ? "sw-" : ""}${r.device.replace(/\s/g, "")}-${r.landscape ? "land" : "port"}-${r.q || "default"}-cpu${r.cpu}x`;
  await page.screenshot({ path: resolve(OUT, `measure-${tag}.jpg`), type: "jpeg", quality: 70 });
  results.push({ ...r, tier: info.quality, tag, readyMs, ...stats(frameMs), drawCalls: info.perFrame?.calls ?? info.render.calls, triangles: info.perFrame?.triangles ?? info.render.triangles, lastPassInfo: info.render, rendererMemory: info.memory, dpr: info.dpr, canvasPx: info.canvas, jsHeapUsedMB: +(metrics.JSHeapUsedSize / 1048576).toFixed(1), jsHeapTotalMB: +(metrics.JSHeapTotalSize / 1048576).toFixed(1), loadBefore, loadAfter: loadAverage(), errors });
  console.log(JSON.stringify(results.at(-1)));
  await ctx.close();
}
await browser.close();
writeFileSync(resolve(OUT, SW ? "measurements-swiftshader.json" : "measurements.json"), JSON.stringify({ note: SW ? "Chromium headless with SwiftShader (software GPU on the CPU). Pessimistic proxy, not a phone GPU." : "Chromium headless with ANGLE Metal on an Apple M4 Max. Device descriptors emulate viewport, DPR, touch, UA. Not a phone GPU.", runs: results }, null, 2));
