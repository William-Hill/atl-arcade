// Loads the storefront GLBs in headless Chromium (Playwright) through the
// Vite dev server, prints per-file stats (JSON), and saves screenshots.
//   node scripts/assets/storefront-check.mjs [--port 5192] [--mode lineup|street] [--time day|dusk] [--label TEXT] [--out x.png] [--json stats.json]
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const qs = new URLSearchParams({ mode: arg("--mode", "lineup"), time: arg("--time", "day"), label: arg("--label", "") });
if (arg("--files")) qs.set("files", arg("--files"));

const port = Number(arg("--port", 5192));
const server = await createServer({ server: { port, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: Number(arg("--w", 1600)), height: Number(arg("--h", 900)) } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("requestfailed", (r) => errors.push(`request failed ${r.url()}`));
  await page.goto(`http://localhost:${port}/scripts/assets/storefront-check.html?${qs}`);
  await page.waitForFunction(() => window.__result?.ok || window.__error, null, { timeout: 180000 });
  const result = await page.evaluate(() => window.__result);
  if (arg("--out")) await page.screenshot({ path: arg("--out") });
  if (arg("--json")) writeFileSync(arg("--json"), JSON.stringify(result, null, 1) + "\n");
  console.log(JSON.stringify({ ...result, files: result.files.map(({ list, ...f }) => f), errors }, null, 1));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
