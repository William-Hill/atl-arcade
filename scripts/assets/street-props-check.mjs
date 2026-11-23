// Loads the street prop GLBs in headless Chromium (Playwright) through the
// Vite dev server, prints per-file stats, and saves a lineup screenshot.
//   node scripts/assets/street-props-check.mjs --out assets/vehicles/preview.png assets/vehicles/sedan.glb ...
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const oi = args.indexOf("--out");
const out = oi >= 0 ? args.splice(oi, 2)[1] : null;
const files = args.map((f) => "/" + f.replace(/^\.?\//, ""));

const server = await createServer({ server: { port: 5191, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 600 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://localhost:5191/scripts/assets/street-props-check.html?files=${files.join(",")}`);
  await page.waitForFunction(() => window.__result?.ok, null, { timeout: 120000 });
  const result = await page.evaluate(() => window.__result);
  if (out) await page.screenshot({ path: out });
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
