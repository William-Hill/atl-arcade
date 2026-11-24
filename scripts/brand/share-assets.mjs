// Share assets for Skate ATL (issue #303): the social card, the favicon set, and the
// load screen art. Every file is a scripted derivation of the brand files from #300
// (assets/brand/). No image model, 0 credits.
//
// Writes into public/ (Vite copies public/ to the site root without a hash, so the
// URLs stay stable for link previews and favicons):
//   public/share/skate-atl-card-1200x630.jpg   Open Graph and X card, from the key art
//   public/favicon.svg                          favicon, vector
//   public/favicon-32.png                       favicon, 32 x 32
//   public/apple-touch-icon.png                 Apple touch icon, 180 x 180, opaque
//   public/brand/loader-art.svg                 load screen art: logo over a skyline
// and a <file>.provenance.json next to each file.
//
//   node scripts/brand/share-assets.mjs
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "@playwright/test";

const LOGO = "assets/brand/logo/skate-atl-logo.svg";
const KEY_ART = "assets/brand/key-art/skate-atl-key-art-1920x1080.png";
const TODAY = "2026-11-23";
const PW = JSON.parse(readFileSync("node_modules/@playwright/test/package.json", "utf8")).version;

// The brand colors (the logo SVG).
export const BRAND = { navy: "#1b1f3b", cream: "#fff6e8", peach: "#f6905a", gold: "#ffc533", teal: "#17a398" };

const logo = readFileSync(LOGO, "utf8");
// The inner art of the logo: everything between the <title> and </svg>.
const logoInner = logo.replace(/^[\s\S]*?<\/title>\s*/, "").replace(/<\/svg>\s*$/, "");
const logoViewBox = logo.match(/viewBox="([^"]*)"/)[1].split(/\s+/).map(Number);

// ---------- The mark: the three trail stripes and the S of the logo ----------
// The logo art is in a skewX(-12) group. A clip in that group keeps the stripes and
// the S, and cuts the K and the rest. The clip is in the skewed units of the group.
const S_CLIP_X = 247; // the gap between the S and the K, in the skewed units
function markSvg({ background = null, size = null } = {}) {
  const art = logoInner
    .replace(/<g transform="translate\(29\.40 0\) skewX\(-12\)">/, `<g transform="translate(29.40 0) skewX(-12)"><clipPath id="s-only"><rect x="0" y="0" width="${S_CLIP_X}" height="400"/></clipPath><g clip-path="url(#s-only)">`)
    // Close the extra clip group before the underline path (the underline is under "ATL").
    .replace(/(<path d="[^"]*" fill="none" stroke="#17a398"[^>]*\/>)<\/g>$/m, "</g>$1</g>")
    // The underline sits under "ATL" only, so the mark leaves it out.
    .replace(/<path d="[^"]*" fill="none" stroke="#17a398"[^>]*\/>/, "");
  // The ink box of the mark, measured once with the measure step below; see MARK_BOX.
  const [x, y, w, h] = MARK_BOX;
  const side = Math.max(w, h);
  const vb = [x - (side - w) / 2, y - (side - h) / 2, side, side].map((v) => +v.toFixed(2));
  const bg = background ? `<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="${background}"/>` : "";
  const dims = size ? ` width="${size}" height="${size}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(" ")}"${dims} role="img" aria-labelledby="t">\n<title id="t">Skate ATL</title>\n${bg}${art}</svg>\n`;
}
let MARK_BOX = [0, 0, 1, 1];

// ---------- The load screen art: the logo over an Atlanta street skyline ----------
// Flat towers in the logo style: navy outline, cream and peach faces, gold windows,
// and the three trail stripes as the ground. Generic shapes, not a copy of any one
// building. The art is 900 x 460 units; the logo fills the top.
function loaderSvg() {
  const W = 900, H = 460;
  const stroke = `stroke="${BRAND.navy}" stroke-width="6" stroke-linejoin="round"`;
  // [x, width, height, fill, roof]: roof "flat", "spire" or "step".
  const towers = [
    [70, 70, 90, BRAND.cream, "flat"],
    [150, 56, 140, BRAND.peach, "step"],
    [216, 80, 110, BRAND.cream, "flat"],
    [306, 60, 175, BRAND.gold, "spire"],
    [376, 92, 128, BRAND.cream, "step"],
    [478, 64, 196, BRAND.peach, "spire"],
    [552, 84, 150, BRAND.cream, "flat"],
    [646, 58, 118, BRAND.teal, "step"],
    [714, 76, 96, BRAND.cream, "flat"],
  ];
  const base = 372;
  let out = "";
  for (const [x, w, h, fill, roof] of towers) {
    const top = base - h;
    let d = `M${x} ${base} L${x} ${top} `;
    if (roof === "spire") d += `L${x + w * 0.3} ${top} L${x + w / 2} ${top - 34} L${x + w * 0.7} ${top} `;
    if (roof === "step") d += `L${x + w * 0.2} ${top} L${x + w * 0.2} ${top - 14} L${x + w * 0.8} ${top - 14} L${x + w * 0.8} ${top} `;
    d += `L${x + w} ${top} L${x + w} ${base} Z`;
    out += `<path d="${d}" fill="${fill}" ${stroke}/>`;
    // Windows: rows of small gold (or cream on gold) slots.
    const win = fill === BRAND.gold || fill === BRAND.peach ? BRAND.cream : BRAND.gold;
    for (let wy = top + 14; wy < base - 18; wy += 22) {
      for (let wx = x + 10; wx + 10 <= x + w - 8; wx += 18) out += `<rect x="${wx}" y="${wy}" width="10" height="12" rx="2" fill="${win}" stroke="${BRAND.navy}" stroke-width="3"/>`;
    }
  }
  // The trail: three skewed stripes, like the logo, across the full width.
  const stripes = [BRAND.peach, BRAND.gold, BRAND.teal]
    .map((c, i) => `<path d="M${30 + i * 18} ${base + 4 + i * 14} L${W - 20 - i * 18} ${base + 4 + i * 14} L${W - 30 - i * 18} ${base + 16 + i * 14} L${20 + i * 18} ${base + 16 + i * 14} Z" fill="${c}" ${stroke.replace('stroke-width="6"', 'stroke-width="4"')}/>`)
    .join("");
  // The logo, 600 units wide, centered at the top.
  const lw = 600, lh = (lw * logoViewBox[3]) / logoViewBox[2];
  const logoSvg = `<svg x="${(W - lw) / 2}" y="0" width="${lw}" height="${lh.toFixed(2)}" viewBox="${logoViewBox.join(" ")}">${logoInner}</svg>`;
  // A navy half disc (a rising sun shape) behind the towers, cut at the ground line.
  const sun = `<path d="M${W / 2 - 170} ${base} A170 170 0 0 1 ${W / 2 + 170} ${base} Z" fill="${BRAND.navy}" opacity="0.55"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t">\n<title id="t">Skate ATL</title>\n<g transform="translate(0 30)">${sun}${out}${stripes}</g>${logoSvg}</svg>\n`;
}

// ---------- Render and write ----------
function sha(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function write(file, buf, meta) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
  const prov = {
    file: file.split("/").pop(),
    generated: TODAY,
    issue: "William-Hill/atl-arcade#303",
    ...meta,
    command: "node scripts/brand/share-assets.mjs",
    prompt: "none (no generative model)",
    credits: { meshy: 0, tripo: 0, imageGeneration: 0, total: 0 },
    license: "Original work for ATL Arcade. Font outlines in the logo remain under the SIL OFL 1.1 (Anton).",
    bytes: buf.length,
    sha256: sha(buf),
  };
  writeFileSync(`${file}.provenance.json`, JSON.stringify(prov, null, 2) + "\n");
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

// Measure the ink box of the mark (the same method as logo-final.mjs: alpha > 0 on a canvas).
MARK_BOX = [logoViewBox[0], logoViewBox[1], logoViewBox[2], logoViewBox[3]];
{
  const probe = markSvg().replace(/viewBox="[^"]*"/, `viewBox="${logoViewBox.join(" ")}"`);
  const box = await page.evaluate(async ({ text, vb }) => {
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
    return [vb[0] + x1 / k, vb[1] + y1 / k, (x2 + 1 - x1) / k, (y2 + 1 - y1) / k];
  }, { text: probe, vb: logoViewBox });
  const m = box[2] * 0.06; // margin on every side
  MARK_BOX = [box[0] - m, box[1] - m, box[2] + 2 * m, box[3] + 2 * m];
}

async function renderSvg(svgText, w, h, { omitBackground = true, type = "png" } = {}) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent"><img id="i" style="width:${w}px;height:${h}px;display:block" src="data:image/svg+xml;base64,${Buffer.from(svgText).toString("base64")}"></body>`);
  await page.waitForFunction(() => document.getElementById("i").complete);
  return page.locator("#i").screenshot({ omitBackground, type });
}

const logoSource = { logo: `${LOGO} (sha256 ${sha(Buffer.from(logo))})` };
const renderTool = `Chromium via @playwright/test ${PW}`;

// 1. The social card: the key art, scaled to 1200 wide (1200 x 675), cropped to 630
//    high. The crop takes 15 px from the top and 30 px from the bottom, so the logo
//    (top left) and the skater keep their places.
{
  const keyArt = readFileSync(KEY_ART);
  const W = 1200, H = 630, top = 15;
  await page.setViewportSize({ width: W, height: H });
  await page.setContent(`<!doctype html><body style="margin:0;overflow:hidden"><div id="c" style="width:${W}px;height:${H}px;overflow:hidden;position:relative"><img id="i" style="position:absolute;left:0;top:-${top}px;width:${W}px;height:675px" src="data:image/png;base64,${keyArt.toString("base64")}"></div></body>`);
  await page.waitForFunction(() => document.getElementById("i").complete);
  const buf = await page.locator("#c").screenshot({ type: "jpeg", quality: 88 });
  write("public/share/skate-atl-card-1200x630.jpg", buf, {
    role: "Open Graph and X (summary_large_image) card for the game link.",
    sizePx: [W, H],
    method: `Scale of the key art to 1200 x 675, crop of ${top} px at the top and ${675 - H - top} px at the bottom. JPEG quality 88.`,
    tool: { script: "scripts/brand/share-assets.mjs", render: renderTool },
    sources: [`${KEY_ART} (sha256 ${sha(keyArt)}); see its provenance: an in-game capture, no image model.`],
  });
}

// 2. The favicon set: the mark (the three stripes and the S of the logo).
{
  const svg = markSvg();
  const meta = {
    method: `The logo SVG with a clip in its skewed group (x < ${S_CLIP_X}): the three trail stripes and the S. The underline is left out. Square view box around the ink, 6 % margin.`,
    tool: { script: "scripts/brand/share-assets.mjs" },
    sources: [logoSource.logo],
  };
  write("public/favicon.svg", Buffer.from(svg), { ...meta, role: "Favicon, vector (transparent).", sizePx: null });
  write("public/favicon-32.png", await renderSvg(svg, 32, 32), { ...meta, role: "Favicon, 32 x 32 PNG (transparent).", sizePx: [32, 32], tool: { ...meta.tool, render: renderTool } });
  const touch = markSvg({ background: BRAND.cream });
  write("public/apple-touch-icon.png", await renderSvg(touch, 180, 180, { omitBackground: false }), {
    ...meta,
    role: "Apple touch icon, 180 x 180 PNG. Opaque cream background (iOS fills a transparent icon with black).",
    sizePx: [180, 180],
    tool: { ...meta.tool, render: renderTool },
  });
}

// 3. The load screen art.
{
  const svg = loaderSvg();
  write("public/brand/loader-art.svg", Buffer.from(svg), {
    role: "Load screen art (index.html #loader, driven by src/ui/loader.js): the logo over a flat skyline and the three trail stripes.",
    sizePx: null,
    method: "Hand-written SVG shapes in the logo style (navy outline, the brand colors), plus the logo art unchanged. Generic towers; no copy of any real building, game, or seal.",
    tool: { script: "scripts/brand/share-assets.mjs" },
    sources: [logoSource.logo],
  });
}

await browser.close();
console.log(JSON.stringify({ markBox: MARK_BOX.map((v) => +v.toFixed(2)) }));
