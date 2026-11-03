// Masks a reference crop with a polygon: pixels outside it become `bg`
// (a CSS color, for example "rgba(0,0,0,0)" for transparent).
//   node scripts/landmark-mask.mjs <repo-root> <in.png> <out.png> <polygon-json> <bg>

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const [root, src, out, polyJson, bg] = process.argv.slice(2);
const req = createRequire(root + "/package.json");
const { chromium } = req("@playwright/test");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const b64 = readFileSync(src).toString("base64");
const data = await page.evaluate(async ({ b64, poly, bg }) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.save(); g.beginPath(); poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.clip();
  g.drawImage(img, 0, 0); g.restore();
  return c.toDataURL("image/png").split(",")[1];
}, { b64, poly: JSON.parse(polyJson), bg });
writeFileSync(out, Buffer.from(data, "base64"));
await browser.close();
console.log("wrote", out);
