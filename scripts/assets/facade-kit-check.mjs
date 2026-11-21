// Loads assets/facades/facade-kit.glb in headless Chromium (Playwright)
// through the Vite dev server, prints per-node stats, and saves labeled
// lineup screenshots.
//   node scripts/assets/facade-kit-check.mjs --out lineup.png [--lod1 lod1.png]
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const out = arg("--out");
const lod1 = arg("--lod1");

const server = await createServer({ server: { port: 5192, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const errors = [];
  let result = null;
  for (const [view, path] of [["lineup", out], ["lod1", lod1]]) {
    if (view === "lod1" && !path) continue;
    const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`http://localhost:5192/scripts/assets/facade-kit-check.html?view=${view}`);
    await page.waitForFunction(() => window.__result?.ok, null, { timeout: 180000 });
    result ??= await page.evaluate(() => window.__result);
    if (path) await page.screenshot({ path });
    await page.close();
  }
  console.log(JSON.stringify({ ...result, errors }, null, 1));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
