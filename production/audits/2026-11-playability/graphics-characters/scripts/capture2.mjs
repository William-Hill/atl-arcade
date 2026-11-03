// Second capture pass (#65 graphics and characters audit):
// NPC close-ups, murals at street level, the face decal check in the game,
// and the skater viewer for Nia and Marcus.
// Start Vite first:  npx vite --port 5182 --strictPort
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.env.BASE ?? "http://localhost:5182";
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "shots");
mkdirSync(outDir, { recursive: true });
const VP = {
  desk: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const browser = await chromium.launch({ headless: true });
const rows = [];
const errors = [];

async function openGame(vp, query) {
  const ctx = await browser.newContext(VP[vp]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${vp} ${query}: ${e}`));
  await page.goto(`${base}/?level=beltline-eastside&mute=1&${query}`);
  await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 20 && (window.__atl.skaterModel?.loaded || window.__atl.skaterModel?.error), null, { timeout: 180000 });
  await page.waitForTimeout(2000);
  return { ctx, page };
}
async function shot(page, name, extra = {}) {
  await page.screenshot({ path: resolve(outDir, `${name}.jpg`), type: "jpeg", quality: 78 });
  rows.push({ name, ...extra });
}

// 1. NPCs: fixed camera next to the nearest trail NPCs of 3 types.
for (const q of ["high", "low"]) {
  for (const vp of ["desk", "phone"]) {
    const { ctx, page } = await openGame(vp, `quality=${q}&view=fixed`);
    const picks = await page.evaluate((vp) => {
      const s = window.__atl.level.spawn.position;
      const list = window.__atl.npcs.list.slice().sort((a, b) => Math.hypot(a.x - s[0], a.z - s[2]) - Math.hypot(b.x - s[0], b.z - s[2]));
      const seen = new Set();
      return list.filter((n) => (seen.has(n.type) ? false : seen.add(n.type))).slice(0, vp === "phone" ? 2 : 3);
    }, vp).catch(() => []);
    for (const n of picks) {
      // Heights over the terrain (the fixed camera adds the ground height).
      await page.evaluate((n) => {
        window.__atl.setFixedCamera(n.x + 4, n.y + 2.2, n.z + 4, n.x, n.y + 0.9, n.z);
      }, n);
      await page.waitForTimeout(500);
      // The crowd moves; aim again at the current position.
      const cur = await page.evaluate((id) => window.__atl.npcs.list.find((m) => m.id === id), n.id);
      await page.evaluate((n) => {
        window.__atl.setFixedCamera(n.x + 4, n.y + 2.2, n.z + 4, n.x, n.y + 0.9, n.z);
      }, cur);
      await page.waitForTimeout(150);
      await shot(page, `${q}-${vp}-npc-${n.type}`, { quality: q, npc: cur, inView: await page.evaluate(() => window.__atl.npcs.inView().length) });
    }
    await ctx.close();
  }
}

// 2. Murals at street level.
{
  const { ctx, page } = await openGame("desk", "quality=low&view=fixed");
  const murals = await page.evaluate(async () => {
    const { loadLevel } = await import("/src/level/levels.js");
    const { muralWalls } = await import("/src/level/geo/geo-mesh.js");
    const { terrainOf } = await import("/src/level/geo/terrain.js");
    const level = await loadLevel("beltline-eastside");
    const t = terrainOf(level);
    return muralWalls(level).map((m) => {
      const cx = (m.a[0] + m.b[0]) / 2;
      const cz = (m.a[1] + m.b[1]) / 2;
      const px = cx + m.n[0] * 18;
      const pz = cz + m.n[1] * 18;
      const gc = t.height(cx, cz);
      const gp = t.height(px, pz);
      const my = (m.y0 + m.y1) / 2;
      return { id: m.id, cell: m.cell, cam: [px, my - gp, pz, cx, my - gc, cz].map((v) => +v.toFixed(2)) };
    });
  });
  await ctx.close();
  rows.push({ name: "murals", count: murals.length, distinctCells: new Set(murals.map((m) => m.cell)).size });
  const pick = [0, 7, 15, 23, 31].map((i) => murals[i]).filter(Boolean);
  for (const [i, m] of pick.entries()) {
    for (const q of i < 2 ? ["high", "low"] : ["high"]) {
      for (const vp of i === 0 ? ["desk", "phone"] : ["desk"]) {
        const { ctx: c, page: p } = await openGame(vp, `quality=${q}&view=fixed&cam=${m.cam.join(",")}`);
        await shot(p, `${q}-${vp}-mural-${i}`, { mural: m.id, cell: m.cell });
        await c.close();
      }
    }
  }
}

// 3. Face decal check in the game: the material on the skinned mesh after
//    loadSkaterModel() and after toonSkater(), as main.js does it.
{
  const ctx = await browser.newContext(VP.desk);
  const page = await ctx.newPage();
  await page.goto(`${base}/skater.html?skater=nia`);
  await page.waitForTimeout(3000);
  const face = await page.evaluate(async () => {
    const { loadSkaterModel } = await import("/src/render/skater-model.js");
    const { toonSkater } = await import("/src/render/toon.js");
    const loaded = await loadSkaterModel("nia");
    const before = { type: loaded.skinnedMesh.material.type, key: loaded.skinnedMesh.material.customProgramCacheKey?.(), normalMap: Boolean(loaded.skinnedMesh.material.normalMap), roughnessMap: Boolean(loaded.skinnedMesh.material.roughnessMap) };
    toonSkater(loaded);
    const m = loaded.skinnedMesh.material;
    const after = { type: m.type, key: m.customProgramCacheKey?.(), normalMap: Boolean(m.normalMap), map: Boolean(m.map) };
    let skinned = 0;
    loaded.root.traverse((o) => { if (o.isSkinnedMesh) skinned += 1; });
    return { faceObject: Boolean(loaded.face), before, after, skinnedMeshesAfterToon: skinned };
  });
  rows.push({ name: "face-decal-check", ...face });
  await ctx.close();
}

// 4. Skater viewer: Nia and Marcus, three views each, plus the Nia face.
for (const skater of ["nia", "marcus"]) {
  for (const view of ["three-quarter", "front", "back", "face"]) {
    const ctx = await browser.newContext(VP.desk);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`viewer ${skater} ${view}: ${e}`));
    await page.goto(`${base}/skater.html?skater=${skater}&view=${view}`);
    await page.waitForFunction(() => window.__skater?.ready || window.__skater?.loaded, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => JSON.parse(JSON.stringify(window.__skater ?? {}, (k, v) => (typeof v === "function" ? undefined : v))));
    await shot(page, `viewer-${skater}-${view}`, { viewer: st });
    await ctx.close();
  }
}
// The phone-size skater in the game, toon on and toon off, close follow cam.
for (const toon of ["1", "0"]) {
  const { ctx, page } = await openGame("phone", `quality=high&toon=${toon}`);
  await shot(page, `high-phone-spawn-toon${toon}`);
  await ctx.close();
}

await browser.close();
writeFileSync(resolve(outDir, "capture2.json"), JSON.stringify({ date: new Date().toISOString(), base, rows, errors }, null, 2));
console.log(JSON.stringify({ n: rows.length, errors, face: rows.find((r) => r.name === "face-decal-check"), murals: rows.find((r) => r.name === "murals") }, null, 2));
