// High-tier load check. Every PR must load the high tier (PR #123 once made
// it hang). It serves a built dist folder with `vite preview`, opens
// /?level=beltline-eastside&quality=high&governor=0&view=fixed in headless
// Chromium (SwiftShader), and waits for 5 frames.
//   node scripts/high-tier-check.mjs <dist> [port]
import { preview } from "vite";
import { chromium } from "@playwright/test";
const dist = process.argv[2];
const port = Number(process.argv[3] ?? 5751);
const server = await preview({ build: { outDir: dist }, preview: { port, strictPort: true }, logLevel: "silent" });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const t0 = Date.now();
await page.goto(`http://localhost:${port}/?level=beltline-eastside&quality=high&governor=0&view=fixed&mute=1`);
let ok = true;
try {
  await page.waitForFunction(() => window.__atl && window.__atl.frames >= 5, null, { timeout: 30000 });
} catch {
  ok = false;
}
const ms = Date.now() - t0;
const info = await page.evaluate(() => ({ frames: window.__atl?.frames, quality: window.__atl?.render?.quality, props: window.__atl?.level?.props, r: window.__atl?.rendererInfo }));
console.log(JSON.stringify({ ok, ms, ...info, errors }));
await browser.close();
await new Promise((done) => server.httpServer.close(done));
