// NPC variety check (npm run npc:variety). It opens the BeltLine Eastside in
// headless Chromium for each look and tier, travels to a few points on the
// trail, and records for each stop:
// - the people on screen (the crowd, the walkers, the GLB people),
// - the looks: how many are distinct, and the repeat pairs nearby (two
//   people with the same look, both nearer than NEAR m to the camera),
// - the walker heights (m),
// - a screenshot.
//
// Usage:
//   node scripts/npc-variety.mjs --out reports/npc-variety
//   node scripts/npc-variety.mjs --looks pbr --tiers high --out DIR

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { chainStrips } from "../src/playtest/trail-script.js";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(ROOT, arg("out", "reports/npc-variety"));
const LOOKS = arg("looks", "pbr,toon").split(",");
const TIERS = arg("tiers", "high,phone,low").split(",");
const EXTRA = arg("query", "");
const PORT = Number(arg("port", 5191));
const NEAR = 40;
// The stops: shares of the trail length.
const STOPS = [0.2, 0.45, 0.7];

const LEVEL = JSON.parse(readFileSync(resolve(ROOT, "levels/beltline-eastside/level.json"), "utf8"));
const [trail] = chainStrips(LEVEL.strips, "trail");
function at(share) {
  let total = 0;
  for (let i = 1; i < trail.length; i += 1) total += Math.hypot(trail[i][0] - trail[i - 1][0], trail[i][1] - trail[i - 1][1]);
  let left = total * share;
  for (let i = 1; i < trail.length; i += 1) {
    const d = Math.hypot(trail[i][0] - trail[i - 1][0], trail[i][1] - trail[i - 1][1]);
    if (left <= d) return trail[i - 1];
    left -= d;
  }
  return trail[trail.length - 1];
}

// Pure: the summary of one list of people on screen.
export function summarize(people, near = NEAR) {
  const bySrc = {};
  for (const p of people) bySrc[p.src] = (bySrc[p.src] ?? 0) + 1;
  const close = people.filter((p) => p.d < near);
  const keys = new Map();
  for (const p of close) keys.set(p.key, (keys.get(p.key) ?? 0) + 1);
  let repeats = 0;
  for (const n of keys.values()) repeats += (n * (n - 1)) / 2;
  const heights = people.map((p) => p.height).filter((h) => h != null);
  return {
    total: people.length,
    bySrc,
    near: close.length,
    distinctNear: keys.size,
    repeatPairsNear: repeats,
    repeated: [...keys].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`),
    height: heights.length ? { min: Math.min(...heights), max: Math.max(...heights) } : null,
  };
}

// A screenshot, tried again once: SwiftShader under load can miss one.
async function shoot(page, path) {
  try {
    await page.screenshot({ path, timeout: 60000 });
  } catch {
    await page.waitForTimeout(2000);
    await page.screenshot({ path, timeout: 120000 });
  }
}

mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
const report = [];
try {
  for (const look of LOOKS) {
    for (const tier of TIERS) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`http://localhost:${PORT}/?level=beltline-eastside&mute=1&look=${look}&quality=${tier}${EXTRA ? `&${EXTRA}` : ""}`);
      await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 5, null, { timeout: 240000 });
      await page.waitForFunction(() => window.__atl?.ready && (!window.__atl.pedModels || window.__atl.pedModels.loaded || window.__atl.pedModels.error), null, { timeout: 120000 });
      const stops = [];
      for (const [i, share] of STOPS.entries()) {
        const [x, z] = at(share);
        await page.evaluate(([x, z]) => window.__atl.fastTravel(x, z), [x, z]);
        // Let the walkers scatter and walk in.
        await page.waitForTimeout(6000);
        const people = await page.evaluate(() => window.__atl.people.inView());
        const file = `${look}-${tier}-${i}.png`;
        await shoot(page, resolve(OUT, file));
        stops.push({ share, at: [Math.round(x), Math.round(z)], file, ...summarize(people) });
      }
      // A close shot: the fixed camera 7 m beside the walker with the most
      // walkers within 12 m, at eye height.
      if (!args.includes("--no-close")) {
        await page.goto(`http://localhost:${PORT}/?level=beltline-eastside&mute=1&look=${look}&quality=${tier}&view=fixed&skater=capsule${EXTRA ? `&${EXTRA}` : ""}`);
        await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 5, null, { timeout: 240000 });
        await page.waitForFunction(() => window.__atl?.ready && (!window.__atl.pedModels || window.__atl.pedModels.loaded || window.__atl.pedModels.error), null, { timeout: 120000 });
        await page.waitForTimeout(3000);
        // The walker pool follows the camera, and a big camera move
        // scatters it again: aim from a small move, after the pool settles.
        const pick = () =>
          page.evaluate(async () => {
            const list = window.__atl.peds.list;
            const [x, , z] = window.__atl.cameraPosition;
            const near = (a) => list.filter((b) => Math.hypot(a.x - b.x, a.z - b.z) < 8).length;
            const pool = list.filter((n) => Math.hypot(n.x - x, n.z - z) < 50);
            const t = pool.reduce((best, n) => (near(n) > near(best) ? n : best), pool[0]);
            window.__atl.setFixedCamera(t.x + 5, t.y + 1.6, t.z + 1.5, t.x, t.y + 1, t.z);
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            return window.__atl.people.inView();
          });
        await pick();
        await page.waitForTimeout(4000);
        const close = await pick();
        const file = `${look}-${tier}-close.png`;
        await shoot(page, resolve(OUT, file));
        stops.push({ share: "close", file, ...summarize(close) });
      }
      const counts = await page.evaluate(() => ({ crowd: window.__atl.npcs?.count ?? 0, peds: window.__atl.peds?.count ?? 0, glb: window.__atl.pedModels?.count ?? 0 }));
      report.push({ look, tier, counts, stops, errors });
      console.log(JSON.stringify({ look, tier, counts, stops: stops.map((s) => ({ total: s.total, bySrc: s.bySrc, near: s.near, distinctNear: s.distinctNear, repeatPairsNear: s.repeatPairsNear, height: s.height })) }));
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
