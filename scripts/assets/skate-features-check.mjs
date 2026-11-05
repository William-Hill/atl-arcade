// Loads every skate feature GLB in headless Chromium (Playwright) through the
// Vite dev server (Draco), prints per-feature stats as JSON, and saves a
// lineup. Pass page params through: --q "only=rail_kinked&zoom=1.6".
//   node scripts/assets/skate-features-check.mjs --out lineup.png [--size 1920x1080] [--q cols=6&lod1=1] [--json stats.json]
import { writeFileSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const take = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const out = take("--out", null);
const json = take("--json", null);
const q = take("--q", "");
const [w, h] = take("--size", "1920x1080").split("x").map(Number);

const server = await createServer({
  server: { port: 5194, strictPort: true },
  logLevel: "error",
});
await server.listen();
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(
    `http://localhost:5194/scripts/assets/skate-features-check.html?${q}`,
  );
  await page.waitForFunction(() => window.__result?.ok, null, {
    timeout: 300000,
  });
  const result = await page.evaluate(() => window.__result);
  if (out) await page.screenshot({ path: out });
  const text = JSON.stringify({ ...result, errors }, null, 2);
  if (json) writeFileSync(json, text + "\n");
  else console.log(text);
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
