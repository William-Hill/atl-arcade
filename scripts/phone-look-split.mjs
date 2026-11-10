// Where the frame of a look goes on the phone tier (#246): the frame time at
// a fixed camera with one kind of object hidden at a time (the method of
// docs/perf/191/README.md). A kind is the name of a child of the level root
// or of the scene, without its numbers. SwiftShader: relative only.
//
// Usage:
//   node scripts/phone-look-split.mjs --dist dist --cam krog --look pbr [--extra "&pbrlite=0"] [--out file.json]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { preview } from "vite";
import { chromium } from "@playwright/test";
import { PHONE_CAMS, PHONE_PROFILES } from "./phone-look-lib.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const dist = resolve(arg("dist", "dist"));
const port = Number(arg("port", "5796"));
const cam = arg("cam", "krog");
const look = arg("look", "pbr");
const extra = arg("extra", "");
const frames = Number(arg("frames", "5"));
const out = arg("out", null);

const server = await preview({ build: { outDir: dist }, preview: { host: "127.0.0.1", port, strictPort: true }, logLevel: "silent" });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
let rows = [];
try {
  const ctx = await browser.newContext(PHONE_PROFILES[arg("profile", "iphone15-port")]);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/?level=beltline-eastside&quality=phone&look=${look}&mute=1&npcseed=1&governor=0${PHONE_CAMS[cam] ? `&view=fixed&cam=${PHONE_CAMS[cam]}` : ""}&wind=0&time=14&weather=clear${extra}`);
  await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 0, null, { timeout: 300000, polling: 200 });
  await page.waitForFunction(() => window.__atl.level.props?.loaded || window.__atl.level.props?.error, null, { timeout: 120000, polling: 500 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  rows = await page.evaluate(async (n) => {
    const scene = window.__atl.scene;
    const gl = document.querySelector("canvas").getContext("webgl2");
    const px = new Uint8Array(4);
    const time = async () => {
      const times = [];
      let last = null;
      for (let i = 0; i < n + 2; i += 1) {
        await new Promise((done) => requestAnimationFrame(done));
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const now = performance.now();
        if (last !== null && i > 1) times.push(now - last);
        last = now;
      }
      times.sort((a, b) => a - b);
      return Math.round(times[times.length >> 1]);
    };
    const base = (name) => String(name).replace(/([-_ ]?(-?\d+|tile)(,-?\d+)*)+$/i, "").replace(/[-_ ]+$/, "") || "?";
    // The kinds: the children of the scene, and of the level root one level down.
    const kinds = new Map();
    const add = (o) => {
      if (!o.visible) return;
      const k = base(o.name || o.type);
      if (!kinds.has(k)) kinds.set(k, []);
      kinds.get(k).push(o);
    };
    for (const c of scene.children) {
      if (c.isLight || c.isCamera) continue;
      if (c.children.length > 8 && !c.isMesh) for (const g of c.children) add(g);
      else add(c);
    }
    const all = await time();
    const out = [{ kind: "(all)", ms: all, saved: 0 }];
    for (const [k, list] of kinds) {
      for (const o of list) o.visible = false;
      const ms = await time();
      for (const o of list) o.visible = true;
      out.push({ kind: k, objects: list.length, ms, saved: all - ms });
    }
    out.push({ kind: "(all, again)", ms: await time(), saved: 0 });
    return out;
  }, frames);
  rows.sort((a, b) => b.saved - a.saved);
  console.table(rows);
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}
if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), `${JSON.stringify({ date: new Date().toISOString(), renderer: "swiftshader (software, CPU)", cam, look, extra, rows }, null, 2)}\n`);
}
