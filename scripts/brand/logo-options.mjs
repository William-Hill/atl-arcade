// Build the 3 "Skate ATL" wordmark options for issue #300 and their preview sheet.
//
// Every letter is a vector outline from an SIL OFL font (converted to <path> data with
// opentype.js), so the SVG files need no font at run time. All other shapes are drawn here.
// No generative model is used: the same inputs give the same files.
//
// The fonts and opentype.js are not project dependencies. Install them in any folder:
//   npm i --ignore-scripts opentype.js@2.0.0 @fontsource/bungee@5.3.0 \
//     @fontsource/anton@5.3.0 @fontsource/bowlby-one@5.3.0
// Then run:
//   node scripts/brand/logo-options.mjs --deps <that folder> [--out assets/brand/logo-options]
//
// The preview sheet uses the pre-installed Playwright Chromium (require('playwright')).

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
if (!args.deps) throw new Error('Give --deps <folder with opentype.js and @fontsource fonts>');
const OUT = path.resolve(args.out ?? 'assets/brand/logo-options');
const depsRequire = createRequire(path.join(path.resolve(args.deps), 'package.json'));
const opentype = depsRequire('opentype.js');
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(path.join(globalRoot, 'noop.js'))('playwright');

const fontFile = (pkg, name) =>
  depsRequire.resolve(`@fontsource/${pkg}/files/${name}-latin-400-normal.woff`);
const loadFont = (pkg, name) => {
  const buf = fs.readFileSync(fontFile(pkg, name));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const FONTS = {
  bungee: loadFont('bungee', 'bungee'),
  anton: loadFont('anton', 'anton'),
  bowlby: loadFont('bowlby-one', 'bowlby-one'),
};

// Palette: Georgia peach, dogwood cream, BeltLine teal, Ponce mustard gold, night navy ink.
// It follows the district colors in docs/art-direction-pbr.md, brighter for a logo.
const C = {
  ink: '#1b1f3b',
  cream: '#fff6e8',
  peach: '#f6905a',
  coral: '#ec5f4a',
  gold: '#ffc533',
  teal: '#17a398',
  tealDark: '#0f6f6a',
  leaf: '#4f9a4a',
};

// Lay out a word glyph by glyph (kerning + extra tracking in em). Baseline at y = 0, x from 0.
function word(font, text, size, tracking = 0) {
  const glyphs = font.stringToGlyphs(text);
  const scale = size / font.unitsPerEm;
  let x = 0;
  const all = new opentype.Path();
  glyphs.forEach((g, i) => {
    all.extend(g.getPath(x, 0, size));
    x += g.advanceWidth * scale;
    if (i < glyphs.length - 1) x += font.getKerningValue(g, glyphs[i + 1]) * scale + tracking * size;
  });
  const box = all.getBoundingBox();
  return { d: all.toPathData(2), box: { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2, w: box.x2 - box.x1, h: box.y2 - box.y1 } };
}

// Size a word so that its ink width is exactly `width`.
function wordToWidth(font, text, width, tracking = 0) {
  const probe = word(font, text, 100, tracking);
  return word(font, text, (100 * width) / probe.box.w, tracking);
}

// Place a word so that its ink box is centered on (cx, cy). Returns a path element string.
function placed(w, cx, cy, attrs) {
  const tx = cx - (w.box.x1 + w.box.w / 2);
  const ty = cy - (w.box.y1 + w.box.h / 2);
  return `<path transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)})" d="${w.d}" ${attrs}/>`;
}

const svgDoc = (vb, title, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-labelledby="t">\n` +
  `<title id="t">${title}</title>\n${body}\n</svg>\n`;

// ---------- Option A: "Peach Sticker" (Bungee, stacked, die-cut sticker) ----------
function optionA() {
  const W = 660, H = 480, cx = W / 2;
  const atl = wordToWidth(FONTS.bungee, 'ATL', 420, 0.02);
  const skate = wordToWidth(FONTS.bungee, 'SKATE', 420, 0.04);
  const gap = 22;
  const total = skate.box.h + gap + atl.box.h;
  const top = H / 2 - total / 2 + 24;
  const skCy = top + skate.box.h / 2;
  const atCy = top + skate.box.h + gap + atl.box.h / 2;
  const pad = 46;
  const x0 = cx - 210 - pad, y0 = top - pad, w = 420 + 2 * pad, h = total + 2 * pad;
  const text = (dx, dy, fillS, fillA, stroke) =>
    `<g transform="translate(${dx} ${dy})" stroke="${stroke}" stroke-width="16" stroke-linejoin="round" paint-order="stroke">` +
    placed(skate, cx, skCy, `fill="${fillS}"`) + placed(atl, cx, atCy, `fill="${fillA}"`) + '</g>';
  // A small Georgia peach: a round fruit with a blush, a stem, and a green leaf, top right of
  // the sticker. No cleft line: a cleft reads as the peach emoji joke, not as fruit.
  const px = x0 + w - 40, py = y0 + 10;
  const peach =
    `<g transform="translate(${px} ${py}) rotate(14)">` +
    `<defs><radialGradient id="blush" cx="0.3" cy="0.65" r="0.8"><stop offset="0" stop-color="${C.coral}"/><stop offset="0.55" stop-color="${C.peach}"/><stop offset="1" stop-color="${C.gold}"/></radialGradient></defs>` +
    `<path d="M0 -34 C 2 -44, 6 -50, 12 -54" fill="none" stroke="#7a4a2a" stroke-width="6" stroke-linecap="round"/>` +
    `<path d="M6 -46 C 22 -68, 52 -66, 60 -50 C 42 -34, 18 -34, 6 -46 Z" fill="${C.leaf}" stroke="${C.cream}" stroke-width="7" stroke-linejoin="round" paint-order="stroke"/>` +
    `<circle r="38" fill="url(#blush)" stroke="${C.cream}" stroke-width="9" paint-order="stroke"/>` +
    `<ellipse cx="-14" cy="-14" rx="9" ry="6" fill="${C.cream}" opacity="0.55" transform="rotate(-35 -14 -14)"/>` +
    '</g>';
  const body =
    `<g transform="rotate(-6 ${cx} ${H / 2})">` +
    `<rect x="${x0 + 10}" y="${y0 + 12}" width="${w}" height="${h}" rx="44" fill="${C.ink}" opacity="0.35"/>` +
    `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="44" fill="${C.ink}" stroke="${C.cream}" stroke-width="12"/>` +
    text(9, 9, C.coral, C.coral, C.coral) +
    text(0, 0, C.cream, C.gold, C.ink) +
    peach +
    '</g>';
  return { file: 'option-a-peach-sticker.svg', svg: svgDoc(`0 0 ${W} ${H}`, 'Skate ATL, option A: Peach Sticker', body) };
}

// ---------- Option B: "Trail Speed" (Anton, one line, slanted, BeltLine lane stripes) ----------
function optionB() {
  const W = 860, H = 280;
  const size = 190;
  const skate = word(FONTS.anton, 'SKATE', size, 0.02);
  const atl = word(FONTS.anton, 'ATL', size, 0.02);
  const space = 34;
  const stripesW = 150;
  const textW = skate.box.w + space + atl.box.w;
  const left = (W - (stripesW + 26 + textW)) / 2 + stripesW + 26;
  const cy = H / 2;
  const capH = skate.box.h;
  const skCx = left + skate.box.w / 2;
  const atCx = left + skate.box.w + space + atl.box.w / 2;
  // Three lane stripes that taper to the left, behind the "S". Peach, gold, teal.
  const lane = (i, color) => {
    const bandH = capH / 3 - 10;
    const y = cy - capH / 2 + i * (capH / 3) + 5;
    const xR = left + 24, len = stripesW - i * 26;
    return `<path d="M${xR} ${y} L${xR} ${y + bandH} L${xR - len} ${y + bandH} L${xR - len + 22} ${y} Z" fill="${color}" stroke="${C.ink}" stroke-width="8" stroke-linejoin="round" paint-order="stroke"/>`;
  };
  const words = (dx, dy, fS, fA, st) =>
    `<g transform="translate(${dx} ${dy})" stroke="${st}" stroke-width="14" stroke-linejoin="round" paint-order="stroke">` +
    placed(skate, skCx, cy, `fill="${fS}"`) + placed(atl, atCx, cy, `fill="${fA}"`) + '</g>';
  const body =
    `<g transform="translate(${(cy * 0.21).toFixed(2)} 0) skewX(-12)">` +
    lane(0, C.peach) + lane(1, C.gold) + lane(2, C.teal) +
    words(8, 8, C.ink, C.ink, C.ink) +
    words(0, 0, C.cream, C.peach, C.ink) +
    // Underline swoosh under ATL: the trail.
    `<path d="M${atCx - atl.box.w / 2 - 6} ${cy + capH / 2 + 30} Q ${atCx} ${cy + capH / 2 + 18} ${atCx + atl.box.w / 2 + 26} ${cy + capH / 2 + 22}" fill="none" stroke="${C.teal}" stroke-width="12" stroke-linecap="round"/>` +
    '</g>';
  return { file: 'option-b-trail-speed.svg', svg: svgDoc(`0 0 ${W} ${H}`, 'Skate ATL, option B: Trail Speed', body) };
}

// ---------- Option C: "Phoenix Wheel" (Bowlby One, round badge: skate wheel + rising feathers) ----------
function optionC() {
  const S = 512, c = S / 2;
  const atl = wordToWidth(FONTS.bowlby, 'ATL', 372, 0.0);
  const skate = wordToWidth(FONTS.bowlby, 'SKATE', 214, 0.06);
  // A rising phoenix (the bird of the city seal, "Resurgens"): two swept wings in 3 feather
  // layers (coral, peach, gold), a body, a head with a beak. It must read as a bird, not a plant.
  const wing = (k, color) =>
    `<path transform="scale(${k})" d="M4 12 C 40 0, 96 -40, 150 -124 C 158 -84, 144 -64, 122 -58 C 140 -40, 122 -20, 98 -20 C 110 -2, 90 14, 66 12 C 48 26, 24 28, 4 24 Z" fill="${color}" stroke="${C.ink}" stroke-width="${(7 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke"/>`;
  const wings = (side) =>
    `<g transform="scale(${side} 1)">` + wing(1.0, C.coral) + wing(0.8, C.peach) + wing(0.6, C.gold) + '</g>';
  const feathers =
    `<g transform="translate(${c} 214)">` +
    wings(1) + wings(-1) +
    `<path d="M0 -40 C 26 -30, 28 10, 0 40 C -28 10, -26 -30, 0 -40 Z" fill="${C.gold}" stroke="${C.ink}" stroke-width="7" stroke-linejoin="round" paint-order="stroke"/>` +
    `<circle cx="0" cy="-54" r="18" fill="${C.gold}" stroke="${C.ink}" stroke-width="7" paint-order="stroke"/>` +
    `<path d="M12 -61 L 34 -54 L 12 -47 Z" fill="${C.coral}" stroke="${C.ink}" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/>` +
    `<circle cx="4" cy="-58" r="3.5" fill="${C.ink}"/>` +
    '</g>';
  // Wheel: tyre, bearing ring with 12 notches.
  let notches = '';
  for (let i = 0; i < 12; i++) {
    notches += `<rect x="${c - 5}" y="${c - 236}" width="10" height="20" rx="3" fill="${C.ink}" transform="rotate(${i * 30} ${c} ${c})"/>`;
  }
  const atlCy = 318;
  const ribbonY = 410;
  const ribbon =
    `<g transform="rotate(-5 ${c} ${ribbonY})">` +
    `<path d="M${c - 150} ${ribbonY - 34} L${c + 150} ${ribbonY - 34} L${c + 136} ${ribbonY} L${c + 150} ${ribbonY + 34} L${c - 150} ${ribbonY + 34} L${c - 136} ${ribbonY} Z" fill="${C.teal}" stroke="${C.ink}" stroke-width="9" stroke-linejoin="round"/>` +
    placed(skate, c, ribbonY, `fill="${C.cream}"`) +
    '</g>';
  const body =
    `<circle cx="${c}" cy="${c}" r="246" fill="${C.gold}"/>` +
    notches +
    `<circle cx="${c}" cy="${c}" r="214" fill="${C.ink}"/>` +
    `<circle cx="${c}" cy="${c}" r="196" fill="none" stroke="${C.tealDark}" stroke-width="4" stroke-dasharray="2 14" stroke-linecap="round"/>` +
    feathers +
    `<g stroke="${C.ink}" stroke-width="16" stroke-linejoin="round" paint-order="stroke">` +
    placed(atl, c + 7, atlCy + 7, `fill="${C.coral}" stroke="${C.coral}"`) +
    placed(atl, c, atlCy, `fill="${C.cream}"`) +
    '</g>' +
    ribbon;
  return { file: 'option-c-phoenix-wheel.svg', svg: svgDoc(`0 0 ${S} ${S}`, 'Skate ATL, option C: Phoenix Wheel', body) };
}

const options = [
  { ...optionA(), name: 'A. Peach Sticker', font: 'Bungee', fontPkg: '@fontsource/bungee@5.3.0',
    idea: 'Stacked SKATE / ATL on a die-cut sticker, tilted -6 degrees, with a Georgia peach. Sticker energy, not a tag.' },
  { ...optionB(), name: 'B. Trail Speed', font: 'Anton', fontPkg: '@fontsource/anton@5.3.0',
    idea: 'One slanted line with 3 lane stripes and a trail swoosh: speed on the BeltLine. Widest; best for a title bar.' },
  { ...optionC(), name: 'C. Phoenix Wheel', font: 'Bowlby One', fontPkg: '@fontsource/bowlby-one@5.3.0',
    idea: 'Round badge: a skate wheel, the rising phoenix of the city seal (Resurgens), ATL large, SKATE on a ribbon. Best for an app icon.' },
];

fs.mkdirSync(OUT, { recursive: true });
for (const o of options) fs.writeFileSync(path.join(OUT, o.file), o.svg);

// ---------- Preview sheet ----------
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
// Real 32 px tall rasters (DPR 1), shown pixelated on the sheet so the test is honest.
async function raster(svg, height) {
  const html = `<html><body style="margin:0;background:transparent"><img id="i" style="height:${height}px;display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`;
  await page.setContent(html);
  await page.waitForFunction(() => document.getElementById('i').complete);
  const el = await page.$('#i');
  return (await el.screenshot({ omitBackground: true })).toString('base64');
}
const rows = [];
for (const o of options) {
  const r32 = await raster(o.svg, 32);
  const r64 = await raster(o.svg, 64);
  rows.push({ o, r32, r64 });
}
await page.close();

const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font:16px/1.35 'Inter',system-ui,sans-serif;background:#f1ece2;color:${C.ink};width:1600px}
  h1{font-size:30px;margin:0;padding:28px 40px 6px}
  .sub{padding:0 40px 18px;color:#4a4f6a}
  .row{display:grid;grid-template-columns:280px 600px 600px;gap:20px;padding:22px 40px;border-top:2px solid #d9d0bf;align-items:center}
  .label h2{margin:0 0 6px;font-size:22px} .label p{margin:0;color:#4a4f6a;font-size:15px}
  .panel{height:360px;border-radius:14px;position:relative;overflow:hidden}
  .panel img.big{position:absolute;left:50%;top:18px;transform:translateX(-50%)}
  .panel img.big{max-width:540px;max-height:240px}
  .light{background:#ffffff} .dark{background:#11142a}
  .small{position:absolute;left:18px;bottom:14px;display:flex;gap:18px;align-items:flex-end}
  .small img{image-rendering:pixelated} .tag{font-size:12px;opacity:.7;margin-left:4px}
  .dark .tag{color:#fff}
</style></head><body>
<h1>Skate ATL: 3 logo options (issue #300)</h1>
<div class="sub">Each panel: the vector file, then real raster renders at 64 px and 32 px tall (device pixel ratio 1, shown pixelated). Light and dark backgrounds.</div>
${rows.map(({ o, r32, r64 }) => `<div class="row">
  <div class="label"><h2>${o.name}</h2><p>${o.idea}</p><p style="margin-top:8px">Font: ${o.font} (SIL OFL 1.1), outlined.</p></div>
  ${['light', 'dark'].map((bg) => `<div class="panel ${bg}"><img class="big" src="${uri(o.svg)}">
    <div class="small"><img style="height:64px" src="data:image/png;base64,${r64}"><span class="tag">64 px</span>
    <img style="height:32px" src="data:image/png;base64,${r32}"><span class="tag">32 px</span></div></div>`).join('')}
</div>`).join('')}
</body></html>`;
const sp = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 800 } });
await sp.setContent(sheet);
await sp.evaluate(() => document.fonts.ready);
const sheetPath = path.join(OUT, 'preview-sheet.png');
await sp.screenshot({ path: sheetPath, fullPage: true });
// Also keep the 32 px renders as separate files for the 32 px check.
for (const { o, r32 } of rows) fs.writeFileSync(path.join(OUT, o.file.replace('.svg', '-32px.png')), Buffer.from(r32, 'base64'));
await browser.close();

console.log(JSON.stringify(options.map((o) => ({ file: o.file, bytes: Buffer.byteLength(o.svg) })), null, 1));
console.log('sheet', sheetPath);
