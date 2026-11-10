// The frame time of each look on the phone tier, on the phone profiles of the
// mobile audit (#246, finding MOB2-2): iPhone 15 portrait and landscape,
// Pixel 7 portrait, and 360 x 640. The method of the audit
// (production/audits/2026-11-playability/mobile/scripts/measure.mjs): the
// device descriptor of Playwright (viewport, pixel ratio, touch, user agent),
// the W key held so the skater rides, and the median of the frame times.
//
// Headless Chromium draws with SwiftShader, a software GPU on the CPU. The
// frame times are relative only: compare two looks on the same machine, not
// with a phone.
//
// Usage:
//   node scripts/phone-look-perf.mjs                       (toon, pbr on every profile)
//   node scripts/phone-look-perf.mjs --profiles iphone15-port \
//     --variant "pbr no leaf cards=&look=pbr&trees=kit" --variant "toon=&look=toon"
//   --dist <dir>   serve this build (default dist/; build first with `npx vite build`)
//   --seconds 12   the least sample time; a slow look samples until --frames frames
//   --frames 12    the least frames in a sample
//   --shots <dir>  a screenshot of each run
//   --out <file>   the JSON

import { loadavg } from "node:os";
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
const pairs = (name) =>
  args.flatMap((a, i) => {
    if (a !== `--${name}`) return [];
    const at = args[i + 1].indexOf("=");
    return [{ label: args[i + 1].slice(0, at), value: args[i + 1].slice(at + 1) }];
  });

const dist = resolve(arg("dist", "dist"));
const port = Number(arg("port", "5795"));
const seconds = Number(arg("seconds", "12"));
const minFrames = Number(arg("frames", "12"));
const out = arg("out", null);
const shotDir = arg("shots", null);
const profiles = arg("profiles", Object.keys(PHONE_PROFILES).join(",")).split(",");
const variants = pairs("variant");
if (variants.length === 0) variants.push({ label: "toon", value: "&look=toon" }, { label: "pbr", value: "&look=pbr" });
const quality = arg("quality", "phone");
// --cams spawn,krog: a fixed camera (PHONE_CAMS) in place of the ride.
const cams = arg("cams", null)?.split(",") ?? [null];
// --early: sample 3 s after the game is ready, as the audit did, before the
// late loads (the GLB trees with their leaf cards, the people, the cars) are in.
const early = args.includes("--early");
// --dpr <n>: the device pixel ratio of every profile (to price the pixels).
const dpr = arg("dpr", null);

const server = await preview({ build: { outDir: dist }, preview: { host: "127.0.0.1", port, strictPort: true }, logLevel: "silent" });
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });

const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const rows = [];
try {
  for (const name of profiles) for (const cam of cams) {
    for (const v of variants) {
      const ctx = await browser.newContext({ ...PHONE_PROFILES[name], ...(dpr ? { deviceScaleFactor: Number(dpr) } : {}) });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      let bytes = 0;
      let requests = 0;
      cdp.on("Network.loadingFinished", (e) => {
        bytes += e.encodedDataLength;
        requests += 1;
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      // The governor is off: a slow software frame must not step the look down.
      await page.goto(`${base}/?level=beltline-eastside&quality=${quality}&mute=1&npcseed=1&governor=0&perf=1${cam ? `${PHONE_CAMS[cam] ? `&view=fixed&cam=${PHONE_CAMS[cam]}` : ""}&wind=0&time=14&weather=clear` : ""}${v.value}`);
      await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 0, null, { timeout: 300000, polling: 200 });
      // The late loads (props, people, cars, murals, ground maps), then the
      // shader compiles.
      if (!early) {
        await page.waitForFunction(
          () => {
            const a = window.__atl;
            return (a.level.props?.loaded || a.level.props?.error || !a.level.props) && (a.skaterModel?.loaded || a.skaterModel?.error);
          },
          null,
          { timeout: 120000, polling: 500 },
        ).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
      }
      await page.waitForTimeout(early ? 3000 : 4000);
      const load = loadavg()[0];
      let frameMs;
      if (cam) {
        frameMs = await page.evaluate(async (n) => {
          const gl = document.querySelector("canvas").getContext("webgl2");
          const px = new Uint8Array(4);
          const times = [];
          let last = null;
          for (let i = 0; i < n + 2; i += 1) {
            await new Promise((done) => requestAnimationFrame(done));
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            const now = performance.now();
            if (last !== null && i > 1) times.push(now - last);
            last = now;
          }
          return times;
        }, minFrames);
      } else {
        await page.keyboard.down("KeyW");
        const f0 = await page.evaluate(() => (window.__atl.fps.start(), window.__atl.frames));
        const t0 = Date.now();
        await page.waitForTimeout(seconds * 1000);
        while ((await page.evaluate(() => window.__atl.frames)) - f0 < minFrames && Date.now() - t0 < 120000) await page.waitForTimeout(1000);
        frameMs = await page.evaluate(() => window.__atl.fps.stop());
        await page.keyboard.up("KeyW");
      }
      const info = await page.evaluate(() => {
        const a = window.__atl;
        const c = document.getElementById("stage");
        const split = a.drawSplit;
        return { info: a.rendererInfo, byPass: split?.byPass ?? null, top: (split?.rows ?? []).slice(0, 12), render: a.render, look: a.look, lite: a.pbrLite ?? null, textureMemory: a.textureMemory ?? null, canvas: [c.width, c.height], systems: a.perf?.report?.().systems ?? null };
      });
      if (shotDir) {
        mkdirSync(shotDir, { recursive: true });
        await page.screenshot({ path: resolve(shotDir, `${name}-${cam ?? "ride"}-${v.label.replace(/[^a-z0-9]+/gi, "-")}.jpg`), type: "jpeg", quality: 80 });
      }
      const sorted = [...frameMs].sort((a, b) => a - b);
      const row = {
        profile: name,
        cam: cam ?? "ride",
        variant: v.label,
        look: info.look,
        medianMs: Math.round(median(frameMs)),
        p95Ms: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
        frames: frameMs.length,
        calls: info.info.calls,
        triangles: info.info.triangles,
        textures: info.info.textures,
        geometries: info.info.geometries,
        // The estimate of the GPU texture memory (src/perf/texture-memory.js).
        textureMB: info.textureMemory?.MB ?? null,
        textureTop: info.textureMemory?.top ?? null,
        lite: Boolean(info.lite),
        canvas: info.canvas,
        pixelRatio: info.render.pixelRatio,
        post: info.render.post,
        downloadMB: Math.round((bytes / 1048576) * 100) / 100,
        requests,
        renderCpuMs: info.systems?.render?.meanMs ?? null,
        byPass: info.byPass,
        top: info.top,
        load: Math.round(load * 10) / 10,
        errors: errors.slice(0, 3),
      };
      rows.push(row);
      const { byPass, top, textureTop, ...short } = row;
      console.log(JSON.stringify(short));
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((done) => server.httpServer.close(done));
}

// The ratio of each variant to the "toon" variant of its profile.
const table = {};
for (const r of rows) {
  const toon = rows.find((t) => t.profile === r.profile && t.cam === r.cam && t.variant === "toon");
  (table[`${r.profile} ${r.cam}`] ??= {})[r.variant] = `${r.medianMs} ms${toon && toon !== r ? ` (${(r.medianMs / toon.medianMs).toFixed(1)}x)` : ""}, ${r.calls} draws, ${r.triangles} tris, ${r.textureMB ?? "-"} MB tex, ${r.downloadMB} MB`;
}
console.table(table);
if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), `${JSON.stringify({ date: new Date().toISOString(), renderer: "swiftshader (software, CPU)", quality, seconds, minFrames, rows }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
