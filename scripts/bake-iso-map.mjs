// Bakes the isometric map of a level (src/level/geo/iso-map.js) into tiles.
//
//   node scripts/bake-iso-map.mjs [level] [--look pbr] [--only col,row]
//   python3 scripts/iso-pyramid.py [level]
//
// It starts the Vite dev server, opens the game in headless Chromium with
// the orthographic camera (?view=iso), and for each tile moves the camera,
// lets the frames settle, and saves the center of the render. The render is
// ISO.tile + 2 * ISO.margin pixels on each side; the margin is cut off, so
// the screen space passes (AO, ink) see past each tile edge and the tiles
// join with no seam. Then iso-pyramid.py makes the smaller zoom levels.
//
// The tiles go to assets/map/<level>/0/<col>_<row>.jpg, with iso.json (the
// grid) and provenance.json. The art is our own render of open data; no
// generative model draws it.
//
// BAKE_GPU=1 asks Chromium for the real GPU (ANGLE on Metal). Without it,
// the render uses SwiftShader, which is slow but the same image.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { ISO } from "../src/level/geo/iso-map.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const level = args.find((a) => !a.startsWith("--")) ?? "beltline-eastside";
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const look = opt("look", "pbr");
const only = opt("only", null);
const PORT = Number(process.env.BAKE_PORT ?? 5190);
const side = ISO.tile + 2 * ISO.margin;

// No hot reload and no watch of the map folder: the game imports the tiles
// (src/ui/iso-tiles.js), so each new tile file would reload the page.
const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ["**/assets/map/**"] } }, logLevel: "warn" });
await server.listen();
const gpu = process.env.BAKE_GPU === "1";
const browser = await chromium.launch({
  args: gpu ? ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] : ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: side, height: side }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

const query = `level=${level}&mute=1&quality=high&look=${look}&governor=0&view=iso&iso=0,0&fog=0&npcs=0&minimap=0&fullmap=0&facts=off`;
await page.goto(`http://localhost:${PORT}/?${query}`);
await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5 && window.__atl.iso, null, { timeout: 300000 });
await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 300000 });
const renderer = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
});
console.log(`renderer: ${renderer}`);
// Keep only the WebGL canvas: no HUD, no overlays.
await page.evaluate(() => {
  const main = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  for (const el of document.querySelectorAll("body *")) {
    if (el === main || el.contains(main)) continue;
    el.style.visibility = "hidden";
  }
});
const grid = await page.evaluate(() => window.__atl.iso.grid);
const out = resolve(ROOT, "assets/map", level);
mkdirSync(resolve(out, "0"), { recursive: true });

const tiles = [];
for (let row = 0; row < grid.rows; row += 1) for (let col = 0; col < grid.cols; col += 1) tiles.push([col, row]);
const todo = only ? [only.split(",").map(Number)] : tiles;
const t0 = Date.now();
// One tile: move the camera, wait for the frames, and save the center. The
// GPU can stall on a frame now and then, so a tile gets 3 tries.
async function shoot(col, row) {
  const f0 = await page.evaluate(([c, r]) => {
    window.__atl.iso.shot(c, r);
    return window.__atl.frames;
  }, [col, row]);
  // The detail, the shadow box, and the AO follow the camera in a frame or
  // two; wait for 6 frames.
  await page.waitForFunction((f) => window.__atl.frames > f + 6, f0, { timeout: 30000 });
  await page.screenshot({ path: resolve(out, "0", `${col}_${row}.jpg`), type: "jpeg", quality: 88, clip: { x: ISO.margin, y: ISO.margin, width: ISO.tile, height: ISO.tile }, timeout: 15000 });
}
let done = 0;
for (const [col, row] of todo) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await shoot(col, row);
      break;
    } catch (err) {
      console.log(`tile ${col},${row}: try ${attempt} failed (${String(err.message).split("\n")[0]})`);
      if (attempt >= 3) throw err;
    }
  }
  done += 1;
  if (done % 10 === 0 || done === todo.length) console.log(`${done}/${todo.length} tiles, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

writeFileSync(
  resolve(out, "iso.json"),
  `${JSON.stringify({ level, look, yaw: ISO.yaw, pitch: ISO.pitch, mpp: grid.mpp, tile: grid.tile, a0: grid.a0, b1: grid.b1, cols: grid.cols, rows: grid.rows, width: grid.width, height: grid.height, levels: ISO.levels, format: "jpg", baked: new Date().toISOString().slice(0, 10) }, null, 2)}\n`,
);
writeFileSync(
  resolve(out, "provenance.json"),
  `${JSON.stringify(
    {
      tool: "scripts/bake-iso-map.mjs (the game renderer, Three.js, headless Chromium, orthographic camera) and scripts/iso-pyramid.py (Pillow resize)",
      prompt: null,
      generativeModel: null,
      sources: ["OpenStreetMap contributors (ODbL 1.0)", "Overture Maps Foundation (heights)", "USGS 3DEP (elevation)", "City of Atlanta Department of City Planning (street names)", "Poly Haven CC0 scans (surface detail)"],
      renderer,
      look,
      date: new Date().toISOString().slice(0, 10),
      note: "A render of the game level, not generated art. The map data credits of the level apply.",
    },
    null,
    2,
  )}\n`,
);
if (errors.length) console.log(`console errors: ${errors.join(" | ")}`);
await browser.close();
await server.close();
