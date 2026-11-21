// Paints the storefront sign atlas (1024 x 1024) in headless Chromium with the
// 2D canvas: original typography in the system fonts (DejaVu, Liberation,
// Bitstream Charter, Utopia, FreeSerif/FreeSans) and vector illustrations
// drawn from code. No photos, no third-party art, no real business names.
//   node scripts/assets/storefront-atlas.mjs [--out assets/storefronts]
// Writes storefront-atlas.jpg (sRGB) and storefront-atlas.json (pixel rects of
// every region and the swatches), read by scripts/blender/storefronts.py.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(here, "../../assets/storefronts");
const data = JSON.parse(await readFile(join(here, "storefront-businesses.json"), "utf8"));

const SIZE = 1024;
// Fixed layout (pixels, [x, y, w, h]). The Blender script reads these rects.
const regions = {};
data.businesses.forEach((b, i) => {
  regions[`board_${b.id}`] = [(i % 2) * 384, Math.floor(i / 2) * 96, 384, 96];
  regions[`blade_${b.id}`] = [768 + (i % 2) * 128, Math.floor(i / 2) * 96, 128, 96];
});
const neons = [
  ...data.businesses.filter((b) => b.neon).map((b) => ({ id: b.id, text: b.neon, color: b.neonColor, color2: b.accent, kind: b.kind })),
  ...data.neonExtra.map((n) => ({ ...n, kind: n.id })),
];
neons.forEach((n, j) => (regions[`neon_${n.id}`] = [(j % 4) * 256, 480 + Math.floor(j / 4) * 128, 256, 128]));
const menus = data.businesses.filter((b) => b.menu);
menus.forEach((b, k) => (regions[`menu_${b.id}`] = [k * 128, 736, 128, 208]));
const sandwiches = data.businesses.filter((b) => b.sandwich);
sandwiches.forEach((b, s) => (regions[`sandwich_${b.id}`] = [768 + (s % 2) * 128, 736 + Math.floor(s / 2) * 144, 128, 144]));
// Solid swatches for the neon tubes, the bulbs, and the lit faces.
const SWATCHES = { white: "#ffffff", warm: "#ffd9a0", bulb: "#ffc477", pink: "#ff4fa3", orange: "#ff7a1f", red: "#ff3b30", teal: "#3fe0d0", gold: "#ffc23a", purple: "#c56bff", blue: "#3fb7ff", green: "#6dff8a", cream: "#fff1d6" };
const swatches = {};
Object.entries(SWATCHES).forEach(([k, c], i) => (swatches[k] = { rect: [i * 64, 944, 64, 80], color: c }));

const MENUS = {
  taqueria: [["Al Pastor", "3.5"], ["Carnitas", "3.5"], ["Hongos", "3"], ["Elote", "4"], ["Torta", "9"], ["Horchata", "3"], ["Jamaica", "3"]],
  bbq: [["Brisket", "14"], ["Pulled Pork", "11"], ["Smoked Wings", "10"], ["Mac & Cheese", "4"], ["Collards", "4"], ["Cornbread", "3"], ["Peach Cobbler", "5"]],
  pizza: [["Cheese Slice", "3.5"], ["Pepperoni", "4"], ["Veggie", "4"], ["Hot Honey", "4.5"], ["Whole Pie", "22"], ["Garlic Knots", "5"], ["Lemonade", "3"]],
  coffee: [["Drip", "3"], ["Espresso", "3.5"], ["Latte", "5"], ["Peach Cold Brew", "5.5"], ["Chai", "4.5"], ["Biscotti", "2.5"], ["Hot Cocoa", "3.5"]],
  creamery: [["Georgia Peach", "5"], ["Pecan Praline", "5"], ["Vanilla Bean", "4.5"], ["Strawberry", "4.5"], ["Mint Chip", "4.5"], ["Waffle Cone", "+1"], ["Float", "6"]],
  bakery: [["Butter Biscuit", "3"], ["Chicken Biscuit", "7"], ["Peach Hand Pie", "4"], ["Pimento Biscuit", "4"], ["Sweet Potato Pie", "5"], ["Sweet Tea", "2.5"], ["Lemonade", "3"]],
};
const BOARDS = {
  coffee: { head: "TODAY", lines: ["PEACH", "COLD BREW"], foot: "& warm biscotti" },
  books: { head: "STORY HOUR", lines: ["SAT 10AM", "ALL AGES"], foot: "staff picks inside" },
  records: { head: "LISTENING", lines: ["HOUR", "4 PM"], foot: "crate diggers welcome" },
  skate: { head: "RENT", lines: ["SKATES", "HERE"], foot: "helmets & pads incl." },
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(`<canvas id="c" width="${SIZE}" height="${SIZE}"></canvas>`);
  const jpeg = await page.evaluate(paint, { SIZE, regions, swatches, businesses: data.businesses, neons, menus, sandwiches, MENUS, BOARDS });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "storefront-atlas.jpg"), Buffer.from(jpeg.split(",")[1], "base64"));
  await writeFile(join(out, "storefront-atlas.json"), JSON.stringify({ size: SIZE, image: "storefront-atlas.jpg", regions, swatches, businesses: data.businesses.map((b) => b.id) }, null, 1));
  console.log(`wrote ${join(out, "storefront-atlas.jpg")} (${Object.keys(regions).length} regions)`);
} finally {
  await browser.close();
}

// ---- runs in the page ------------------------------------------------------
function paint({ SIZE, regions, swatches, businesses, neons, menus, sandwiches, MENUS, BOARDS }) {
  const cv = document.getElementById("c");
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#202020";
  ctx.fillRect(0, 0, SIZE, SIZE);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const font = (b, s) => b.font.replace("{s}", s);
  const fit = (text, tmpl, max, size, min = 6) => {
    let s = size;
    ctx.font = tmpl(s);
    while (ctx.measureText(text).width > max && s > min) ctx.font = tmpl((s -= 1));
    return s;
  };
  const rr = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };
  const clip = ([x, y, w, h], fn) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    fn(x, y, w, h);
    ctx.restore();
  };

  // A pen: `fill` paints a shape (sign mode) or strokes it as a neon tube
  // (neon mode) in one of two tube colors.
  let NEON = null;
  function shape(path, fill, tube = 0, outline = null) {
    ctx.beginPath();
    path();
    if (NEON) {
      tubeStroke(NEON[tube % NEON.length]);
      return;
    }
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (outline) {
      ctx.strokeStyle = outline[0];
      ctx.lineWidth = outline[1];
      ctx.stroke();
    }
  }
  function line(path, color, width, tube = 0) {
    ctx.beginPath();
    path();
    if (NEON) return tubeStroke(NEON[tube % NEON.length]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  function tubeStroke(color, w = 3.2) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    for (const [lw, blur, a] of [[w * 3.2, 18, 0.35], [w * 1.6, 8, 0.9]]) {
      ctx.globalAlpha = a;
      ctx.shadowBlur = blur;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 4;
    ctx.lineWidth = w * 0.7;
    ctx.strokeStyle = "#fff6f0";
    ctx.stroke();
    ctx.restore();
  }

  // ---- illustrations (center cx, cy; size s ~ height) ----
  const ICON = {
    taqueria(cx, cy, s, b) {
      const r = s * 0.5;
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2;
        line(() => { ctx.moveTo(cx + Math.cos(a) * r * 0.62, cy - s * 0.08 + Math.sin(a) * r * 0.62); ctx.lineTo(cx + Math.cos(a) * r * 0.86, cy - s * 0.08 + Math.sin(a) * r * 0.86); }, b.accent, s * 0.06, 1);
      }
      shape(() => ctx.arc(cx, cy - s * 0.08, r * 0.5, 0, Math.PI * 2), b.accent, 1);
      // Taco: a shell half-ellipse with lettuce and tomato.
      line(() => { for (let i = 0; i <= 8; i += 1) { const x = cx - r * 0.78 + (i / 8) * r * 1.56; const y = cy + s * 0.08 - Math.sin((i / 8) * Math.PI) * r * 0.34 + (i % 2 ? -s * 0.04 : 0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } }, "#5dbb4a", s * 0.09, 1);
      shape(() => { ctx.ellipse(cx, cy + s * 0.2, r * 0.82, r * 0.5, 0, Math.PI, 0); ctx.closePath(); }, "#f3c35b", 0, ["#a86a1e", s * 0.03]);
      for (const dx of [-0.4, 0, 0.4]) shape(() => ctx.arc(cx + dx * r, cy + s * 0.02, s * 0.045, 0, Math.PI * 2), b.accent2, 0);
    },
    bbq(cx, cy, s, b) {
      shape(() => { ctx.moveTo(cx - s * 0.14, cy + s * 0.45); ctx.lineTo(cx - s * 0.1, cy - s * 0.18); ctx.lineTo(cx + s * 0.1, cy - s * 0.18); ctx.lineTo(cx + s * 0.14, cy + s * 0.45); ctx.closePath(); }, "#a8432f", 1);
      if (!NEON) for (let k = 0; k < 6; k += 1) line(() => { const y = cy - s * 0.1 + k * s * 0.1; ctx.moveTo(cx - s * 0.13, y); ctx.lineTo(cx + s * 0.13, y); }, "#6e2a1d", 1.2);
      shape(() => rr(cx - s * 0.14, cy - s * 0.24, s * 0.28, s * 0.07, 2), b.fg, 1);
      line(() => { ctx.moveTo(cx, cy - s * 0.27); ctx.bezierCurveTo(cx - s * 0.25, cy - s * 0.4, cx + s * 0.3, cy - s * 0.42, cx + s * 0.05, cy - s * 0.55); ctx.bezierCurveTo(cx - s * 0.12, cy - s * 0.62, cx + s * 0.3, cy - s * 0.7, cx + s * 0.38, cy - s * 0.6); }, "#d9cfc2", s * 0.07, 0);
      shape(() => { ctx.moveTo(cx + s * 0.3, cy + s * 0.45); ctx.quadraticCurveTo(cx + s * 0.18, cy + s * 0.25, cx + s * 0.32, cy + s * 0.08); ctx.quadraticCurveTo(cx + s * 0.36, cy + s * 0.24, cx + s * 0.44, cy + s * 0.2); ctx.quadraticCurveTo(cx + s * 0.48, cy + s * 0.36, cx + s * 0.38, cy + s * 0.45); ctx.closePath(); }, b.accent, 0);
    },
    pizza(cx, cy, s, b) {
      const top = cy - s * 0.38, bot = cy + s * 0.46, hw = s * 0.36;
      shape(() => { ctx.moveTo(cx - hw, top); ctx.lineTo(cx + hw, top); ctx.lineTo(cx, bot); ctx.closePath(); }, "#f6cf5a", 1, ["#b8742c", s * 0.03]);
      shape(() => rr(cx - hw - s * 0.03, top - s * 0.1, hw * 2 + s * 0.06, s * 0.12, s * 0.05), "#b8742c", 0);
      if (!NEON) for (let k = 0; k < 7; k += 1) line(() => { const x = cx - hw + k * (hw * 2) / 6; ctx.moveTo(x, top - s * 0.1); ctx.lineTo(x, top + s * 0.02); }, "#6b3d17", 1.4);
      for (const [dx, dy] of [[-0.14, -0.2], [0.13, -0.18], [0, 0.02], [-0.04, 0.22]]) shape(() => ctx.arc(cx + dx * s, cy + dy * s, s * 0.065, 0, Math.PI * 2), b.accent2 === "#3f8a3a" ? "#c0362c" : b.accent2, 0);
      if (!NEON) for (const [dx, dy] of [[0.04, -0.28], [-0.08, -0.06]]) shape(() => ctx.ellipse(cx + dx * s, cy + dy * s, s * 0.04, s * 0.02, 0.6, 0, Math.PI * 2), "#3f8a3a");
    },
    coffee(cx, cy, s, b) {
      for (const dx of [-0.12, 0.02, 0.16]) line(() => { const x = cx + dx * s; ctx.moveTo(x, cy - s * 0.12); ctx.bezierCurveTo(x - s * 0.08, cy - s * 0.25, x + s * 0.08, cy - s * 0.32, x, cy - s * 0.46); }, b.accent2, s * 0.045, 1);
      shape(() => { ctx.moveTo(cx - s * 0.3, cy - s * 0.06); ctx.lineTo(cx + s * 0.3, cy - s * 0.06); ctx.quadraticCurveTo(cx + s * 0.28, cy + s * 0.3, cx + s * 0.12, cy + s * 0.32); ctx.lineTo(cx - s * 0.12, cy + s * 0.32); ctx.quadraticCurveTo(cx - s * 0.28, cy + s * 0.3, cx - s * 0.3, cy - s * 0.06); ctx.closePath(); }, b.accent, 0);
      line(() => ctx.arc(cx + s * 0.32, cy + s * 0.08, s * 0.1, -Math.PI / 2, Math.PI / 2), b.accent, s * 0.05, 0);
      shape(() => ctx.ellipse(cx, cy + s * 0.36, s * 0.42, s * 0.05, 0, 0, Math.PI * 2), b.fg, 1);
      if (!NEON) for (const dy of [0.44, 0.5]) line(() => { ctx.moveTo(cx - s * 0.46, cy + dy * s); ctx.lineTo(cx + s * 0.46, cy + dy * s); }, b.fg, 1.6);
    },
    brewery(cx, cy, s, b) {
      const rows = [[0, -0.3, 0.13], [-0.1, -0.12, 0.13], [0.1, -0.12, 0.13], [-0.13, 0.06, 0.12], [0.13, 0.06, 0.12], [0, 0.0, 0.13], [-0.07, 0.22, 0.11], [0.07, 0.22, 0.11], [0, 0.36, 0.09]];
      for (const [dx, dy, r] of rows) shape(() => { ctx.moveTo(cx + dx * s - r * s, cy + dy * s); ctx.quadraticCurveTo(cx + dx * s, cy + dy * s + r * s * 1.5, cx + dx * s + r * s, cy + dy * s); ctx.quadraticCurveTo(cx + dx * s, cy + dy * s - r * s * 0.4, cx + dx * s - r * s, cy + dy * s); }, b.accent2, 0, ["#2f5a2a", 1.2]);
      line(() => { ctx.moveTo(cx, cy - s * 0.36); ctx.quadraticCurveTo(cx + s * 0.05, cy - s * 0.5, cx + s * 0.2, cy - s * 0.5); }, b.accent, s * 0.05, 1);
      shape(() => ctx.ellipse(cx + s * 0.3, cy - s * 0.42, s * 0.12, s * 0.06, -0.4, 0, Math.PI * 2), b.accent2, 1);
    },
    creamery(cx, cy, s, b) {
      shape(() => { ctx.moveTo(cx - s * 0.22, cy - s * 0.02); ctx.lineTo(cx + s * 0.22, cy - s * 0.02); ctx.lineTo(cx, cy + s * 0.5); ctx.closePath(); }, "#d9a25a", 1, ["#9b6a2c", 1.5]);
      if (!NEON) for (let k = -2; k <= 2; k += 1) { line(() => { ctx.moveTo(cx + k * s * 0.09 - s * 0.05, cy - s * 0.02); ctx.lineTo(cx + k * s * 0.09 + s * 0.12, cy + s * 0.3); }, "#9b6a2c", 1.2); line(() => { ctx.moveTo(cx + k * s * 0.09 + s * 0.05, cy - s * 0.02); ctx.lineTo(cx + k * s * 0.09 - s * 0.12, cy + s * 0.3); }, "#9b6a2c", 1.2); }
      shape(() => { ctx.arc(cx, cy - s * 0.16, s * 0.25, Math.PI * 0.95, Math.PI * 2.05); ctx.lineTo(cx + s * 0.25, cy - s * 0.02); for (const [dx, dl] of [[0.17, 0.14], [0.06, 0.06], [-0.05, 0.18], [-0.16, 0.08]]) { ctx.lineTo(cx + (dx + 0.04) * s, cy - s * 0.02); ctx.arc(cx + dx * s, cy + dl * s - s * 0.02, s * 0.04, 0, Math.PI); ctx.lineTo(cx + (dx - 0.04) * s, cy - s * 0.02); } ctx.lineTo(cx - s * 0.25, cy - s * 0.02); ctx.closePath(); }, "#f59a6b", 0, ["#d8643f", 1.5]);
      if (!NEON) line(() => ctx.arc(cx - s * 0.06, cy - s * 0.2, s * 0.13, Math.PI * 1.1, Math.PI * 1.6), "#ffd0b0", 2.5);
      shape(() => ctx.ellipse(cx + s * 0.14, cy - s * 0.44, s * 0.1, s * 0.045, -0.6, 0, Math.PI * 2), b.accent2, 1);
    },
    books(cx, cy, s, b) {
      shape(() => { ctx.moveTo(cx, cy + s * 0.12); ctx.quadraticCurveTo(cx - s * 0.2, cy + s * 0.02, cx - s * 0.46, cy + s * 0.1); ctx.lineTo(cx - s * 0.46, cy + s * 0.42); ctx.quadraticCurveTo(cx - s * 0.2, cy + s * 0.34, cx, cy + s * 0.44); ctx.quadraticCurveTo(cx + s * 0.2, cy + s * 0.34, cx + s * 0.46, cy + s * 0.42); ctx.lineTo(cx + s * 0.46, cy + s * 0.1); ctx.quadraticCurveTo(cx + s * 0.2, cy + s * 0.02, cx, cy + s * 0.12); ctx.closePath(); }, "#f6efe0", 1, ["#b99c6b", 1.5]);
      if (!NEON) line(() => { ctx.moveTo(cx, cy + s * 0.12); ctx.lineTo(cx, cy + s * 0.44); }, "#b99c6b", 1.5);
      for (let k = 0; k < 4; k += 1) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const px = cx + Math.cos(a) * s * 0.17, py = cy - s * 0.2 + Math.sin(a) * s * 0.17;
        shape(() => { ctx.ellipse(px, py, s * 0.15, s * 0.11, a, 0, Math.PI * 2); }, b.accent, 0, ["#c98a98", 1.2]);
        if (!NEON) shape(() => ctx.arc(cx + Math.cos(a) * s * 0.3, cy - s * 0.2 + Math.sin(a) * s * 0.3, s * 0.03, 0, Math.PI * 2), "#a8475b");
      }
      shape(() => ctx.arc(cx, cy - s * 0.2, s * 0.07, 0, Math.PI * 2), "#8bb35a", 1);
    },
    records(cx, cy, s, b) {
      const r = s * 0.46;
      shape(() => ctx.arc(cx, cy, r, 0, Math.PI * 2), "#141414", 1);
      if (!NEON) for (let k = 0; k < 5; k += 1) line(() => ctx.arc(cx, cy, r * (0.55 + k * 0.09), 0, Math.PI * 2), "#3a3a3a", 1);
      if (!NEON) line(() => ctx.arc(cx, cy, r * 0.8, -1.2, -0.4), "#8d8d8d", 1.5);
      shape(() => ctx.arc(cx, cy, r * 0.36, 0, Math.PI * 2), b.accent, 0);
      for (let k = 0; k < 8; k += 1) {
        const a = (k / 8) * Math.PI * 2;
        line(() => { ctx.moveTo(cx + Math.cos(a) * r * 0.12, cy + Math.sin(a) * r * 0.12); ctx.lineTo(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3); }, b.accent2, 1.6, 0);
      }
      shape(() => ctx.arc(cx, cy, r * 0.05, 0, Math.PI * 2), "#141414", 1);
    },
    skate(cx, cy, s, b) {
      shape(() => { ctx.moveTo(cx - s * 0.3, cy - s * 0.42); ctx.lineTo(cx - s * 0.02, cy - s * 0.42); ctx.lineTo(cx + s * 0.02, cy - s * 0.06); ctx.quadraticCurveTo(cx + s * 0.4, cy - s * 0.02, cx + s * 0.44, cy + s * 0.14); ctx.lineTo(cx + s * 0.44, cy + s * 0.2); ctx.lineTo(cx - s * 0.34, cy + s * 0.2); ctx.closePath(); }, b.fg, 0, ["#1d5f86", 1.5]);
      if (!NEON) for (let k = 0; k < 3; k += 1) line(() => { ctx.moveTo(cx - s * 0.06, cy - s * 0.34 + k * s * 0.1); ctx.lineTo(cx + s * 0.06, cy - s * 0.3 + k * s * 0.1); }, b.accent2, 2);
      shape(() => rr(cx - s * 0.36, cy + s * 0.2, s * 0.82, s * 0.06, 2), "#555", 1);
      for (const dx of [-0.22, 0.3]) shape(() => ctx.arc(cx + dx * s, cy + s * 0.36, s * 0.1, 0, Math.PI * 2), b.accent, 1, ["#7a6a10", 1.2]);
      shape(() => ctx.arc(cx + s * 0.48, cy + s * 0.28, s * 0.05, 0, Math.PI * 2), b.accent2, 0);
    },
    bakery(cx, cy, s, b) {
      shape(() => rr(cx - s * 0.36, cy - s * 0.02, s * 0.62, s * 0.22, s * 0.1), "#e3b26b", 0, ["#a8692e", 1.5]);
      shape(() => rr(cx - s * 0.34, cy + s * 0.22, s * 0.6, s * 0.2, s * 0.1), "#d79a4f", 0, ["#a8692e", 1.5]);
      if (!NEON) line(() => { ctx.moveTo(cx - s * 0.3, cy + s * 0.08); ctx.lineTo(cx + s * 0.2, cy + s * 0.08); }, "#fbe6b8", 2);
      shape(() => ctx.ellipse(cx - s * 0.04, cy + s * 0.215, s * 0.3, s * 0.035, 0, 0, Math.PI * 2), "#ffe48a", 1);
      // Honeysuckle: a slim trumpet with long stamens, and a leaf.
      line(() => { ctx.moveTo(cx + s * 0.12, cy - s * 0.12); ctx.quadraticCurveTo(cx + s * 0.25, cy - s * 0.3, cx + s * 0.42, cy - s * 0.38); }, "#fffaf0", s * 0.07, 1);
      for (const a of [-0.6, -0.2, 0.2]) line(() => { ctx.moveTo(cx + s * 0.42, cy - s * 0.38); ctx.lineTo(cx + s * 0.42 + Math.cos(a - 1.2) * s * 0.16, cy - s * 0.38 + Math.sin(a - 1.2) * s * 0.16); }, "#f6c84b", 1.6, 1);
      shape(() => ctx.ellipse(cx + s * 0.08, cy - s * 0.28, s * 0.1, s * 0.045, -0.8, 0, Math.PI * 2), b.accent2, 0);
    },
    open(cx, cy, s) {
      shape(() => rr(cx - s * 0.5, cy - s * 0.3, s, s * 0.6, s * 0.12), null, 1);
    },
  };

  // ---- fascia boards ----
  for (const b of businesses) {
    clip(regions[`board_${b.id}`], (x, y, w, h) => {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, b.bg);
      g.addColorStop(1, shade(b.bg, -0.12));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      grain(x, y, w, h, 0.05);
      ctx.strokeStyle = b.accent;
      ctx.lineWidth = 2.5;
      rr(x + 7, y + 7, w - 14, h - 14, 6);
      ctx.stroke();
      ctx.lineWidth = 1;
      rr(x + 11, y + 11, w - 22, h - 22, 4);
      ctx.stroke();
      // Medallion with the illustration.
      const mx = x + 54, my = y + h / 2;
      ctx.fillStyle = shade(b.bg, 0.14);
      ctx.beginPath();
      ctx.arc(mx, my, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = b.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ICON[b.kind](mx, my, 50, b);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const tx = x + 92 + (w - 104) / 2;
      fit(b.name, (s) => font(b, s), w - 112, 38);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillText(b.name, tx + 1.5, y + 55 + 1.5);
      ctx.fillStyle = b.fg;
      ctx.fillText(b.name, tx, y + 55);
      fit(b.tagline, (s) => `700 ${s}px 'DejaVu Sans'`, w - 130, 11.5);
      ctx.fillStyle = b.accent;
      ctx.fillText(b.tagline, tx, y + 76);
    });
  }

  // ---- blade signs ----
  for (const b of businesses) {
    clip(regions[`blade_${b.id}`], (x, y, w, h) => {
      ctx.fillStyle = b.bg;
      ctx.fillRect(x, y, w, h);
      grain(x, y, w, h, 0.05);
      ctx.strokeStyle = b.accent;
      ctx.lineWidth = 3;
      // The panel outline matches the blade geometry (storefronts.py BLADE).
      if (b.blade === "round") {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2 - 6, h / 2 - 6, 0, 0, Math.PI * 2);
      } else if (b.blade === "shield") {
        ctx.beginPath();
        ctx.moveTo(x + 6, y + h - 6);
        ctx.lineTo(x + 6, y + 30);
        ctx.quadraticCurveTo(x + w / 2, y - 4, x + w - 6, y + 30);
        ctx.lineTo(x + w - 6, y + h - 6);
        ctx.closePath();
      } else rr(x + 6, y + 6, w - 12, h - 12, 5);
      ctx.stroke();
      ICON[b.kind](x + w / 2, y + 38, 40, b);
      ctx.textAlign = "center";
      fit(b.short, (s) => font(b, s), w - 30, 17);
      ctx.fillStyle = b.fg;
      ctx.fillText(b.short, x + w / 2, y + 80);
    });
  }

  // ---- neon panels ----
  for (const n of neons) {
    clip(regions[`neon_${n.id}`], (x, y, w, h) => {
      ctx.fillStyle = "#08080b";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#121117";
      rr(x + 6, y + 6, w - 12, h - 12, 12);
      ctx.fill();
      const b = businesses.find((q) => q.id === n.id);
      NEON = [n.color, n.color2 ?? n.color];
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const iconW = b ? 84 : 0;
      if (b) ICON[b.kind](x + 52, y + h / 2, 70, b);
      const tmpl = (s) => (b ? `italic 700 ${s}px 'FreeSans'` : `700 ${s}px 'DejaVu Sans'`);
      fit(n.text, tmpl, w - iconW - 34, b ? 44 : 60);
      ctx.beginPath();
      const tx = x + iconW + (w - iconW) / 2;
      ctx.strokeStyle = n.color;
      neonText(n.text, tx, y + h / 2 + 2, n.color);
      if (!b) {
        NEON = [n.color2];
        ctx.beginPath();
        ctx.roundRect(x + 18, y + 18, w - 36, h - 36, 18);
        tubeStroke(n.color2, 2.6);
      }
      NEON = null;
    });
  }

  // ---- chalk menus ----
  for (const b of menus) {
    clip(regions[`menu_${b.id}`], (x, y, w, h) => {
      chalkboard(x, y, w, h);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ICON[b.kind](x + w / 2, y + 26, 30, b);
      fit(b.short, (s) => font(b, s), w - 14, 17);
      ctx.fillStyle = b.accent === "#fff4e6" || b.accent === "#fffaf0" ? b.accent2 : b.accent;
      ctx.fillText(b.short, x + w / 2, y + 60);
      ctx.fillStyle = "rgba(240,240,232,0.85)";
      ctx.font = "italic 8px 'FreeSerif'";
      ctx.fillText("~ menu ~", x + w / 2, y + 72);
      const items = MENUS[b.kind];
      items.forEach(([name, price], i) => {
        const yy = y + 90 + i * 15;
        ctx.textAlign = "left";
        ctx.font = "700 9px 'Liberation Sans Narrow'";
        ctx.fillStyle = "rgba(245,243,235,0.92)";
        ctx.fillText(name, x + 9, yy);
        ctx.textAlign = "right";
        ctx.fillText(price, x + w - 9, yy);
        ctx.fillStyle = "rgba(245,243,235,0.35)";
        const left = x + 12 + ctx.measureText(name).width + 4;
        for (let dx = left; dx < x + w - 24; dx += 4) ctx.fillRect(dx, yy - 2, 1.4, 1.4);
      });
      ctx.textAlign = "center";
      ctx.fillStyle = b.accent2;
      ctx.font = "italic 700 9px 'FreeSerif'";
      ctx.fillText("thank you, y'all!", x + w / 2, y + h - 10);
    });
  }

  // ---- sandwich boards ----
  for (const b of sandwiches) {
    const c = BOARDS[b.sandwich];
    clip(regions[`sandwich_${b.id}`], (x, y, w, h) => {
      chalkboard(x, y, w, h);
      ctx.fillStyle = b.bg;
      ctx.fillRect(x, y, w, 30);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      fit(b.short, (s) => font(b, s), w - 12, 16);
      ctx.fillStyle = b.fg;
      ctx.fillText(b.short, x + w / 2, y + 21);
      ctx.fillStyle = b.accent === "#fff4e6" || b.accent === "#fffaf0" ? b.accent2 : b.accent;
      fit(c.head, (s) => `700 ${s}px 'DejaVu Sans'`, w - 16, 12);
      ctx.fillText(c.head, x + w / 2, y + 48);
      ctx.fillStyle = "rgba(248,246,238,0.95)";
      c.lines.forEach((t, i) => {
        fit(t, (s) => `italic 700 ${s}px 'FreeSerif'`, w - 14, 22);
        ctx.fillText(t, x + w / 2, y + 72 + i * 22);
      });
      ICON[b.kind](x + w / 2, y + 116, 22, b);
      ctx.fillStyle = "rgba(248,246,238,0.8)";
      fit(c.foot, (s) => `italic ${s}px 'FreeSerif'`, w - 12, 9);
      ctx.fillText(c.foot, x + w / 2, y + h - 6);
    });
  }

  for (const { rect: [x, y, w, h], color } of Object.values(swatches)) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  function neonText(text, x, y, color) {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    for (const [lw, blur, a] of [[9, 20, 0.35], [5, 9, 0.9]]) {
      ctx.globalAlpha = a;
      ctx.shadowBlur = blur;
      ctx.lineWidth = lw;
      ctx.strokeText(text, x, y);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 3;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff6f0";
    ctx.strokeText(text, x, y);
    ctx.restore();
  }
  function chalkboard(x, y, w, h) {
    ctx.fillStyle = "#26302e";
    ctx.fillRect(x, y, w, h);
    ctx.save();
    for (let k = 0; k < 40; k += 1) {
      ctx.globalAlpha = 0.04 + rnd() * 0.05;
      ctx.strokeStyle = "#e8eee8";
      ctx.lineWidth = 6 + rnd() * 14;
      ctx.beginPath();
      const px = x + rnd() * w, py = y + rnd() * h;
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + (rnd() - 0.5) * 40, py + (rnd() - 0.5) * 20, px + (rnd() - 0.5) * 60, py + (rnd() - 0.5) * 30);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(240,240,230,0.55)";
    ctx.lineWidth = 1;
    rr(x + 4, y + 4, w - 8, h - 8, 3);
    ctx.stroke();
  }
  function grain(x, y, w, h, a) {
    const img = ctx.getImageData(x, y, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 255 * a;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, x, y);
  }
  function shade(hex, k) {
    const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const o = v.map((c) => Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k)));
    return `rgb(${o.join(",")})`;
  }
  return cv.toDataURL("image/jpeg", 0.9);
}
