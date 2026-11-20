// Frame time, draw calls, triangles and JS heap on the four phone profiles,
// on the phone tier, for both looks. SwiftShader only (no GPU here): the frame
// times are relative numbers between the runs, NOT phone numbers.
//   node measure.mjs   -> measurements.json + measure-*.jpg
// ONLY=Pixel7-port,toon limits the runs. SAMPLE_MS sets the sample time.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OUT, LEVEL_URL, PROFILES, launch, profile, waitReady, loadAverage, DRAW_COUNTER, drawsPerFrame, fingers, targets, stats } from "./common.mjs";

const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 8000);
const ONLY = process.env.ONLY?.split(",");
const CPU = Number(process.env.CPU ?? 1);
const runs = [];
for (const p of PROFILES) for (const look of ["toon", "pbr"]) runs.push({ ...p, look });

const browser = await launch();
const results = [];
for (const r of runs) {
  if (ONLY && !ONLY.every((k) => r.key === k || r.look === k)) continue;
  const ctx = await browser.newContext(profile(r.device));
  await ctx.addInitScript(DRAW_COUNTER);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const t0 = Date.now();
  // governor=0 keeps the phone tier fixed, so the runs compare one tier.
  await page.goto(LEVEL_URL(`mute=1&quality=phone&look=${r.look}&governor=0`));
  await waitReady(page);
  const readyMs = Date.now() - t0;
  await page.waitForTimeout(3000);
  // Push with the touch stick (stick up), as a phone player does.
  const t = await targets(page);
  const f = await fingers(page);
  await f.start(1, t.stick.x, t.stick.y);
  await f.move(1, t.stick.x, t.stick.y - 50);
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__atl.fps.start());
  const loadBefore = loadAverage();
  await page.waitForTimeout(SAMPLE_MS);
  const frameMs = await page.evaluate(() => window.__atl.fps.stop());
  const draws = await drawsPerFrame(page, 10);
  const info = await page.evaluate(() => ({ quality: window.__atl.quality, look: window.__atl.look, render: window.__atl.render, rendererInfo: window.__atl.rendererInfo, gpu: window.__atl.gpu, dpr: devicePixelRatio, canvas: [document.getElementById("stage").width, document.getElementById("stage").height], speed: window.__atl.skater.speed, source: window.__atl.input.source }));
  const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  await f.end(1);
  const tag = `${r.key}-${r.look}`;
  await page.screenshot({ path: resolve(OUT, `measure-${tag}.jpg`), type: "jpeg", quality: 70 });
  results.push({ profile: r.key, device: r.device, look: r.look, tier: info.quality, tag, cpuThrottle: CPU, readyMs, ...stats(frameMs), drawCalls: draws.calls, triangles: draws.triangles, multiDrawBatches: draws.multiDrawBatches, rendererInfoLastPass: info.rendererInfo, render: info.render, dpr: info.dpr, canvasPx: info.canvas, speedWhilePushing: +info.speed.toFixed(2), inputSource: info.source, jsHeapUsedMB: +(metrics.JSHeapUsedSize / 1048576).toFixed(1), loadBefore, loadAfter: loadAverage(), gpu: info.gpu, errors });
  console.log(JSON.stringify(results.at(-1)));
  await ctx.close();
}
await browser.close();
writeFileSync(resolve(OUT, process.env.OUTFILE ?? "measurements.json"), JSON.stringify({ note: "Chromium headless with SwiftShader (software GPU on the CPU), 4 cores, no GPU. Phone tier forced with ?quality=phone (SwiftShader alone gets the low tier), governor off. Device descriptors emulate viewport, DPR, touch, UA. The frame times compare runs with each other only; they are NOT phone GPU numbers. drawCalls and triangles count every WebGL draw in all passes (a multi-draw counts each sub-draw).", runs: results }, null, 2));
