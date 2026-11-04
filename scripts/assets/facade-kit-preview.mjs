// In-context preview of the facade kit in the real PBR renderer, without
// editing shared game code: opens the game on a lab building view, saves a
// BEFORE shot (today's procedural kit), then reloads with ?kit=0 (no
// procedural sills/cornices/signs/awnings), imports
// scripts/assets/facade-kit-preview.js into the page, places the GLB kit on
// the buildings around the camera, and saves an AFTER shot.
//   node scripts/assets/facade-kit-preview.mjs OUT_DIR [kind:labview ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const [outDir = "reports/facade-kit", ...views] = process.argv.slice(2);
const shots = (views.length ? views : ["brick-loft:street", "storefront:corner", "stucco-apartment:street"]).map((v) => v.split(":"));
mkdirSync(outDir, { recursive: true });
const BASE = "level=beltline-eastside&quality=high&look=pbr&date=06-21&time=13.5&weather=clear&governor=0&view=fixed&mute=1";
const server = await createServer({ server: { port: 5193, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const rows = [];
const errors = [];
const label = (page, text) => page.evaluate((t) => {
  const d = document.createElement("div");
  d.textContent = t;
  Object.assign(d.style, { position: "fixed", left: "12px", top: "10px", zIndex: 99999, color: "#fff", background: "rgba(15,18,24,.82)", padding: "6px 10px", font: "600 16px system-ui,sans-serif", borderRadius: "4px" });
  document.body.appendChild(d);
}, text);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const [kind, labview] of shots) {
    const url = `http://localhost:5193/?${BASE}&lab=building&kind=${kind}&labview=${labview}`;
    await page.goto(url, { timeout: 240000, waitUntil: "commit" });
    await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 20, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    const lab = await page.evaluate(() => window.__atl.lab);
    await label(page, `BEFORE: procedural kit today (${kind}, ${labview}) — epic/assets`);
    await page.screenshot({ path: resolve(outDir, `${kind}-${labview}-before.jpg`), type: "jpeg", quality: 85, timeout: 240000 });
    await page.goto(`${url}&kit=0`, { timeout: 240000, waitUntil: "commit" });
    await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 20, null, { timeout: 240000 });
    const info = await page.evaluate(async () => {
      const { previewKit } = await import("/scripts/assets/facade-kit-preview.js");
      const [x, y, z] = window.__atl.cameraPosition;
      return previewKit({ scene: window.__atl.scene, camera: { position: { x, y, z } } });
    }).catch((e) => ({ error: String(e) }));
    await page.waitForTimeout(2500);
    await label(page, `AFTER: GLB facade kit, ?kit=0 + preview injection (${kind}, ${labview})`);
    await page.screenshot({ path: resolve(outDir, `${kind}-${labview}-after.jpg`), type: "jpeg", quality: 85, timeout: 240000 });
    rows.push({ kind, labview, lab, info });
  }
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(resolve(outDir, "preview.json"), JSON.stringify({ rows, errors }, null, 2));
console.log(JSON.stringify({ rows, errors }, null, 2));
