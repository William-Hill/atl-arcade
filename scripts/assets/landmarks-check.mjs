// Loads the landmark GLBs in headless Chromium (Playwright) through the Vite
// dev server, prints per-LOD stats, and saves a lineup (files x LODs).
//   node scripts/assets/landmarks-check.mjs --out x.png [--rows 3] [--yaw 0.75] [--size 1800x900] <glb...>
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const take = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const out = take("--out", null);
const rows = take("--rows", "3");
const yaw = take("--yaw", "0.75");
const [w, h] = take("--size", "1800x900").split("x").map(Number);
const files = args.map((f) => "/" + f.replace(/^\.?\//, ""));

const server = await createServer({ server: { port: 5192, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://localhost:5192/scripts/assets/landmarks-check.html?rows=${rows}&yaw=${yaw}&files=${files.join(",")}`);
  await page.waitForFunction(() => window.__result?.ok, null, { timeout: 300000 });
  const result = await page.evaluate(() => window.__result);
  if (out) await page.screenshot({ path: out });
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
