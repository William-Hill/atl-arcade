// Contact sheets of the procedural animation layers (#291). It opens
// anim-fx.html in headless Chromium. Each column pair is one clip with the
// layers ("fx") and without them ("off", the same as ?animfx=0). Each row
// is one time in beats. The page also gives the hip drop (cm) and the head,
// arm, and chest angles (deg) between the two columns of a pair.
//
// Usage: npx vite --port 5191 & node scripts/anim-fx-sheet.mjs [base URL]
// Output: reports/anim-fx/contact-<name>.png and reports/anim-fx/probe.json.

import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:5191";
const SHEETS = [
  { name: "nia", query: "skater=nia" },
  { name: "marcus", query: "skater=marcus" },
  { name: "nia-carve", query: "skater=nia&dances=carve_left,carve_right&beats=1,2,3,4" },
];
mkdirSync("reports/anim-fx", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const probe = {};
for (const s of SHEETS) {
  await page.goto(`${base}/anim-fx.html?${s.query}`);
  await page.waitForFunction(() => window.__fx && (window.__fx.ready || window.__fx.error), null, { timeout: 60000 });
  const err = await page.evaluate(() => window.__fx.error);
  if (err) errors.push(err);
  const info = await page.evaluate(() => window.__fx.sheet(220));
  probe[s.name] = info;
  await page.locator("#stage").screenshot({ path: `reports/anim-fx/contact-${s.name}.png` });
  for (const d of info.diff) console.log(s.name, JSON.stringify(d));
}
await browser.close();
writeFileSync("reports/anim-fx/probe.json", `${JSON.stringify(probe, null, 2)}\n`);
if (errors.length) {
  console.error(errors);
  process.exit(1);
}
