// Real-GPU pass (#65 graphics and characters audit): the same views on
// ANGLE Metal (Apple GPU), to separate SwiftShader artifacts from real ones.
// Start Vite first:  npx vite --port 5182 --strictPort
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.env.BASE ?? "http://localhost:5182";
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "shots");
const VP = {
  desk: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  land: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
const CAMS = {
  pcm: "-60,14,-700,-218,18,-874",
  "ksm-front": "-12,3,866,-48,7,849",
};
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal"] });
const rows = [];
const errors = [];
async function open(vp, query) {
  const ctx = await browser.newContext(VP[vp]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${vp} ${query}: ${e}`));
  await page.goto(`${base}/?level=beltline-eastside&mute=1&${query}`);
  await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 20 && (window.__atl.skaterModel?.loaded || window.__atl.skaterModel?.error), null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  return { ctx, page };
}
async function shot(page, name, extra = {}) {
  await page.screenshot({ path: resolve(outDir, `${name}.jpg`), type: "jpeg", quality: vpQuality(name) });
  const info = await page.evaluate(() => ({ gpu: window.__atl.gpu, quality: window.__atl.quality, clip: window.__atl.skaterModel?.clip }));
  rows.push({ name, ...info, ...extra });
}
// Phone shots at DPR 3 are large; a lower JPEG quality keeps them under 400 kB.
const vpQuality = (name) => (name.includes("phone") || name.includes("land") ? 60 : 78);

for (const q of ["high", "low"]) {
  for (const vp of ["desk", "phone", "land"]) {
    for (const skater of q === "high" && vp === "phone" ? ["nia", "marcus"] : ["nia"]) {
      const { ctx, page } = await open(vp, `quality=${q}&skater=${skater}`);
      await page.keyboard.down("KeyW");
      await page.waitForTimeout(2000);
      await page.keyboard.up("KeyW");
      await page.waitForTimeout(300);
      await shot(page, `metal-${q}-${vp}-rolling-${skater}`);
      // A dance on the roll-out (Q), the move a phone player sees most.
      await page.keyboard.press("KeyQ");
      await page.waitForTimeout(500);
      await shot(page, `metal-${q}-${vp}-dance-${skater}`);
      await ctx.close();
    }
    if (vp === "land") continue;
    for (const [name, cam] of Object.entries(CAMS)) {
      const { ctx, page } = await open(vp, `quality=${q}&view=fixed&cam=${cam}`);
      await shot(page, `metal-${q}-${vp}-${name}`);
      await ctx.close();
    }
  }
}
// NPCs on a real GPU: the camera height is the ground height plus 2.2 m.
for (const vp of ["desk", "phone"]) {
  const { ctx, page } = await open(vp, "quality=high&view=fixed");
  for (const type of ["skater", "cyclist", "family"]) {
    const ok = await page.evaluate((type) => {
      const s = window.__atl.level.spawn.position;
      const n = window.__atl.npcs.list.filter((m) => m.type === type).sort((a, b) => Math.hypot(a.x - s[0], a.z - s[2]) - Math.hypot(b.x - s[0], b.z - s[2]))[0];
      if (!n) return null;
      const g = window.__atl.level.sample(n.x, n.z)?.height ?? 0;
      window.__atl.setFixedCamera(n.x + 3.5, g + 2.0, n.z + 3.5, n.x, g + 0.9, n.z);
      return { type: n.type, y: n.y, ground: g };
    }, type);
    if (!ok) continue;
    await page.waitForTimeout(120);
    await shot(page, `metal-high-${vp}-npc-${type}`, ok);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(resolve(outDir, "capture-metal.json"), JSON.stringify({ date: new Date().toISOString(), base, rows, errors }, null, 2));
console.log(JSON.stringify({ n: rows.length, gpus: [...new Set(rows.map((r) => r.gpu))], errors }, null, 2));
