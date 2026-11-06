// BEFORE/AFTER of the facade kit as the game wires it (pbr look): the same
// camera with ?kitglb=0 (the procedural kit only) and with the GLB kit, plus
// the costs (download, draw calls, triangles) of each, and the toon and
// ?kit=0 checks (no GLB kit there).
//   node scripts/assets/facade-kit-wired.mjs OUT_DIR [kind:labview ...]
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const [outDir = "reports/facade-kit-wired", ...views] = process.argv.slice(2);
const shots = (views.length ? views : ["brick-loft:street", "storefront:corner", "stucco-apartment:street:1"]).map((v) => v.split(":"));
mkdirSync(outDir, { recursive: true });
const BASE = "level=beltline-eastside&quality=high&look=pbr&date=06-21&time=13.5&weather=clear&governor=0&view=fixed&mute=1";
const server = await createServer({ server: { port: 5194, strictPort: true }, logLevel: "error" });
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
const open = async (page, url, glb) => {
  await page.goto(url, { timeout: 300000, waitUntil: "commit" });
  await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 20, null, { timeout: 300000 });
  if (glb) await page.waitForFunction(() => window.__atl.level.facadeGlb?.loaded, null, { timeout: 300000 });
  await page.waitForTimeout(2500);
  return page.evaluate(() => {
    const kit = performance.getEntriesByType("resource").find((e) => e.name.includes("facade-kit") && e.name.includes(".glb"));
    const { ready, ...glb } = window.__atl.level.facadeGlb ?? {};
    return { renderer: window.__atl.rendererInfo, facadeGlb: glb, facadeDepth: window.__atl.level.facadeDepth, glbBytes: kit ? kit.transferSize || kit.encodedBodySize || kit.decodedBodySize : 0 };
  });
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  for (const [kind, labview, pick = "0"] of shots) {
    // pick: the lab building; stucco pick 0 puts the street camera inside a house.
    const url = `http://localhost:5194/?${BASE}&lab=building&kind=${kind}&labview=${labview}&pick=${pick}`;
    const before = await open(page, `${url}&kitglb=0`, false);
    await label(page, `BEFORE: procedural kit only, ?kitglb=0 (${kind}, ${labview})`);
    await page.screenshot({ path: resolve(outDir, `${kind}-${labview}-before.jpg`), type: "jpeg", quality: 85, timeout: 300000 });
    const after = await open(page, url, true);
    await label(page, `AFTER: GLB facade kit wired in, pbr (${kind}, ${labview})`);
    await page.screenshot({ path: resolve(outDir, `${kind}-${labview}-after.jpg`), type: "jpeg", quality: 85, timeout: 300000 });
    rows.push({ kind, labview, before, after });
  }
  const street = `http://localhost:5194/?${BASE}`;
  const before = await open(page, `${street}&kitglb=0`, false);
  await label(page, "BEFORE: procedural kit only, ?kitglb=0 (BeltLine spawn)");
  await page.screenshot({ path: resolve(outDir, "spawn-before.jpg"), type: "jpeg", quality: 85, timeout: 300000 });
  const after = await open(page, street, true);
  await label(page, "AFTER: GLB facade kit wired in, pbr (BeltLine spawn)");
  await page.screenshot({ path: resolve(outDir, "spawn-after.jpg"), type: "jpeg", quality: 85, timeout: 300000 });
  rows.push({ kind: "spawn", labview: "fixed", before, after });
  rows.push({ kind: "toon", after: await open(page, street.replace("look=pbr", "look=toon"), false) });
  rows.push({ kind: "kit0", after: await open(page, `${street}&kit=0`, false) });
} finally {
  writeFileSync(resolve(outDir, "wired.json"), JSON.stringify({ glbFileBytes: statSync("assets/facades/facade-kit.glb").size, rows, errors }, null, 2));
  await browser.close();
  await server.close();
}
console.log(JSON.stringify({ rows, errors }, null, 1));
