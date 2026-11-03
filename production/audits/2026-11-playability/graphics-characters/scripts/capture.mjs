// Graphics and characters audit captures (#65).
// Start Vite first:  npx vite --port 5182 --strictPort
// Then run:          node production/audits/2026-11-playability/graphics-characters/scripts/capture.mjs
// Writes JPEG screenshots and capture.json next to this folder.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.env.BASE ?? "http://localhost:5182";
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "shots");
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = {
  desk: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  land: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

// Fixed cameras (x, y, z, lookX, lookY, lookZ), from e2e/beltline.spec.js.
const CAMS = {
  pcm: "-60,14,-700,-218,18,-874",
  "pcm-tower": "-120,70,-760,-219,48,-915",
  "ksm-front": "-12,3,866,-48,7,849",
  ksm: "-20,18,760,-72,4,850",
};

const browser = await chromium.launch({ headless: true });
const rows = [];
const errors = [];

async function open(vpName, query) {
  const ctx = await browser.newContext(VIEWPORTS[vpName]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${vpName} ${query}: ${e}`));
  await page.goto(`${base}/?level=beltline-eastside&mute=1&${query}`);
  await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 20 && (window.__atl.skaterModel?.loaded || window.__atl.skaterModel?.error), null, { timeout: 180000 }).catch(() => {});
  await page.waitForFunction(() => window.__atl?.frames > 20, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  return { ctx, page };
}

async function shot(page, name, extra = {}) {
  const path = resolve(outDir, `${name}.jpg`);
  await page.screenshot({ path, type: "jpeg", quality: 78 });
  const info = await page.evaluate(() => ({ gpu: window.__atl.gpu, quality: window.__atl.quality, skater: window.__atl.skaterModel?.name, loaded: window.__atl.skaterModel?.loaded, clip: window.__atl.skaterModel?.clip }));
  rows.push({ name, ...info, ...extra });
}

for (const q of ["high", "low"]) {
  for (const vp of ["desk", "phone"]) {
    // Spawn, follow camera, Nia moving on the trail.
    {
      const { ctx, page } = await open(vp, `quality=${q}`);
      await shot(page, `${q}-${vp}-spawn`);
      await page.keyboard.down("KeyW");
      await page.waitForTimeout(2500);
      await page.keyboard.up("KeyW");
      await page.waitForTimeout(400);
      await shot(page, `${q}-${vp}-rolling`);
      // NPCs: a fixed camera next to the nearest trail NPC.
      const npc = await page.evaluate(() => {
        const s = window.__atl.skater.position;
        const list = window.__atl.npcs.list.filter((n) => n.kind === "trail");
        list.sort((a, b) => Math.hypot(a.x - s[0], a.z - s[2]) - Math.hypot(b.x - s[0], b.z - s[2]));
        return list[0];
      });
      if (npc) {
        await page.evaluate((n) => window.__atl.setFixedCamera(n.x + 6, n.y + 2.5, n.z + 6, n.x, n.y + 0.9, n.z), npc);
        await page.waitForTimeout(600);
        await shot(page, `${q}-${vp}-npcs`, { npc });
      }
      await ctx.close();
    }
    for (const [name, cam] of Object.entries(CAMS)) {
      if (vp === "phone" && (name === "pcm-tower")) continue;
      const { ctx, page } = await open(vp, `quality=${q}&view=fixed&cam=${cam}`);
      await shot(page, `${q}-${vp}-${name}`);
      await ctx.close();
    }
  }
}

// Murals: the first mural walls from the level data, both tiers, desktop.
{
  const { ctx, page } = await open("desk", "quality=high&view=fixed");
  const murals = await page.evaluate(async () => {
    const { loadLevel } = await import("/src/level/levels.js");
    const { muralWalls } = await import("/src/level/geo/geo-mesh.js");
    const level = await loadLevel("beltline-eastside");
    return muralWalls(level).map((m) => ({ id: m.id, a: m.a, b: m.b, n: m.n, y0: m.y0, y1: m.y1, cell: m.cell }));
  });
  await ctx.close();
  rows.push({ name: "mural-count", count: murals.length, cells: [...new Set(murals.map((m) => m.cell))].length });
  const pick = [murals[0], murals[Math.floor(murals.length / 2)], murals[murals.length - 1]].filter(Boolean);
  for (const [i, m] of pick.entries()) {
    const cx = (m.a[0] + m.b[0]) / 2;
    const cz = (m.a[1] + m.b[1]) / 2;
    const cy = (m.y0 + m.y1) / 2;
    const cam = [cx + m.n[0] * 16, cy, cz + m.n[1] * 16, cx, cy, cz].map((v) => v.toFixed(2)).join(",");
    for (const q of ["high", "low"]) {
      for (const vp of i === 0 ? ["desk", "phone"] : ["desk"]) {
        const { ctx: c2, page: p2 } = await open(vp, `quality=${q}&view=fixed&cam=${cam}`);
        await shot(p2, `${q}-${vp}-mural-${i}`, { mural: m.id, cell: m.cell });
        await c2.close();
      }
    }
  }
}

// Marcus in the game, phone, high and low.
for (const q of ["high", "low"]) {
  const { ctx, page } = await open("phone", `quality=${q}&skater=marcus`);
  await shot(page, `${q}-phone-spawn-marcus`);
  await ctx.close();
}
// Landscape phone, high, Nia rolling.
{
  const { ctx, page } = await open("land", "quality=high");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(2500);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(400);
  await shot(page, "high-land-rolling");
  await ctx.close();
}

await browser.close();
writeFileSync(resolve(outDir, "capture.json"), JSON.stringify({ date: new Date().toISOString(), base, rows, errors }, null, 2));
console.log(JSON.stringify({ n: rows.length, gpus: [...new Set(rows.map((r) => r.gpu))], errors }, null, 2));
