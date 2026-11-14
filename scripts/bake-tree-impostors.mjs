// Bakes the far tree impostor atlas (#281): assets/trees/impostors.png and
// its provenance.json.
//
//   node scripts/bake-tree-impostors.mjs
//
// It starts the Vite dev server, opens scripts/art/tree-impostor-bake.html
// in headless Chromium, and writes the pixels of the page (window.__bake)
// as a PNG. The page renders the procedural trees of src/level/geo/trees.js
// with Three.js; no generative model draws the art. See the page for the
// channels of the texture.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { FAR_TREE_DISTANCE, SHADE_SCALE } from "../src/render/tree-impostors.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.BAKE_PORT ?? 5191);
const OUT = resolve(ROOT, "assets/trees");

// A PNG file (8-bit RGBA, no filter) from the pixels, top row first.
function png(width, height, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let i = 0; i < width * 4; i += 1) raw[y * (width * 4 + 1) + 1 + i] = rgba[y * width * 4 + i];
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true, hmr: false }, logLevel: "warn" });
await server.listen();
const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
await page.goto(`http://localhost:${PORT}/scripts/art/tree-impostor-bake.html`);
await page.waitForFunction(() => window.__bake, null, { timeout: 120000 });
const bake = await page.evaluate(() => window.__bake);
await browser.close();
await server.close();
if (errors.length) {
  console.error(errors);
  process.exit(1);
}

// The B channel marked the filled empty pixels in the bake; the game does
// not read it.
const pixels = Uint8Array.from(bake.pixels);
for (let i = 2; i < pixels.length; i += 4) pixels[i] = 0;
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "impostors.png"), png(bake.width, bake.height, pixels));
const date = new Date().toISOString().slice(0, 10);
writeFileSync(
  resolve(OUT, "provenance.json"),
  `${JSON.stringify(
    {
      asset: "Far tree impostor atlas (impostors.png) for src/render/tree-impostors.js",
      issue: "#281",
      date,
      tool: "scripts/bake-tree-impostors.mjs and scripts/art/tree-impostor-bake.js (Three.js render in headless Chromium, SwiftShader). No generative AI.",
      prompt: null,
      generativeModel: null,
      renderer: bake.renderer,
      settings: {
        size: [bake.width, bake.height],
        cells: bake.cells,
        camera: "orthographic, side view from +z, the frame is the card rect: x from -halfWidth to +halfWidth, y from 0 to height (m)",
        supersampling: "4 x 4 samples for each pixel",
        sun: [0.45, 0.8, 0.4],
        ramp: "the soft toon ramp of the props (110, 180, 255)",
        shadeScale: SHADE_SCALE,
        season: "summer (the shape only; the game gives the season colors)",
        layerDistance: `prop draw distance to ${FAR_TREE_DISTANCE} m`,
      },
      channels: { R: "toon shade / shadeScale", G: "bark mask", B: "0", A: "coverage" },
      sources: ["src/level/geo/trees.js (the procedural trees of the game, issue #137)"],
      credits: "Our own render of our own procedural trees. No third-party art.",
      credits_spent: 0,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${resolve(OUT, "impostors.png")} (${bake.width} x ${bake.height})`);
