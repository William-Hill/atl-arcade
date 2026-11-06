// A quick check of the pbr look (#157, #160): one fixed camera, the frame,
// the renderer counts, the material audit (no toon material left), and the
// pbr light state. Smaller than pbr-frames.mjs, for tuning on a software GPU.
//   node scripts/art/pbr-check.mjs --out dir --w 640 --h 360 name=x,h,z,tx,th,tz[@k=v&k=v] ...
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
}
const out = opt("--out", "frames");
const port = Number(opt("--port", "5197"));
const w = Number(opt("--w", "640"));
const h = Number(opt("--h", "360"));
const extra = opt("--params", "");
mkdirSync(out, { recursive: true });
const BASE = { level: "beltline-eastside", quality: "high", look: "pbr", date: "06-21", time: "13.5", weather: "clear", governor: "0", view: "fixed", mute: "1", npcs: "0", cars: "0" };
const server = await createServer({ server: { port, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const log = [];
try {
  for (const spec of args) {
    // Split on the first "=" only: the params after "@" have their own.
    const name = spec.slice(0, spec.indexOf("="));
    const rest = spec.slice(spec.indexOf("=") + 1);
    const [cam, more = ""] = rest.split("@");
    const q = new URLSearchParams({ ...BASE, ...Object.fromEntries(new URLSearchParams(extra)), ...Object.fromEntries(new URLSearchParams(more)), cam });
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.setDefaultTimeout(900000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`http://localhost:${port}/?${q}`, { waitUntil: "commit" });
    await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 8, null, { timeout: 900000 });
    await page.waitForTimeout(4000);
    const f = await page.evaluate(() => window.__atl.frames);
    await page.waitForFunction((f0) => window.__atl.frames > f0 + 4, f, { timeout: 900000 });
    await page.addStyleTag({ content: "* { visibility: hidden !important; } #stage { visibility: visible !important; }" });
    const t0 = Date.now();
    const f1 = await page.evaluate(() => window.__atl.frames);
    await page.waitForFunction((f0) => window.__atl.frames > f0 + 3, f1, { timeout: 900000 });
    const frameMs = (Date.now() - t0) / 4;
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 900000 });
    const info = await page.evaluate(() => ({ renderer: window.__atl.rendererInfo, materials: window.__atl.materials, pbrLook: window.__atl.pbrLook, look: window.__atl.look, quality: window.__atl.quality }));
    const entry = { name, url: `/?${q}`, frameMs: Math.round(frameMs), errors, ...info };
    log.push(entry);
    console.log(JSON.stringify({ name, frameMs: entry.frameMs, renderer: info.renderer, toon: info.materials.toon, counts: info.materials.counts, district: info.pbrLook?.district, grade: info.pbrLook?.grade, errors }));
    await page.close();
  }
} finally {
  writeFileSync(`${out}/check-log-${Date.now()}.json`, JSON.stringify(log, null, 2) + "\n");
  await browser.close();
  await server.close();
}
process.exit(0);
