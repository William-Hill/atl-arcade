// Final Skate ATL logo (issue #300): option B "Trail Speed", chosen by the owner on 2026-11-21.
// Reads assets/brand/logo-options/option-b-trail-speed.svg (made by logo-options.mjs), crops the
// view box to the ink with an even margin, and writes:
//   assets/brand/logo/skate-atl-logo.svg        vector master
//   assets/brand/logo/skate-atl-logo-1024.png   1024 px wide, transparent
//   assets/brand/logo/skate-atl-logo-32.png     32 px tall check render
// Uses @playwright/test Chromium (a project dev dependency). No image model.
//   node scripts/brand/logo-final.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const SRC = "assets/brand/logo-options/option-b-trail-speed.svg";
const OUT = "assets/brand/logo";
const MARGIN = 0.03; // of the ink width, on every side

mkdirSync(OUT, { recursive: true });
const src = readFileSync(SRC, "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
// The ink box in view box units: draw the SVG on a canvas at 4 px per unit and find the
// pixels with alpha > 0. (getBBox ignores strokes, and client rects of skewed shapes are too big.)
const box = await page.evaluate(async (text) => {
  // Measure in a view box 20 % larger on each side: art past the source view box counts too.
  const v0 = text.match(/viewBox="([^"]*)"/)[1].split(/\s+/).map(Number);
  const vb = [v0[0] - v0[2] * 0.2, v0[1] - v0[3] * 0.2, v0[2] * 1.4, v0[3] * 1.4];
  text = text.replace(/viewBox="[^"]*"/, `viewBox="${vb.join(" ")}"`);
  const k = 4;
  const img = new Image();
  img.src = "data:image/svg+xml;base64," + btoa(text);
  await img.decode();
  const c = document.createElement("canvas");
  c.width = vb[2] * k; c.height = vb[3] * k;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x1 = c.width, y1 = c.height, x2 = -1, y2 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 0) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  }
  return { x: vb[0] + x1 / k, y: vb[1] + y1 / k, w: (x2 + 1 - x1) / k, h: (y2 + 1 - y1) / k,
    touches: { left: x1 === 0, top: y1 === 0, right: x2 === c.width - 1, bottom: y2 === c.height - 1 } };
}, src);
if (Object.values(box.touches).some(Boolean)) throw new Error(`The source art touches its view box edge: ${JSON.stringify(box.touches)}`);
const m = box.w * MARGIN;
const vb = [box.x - m, box.y - m, box.w + 2 * m, box.h + 2 * m].map((v) => +v.toFixed(2));
const svg = src
  .replace(/viewBox="[^"]*"/, `viewBox="${vb.join(" ")}"`)
  .replace(/<title id="t">[^<]*<\/title>/, '<title id="t">Skate ATL</title>');
writeFileSync(`${OUT}/skate-atl-logo.svg`, svg);

async function png(file, size) {
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent"><img id="i" style="${size};display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body>`);
  await page.waitForFunction(() => document.getElementById("i").complete);
  await page.locator("#i").screenshot({ path: `${OUT}/${file}`, omitBackground: true });
  return page.evaluate(() => [document.getElementById("i").width, document.getElementById("i").height]);
}
const big = await png("skate-atl-logo-1024.png", "width:1024px");
const small = await png("skate-atl-logo-32.png", "height:32px");
await browser.close();
console.log(JSON.stringify({ viewBox: vb, png1024: big, png32: small }));
