// Playtest harness: loads the greybox, drives the three scripted sessions,
// records metrics, screenshots, and a short video per session, and writes
// reports/playtest-<date>.json. Fails (exit 1) when the median FPS over all
// sessions is under the gate.
//
//   npm run playtest
//   npm run playtest -- --gate 55 --port 5182

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { SESSIONS, comboMetrics, fpsMetrics } from "../src/playtest/sessions.js";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const GATE_FPS = Number(argValue("--gate", 55));
const PORT = Number(argValue("--port", 5182));
const ROOT = resolve(import.meta.dirname, "..");
const REPORTS = resolve(ROOT, "reports");
const date = new Date();
const stamp = date.toISOString().slice(0, 19).replace(/[:T]/g, "-");
const base = `playtest-${stamp}`;

mkdirSync(REPORTS, { recursive: true });

const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: "silent" });
await server.listen();

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
});

const results = [];
const allFrameMs = [];

for (const session of SESSIONS) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: REPORTS, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto(`http://localhost:${PORT}/?mute=1`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 10, null, { timeout: 30000 });
  await page.evaluate(() => window.__atl.beat.start());
  await page.waitForTimeout(300);

  const screenshotStart = resolve(REPORTS, `${base}-${session.id}-start.png`);
  const screenshotEnd = resolve(REPORTS, `${base}-${session.id}-end.png`);

  const data = await page.evaluate(
    async ({ script, start }) => {
      window.__atl.fps.start();
      const t0 = performance.now();
      const end = await window.__atl.runScript(script, start);
      const wallMs = performance.now() - t0;
      const frameMs = window.__atl.fps.stop();
      return { end, wallMs, frameMs, events: window.__atl.events.slice(), combo: window.__atl.combo };
    },
    { script: session.script, start: session.start },
  ).then(async (d) => {
    await page.screenshot({ path: screenshotEnd });
    return d;
  });
  // Take the start shot after the run (same page) by resetting to the start pose.
  await page.evaluate((start) => window.__atl.resetSkater(start.position, start.yaw), session.start);
  await page.waitForTimeout(100);
  await page.screenshot({ path: screenshotStart });

  const video = page.video();
  await context.close();
  let videoPath = null;
  if (video) {
    const tmp = await video.path();
    videoPath = resolve(REPORTS, `${base}-${session.id}.webm`);
    renameSync(tmp, videoPath);
  }

  const ticks = data.end.tick;
  const seconds = ticks / 60;
  const stats = data.end.stats;
  const fps = fpsMetrics(data.frameMs);
  allFrameMs.push(...data.frameMs);
  const combo = comboMetrics(data.events);

  const result = {
    id: session.id,
    title: session.title,
    description: session.description,
    ticks,
    simulatedSeconds: Number(seconds.toFixed(2)),
    wallSeconds: Number((data.wallMs / 1000).toFixed(2)),
    fps,
    score: data.combo.score,
    bestCombo: data.combo.best,
    comboCount: combo.comboCount,
    maxCombo: combo.maxCombo,
    timeToFirstThreeLinkSec: combo.timeToFirstThreeLinkSec,
    vertAirs: combo.vertAirs,
    snaps: stats.snaps,
    exits: stats.exits,
    falls: stats.falls,
    fallsPerMinute: Number(((stats.falls / seconds) * 60).toFixed(2)),
    grindSeconds: Number(stats.grindTime.toFixed(2)),
    styleMoves: stats.styles,
    moves: data.events.filter((e) => e.type === "move").map((e) => ({ tick: e.tick, name: e.name, points: e.points, onBeat: e.onBeat, beatTag: e.beatTag })),
    screenshots: [screenshotStart, screenshotEnd].map((p) => p.replace(`${ROOT}/`, "")),
    video: videoPath ? videoPath.replace(`${ROOT}/`, "") : null,
    consoleErrors: errors,
  };
  results.push(result);
  console.log(
    `${session.id.padEnd(6)} ${result.simulatedSeconds}s sim, median ${fps.medianFps} fps (avg ${fps.averageFps}, p5 ${fps.p5Fps}), score ${result.score}, max combo ${result.maxCombo}, combos ${result.comboCount}, falls/min ${result.fallsPerMinute}, first 3-link ${result.timeToFirstThreeLinkSec === null ? "none" : `${result.timeToFirstThreeLinkSec}s`}`,
  );
}

await browser.close();
await server.close();

const overall = fpsMetrics(allFrameMs);
const totals = {
  medianFps: overall.medianFps,
  averageFps: overall.averageFps,
  p5Fps: overall.p5Fps,
  frames: overall.frames,
  score: results.reduce((n, r) => n + r.score, 0),
  comboCount: results.reduce((n, r) => n + r.comboCount, 0),
  maxCombo: Math.max(...results.map((r) => r.maxCombo)),
  falls: results.reduce((n, r) => n + r.falls, 0),
  simulatedSeconds: Number(results.reduce((n, r) => n + r.simulatedSeconds, 0).toFixed(2)),
};
totals.fallsPerMinute = Number(((totals.falls / totals.simulatedSeconds) * 60).toFixed(2));
const firstThree = results.map((r) => r.timeToFirstThreeLinkSec).filter((t) => t !== null);
totals.timeToFirstThreeLinkSec = firstThree.length ? Math.min(...firstThree) : null;

const passed = totals.medianFps >= GATE_FPS && results.every((r) => r.consoleErrors.length === 0);
const report = {
  date: date.toISOString(),
  machine: { platform: process.platform, arch: process.arch, node: process.version, renderer: "headless Chromium, SwiftShader" },
  gate: { medianFpsAtLeast: GATE_FPS, passed },
  totals,
  sessions: results,
};
const jsonPath = resolve(REPORTS, `${base}.json`);
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\noverall median ${totals.medianFps} fps over ${totals.frames} frames; gate ${GATE_FPS}: ${passed ? "PASS" : "FAIL"}`);
console.log(`report: ${jsonPath.replace(`${ROOT}/`, "")}`);
process.exit(passed ? 0 : 1);
