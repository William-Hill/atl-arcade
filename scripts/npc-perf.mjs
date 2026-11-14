// NPC skater render cost check (#280). It serves one or more built dist
// folders with `vite preview`, opens the BeltLine level in headless Chromium
// (SwiftShader, as scripts/prop-perf.mjs does), and records for each run:
// - the NPC skaters drawn, the drawn NPCs on the LOD1 model, and the skinned
//   vertices of the drawn NPCs (the mean over the samples),
// - the triangles and the draw calls of a frame (`__atl.rendererInfo`, the
//   mean over the samples),
// - the median FPS and the 90th percentile frame time.
//
// The NPC skaters ride, so the count in view changes. The "line" camera
// sees the NPC skaters along the trail at a fixed tick, and the
// URL parameters ?npcmax=, ?npcdist=, ?npclod1=, ?npcfull=, and ?npclod=0
// set the draw limits (src/main.js).
//
// Usage:
//   node scripts/npc-perf.mjs --dist before=/tmp/dist-before --dist after=/tmp/dist-after \
//     [--config "label:build:quality:extra" ...] [--repeat 3] [--seconds 6] [--tick 300]
//     [--viewport 1280x720] [--out reports/npc-perf/run.json]
// Each --config is one measured case. `build` is a --dist label, `extra`
// is appended to the URL (for example "&npcmax=8&npcdist=90").
// The runs alternate between the cases, so a change in the machine load
// hits all of them.

import { loadavg } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { preview } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const many = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const dists = many("dist").map((s) => {
  const [label, path] = s.split("=");
  return { label, path: resolve(path) };
});
if (dists.length === 0) dists.push({ label: "dist", path: resolve("dist") });
const configs = many("config").map((s) => {
  const [label, build, quality, extra = ""] = s.split(":");
  return { label, build, quality, extra };
});
if (configs.length === 0) for (const d of dists) for (const quality of ["high", "phone"]) configs.push({ label: `${d.label}-${quality}`, build: d.label, quality, extra: "" });
const repeat = Number(arg("repeat", "3"));
const seconds = Number(arg("seconds", "6"));
const basePort = Number(arg("port", "5770"));
const out = arg("out", null);
const shotDir = arg("shots", null);
// The simulation tick at which the camera takes its place (the "line" camera). 0
// does not wait (the high tier on SwiftShader runs at about 1 FPS).
const packTick = Number(arg("tick", "300"));
const [vw, vh] = arg("viewport", "1280x720").split("x").map(Number);

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function frameStats(frameMs) {
  const ms = frameMs.slice(5).filter((v) => v > 0);
  const sorted = [...ms].sort((a, b) => a - b);
  const med = percentile(sorted, 0.5);
  return { frames: ms.length, medianFps: med ? Math.round((1000 / med) * 10) / 10 : null, p90Ms: Math.round(percentile(sorted, 0.9) * 10) / 10 };
}

const servers = [];
for (const [i, d] of dists.entries()) {
  const server = await preview({ build: { outDir: d.path }, preview: { port: basePort + i, strictPort: true }, logLevel: "silent" });
  servers.push(server);
  d.base = `http://localhost:${basePort + i}`;
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const rows = [];
const errors = [];
for (let r = 0; r < repeat; r += 1) {
  for (const c of configs) {
    const d = dists.find((x) => x.label === c.build);
    const page = await browser.newPage({ viewport: { width: vw, height: vh } });
    page.on("pageerror", (e) => errors.push(`${c.label}: ${e}`));
    await page.goto(`${d.base}/?level=beltline-eastside&quality=${c.quality}&mute=1&npcseed=1&view=fixed${c.extra}`);
    await page.waitForFunction(() => window.__atl?.ready && window.__atl.skaters && window.__atl.skaters.loaded + window.__atl.skaters.failed === window.__atl.skaters.count && window.__atl.frames > 10, null, { timeout: 240000 });
    await page.waitForFunction((t) => window.__atl.ticks >= t, packTick, { timeout: 240000 });
    // The "line" camera: 8 m up and 15 m past one end of the NPC line (the
    // two NPC skaters farthest apart), looking at the other end. Thus all
    // NPC skaters are in view, from about 15 m to the far end of the line.
    await page.evaluate(() => {
      const list = window.__atl.skaters.list;
      let best = [list[0], list[0], -1];
      for (const p of list) for (const q of list) {
        const d = Math.hypot(p.position[0] - q.position[0], p.position[2] - q.position[2]);
        if (d > best[2]) best = [p, q, d];
      }
      const [a, b, len] = best;
      const dx = (b.position[0] - a.position[0]) / (len || 1);
      const dz = (b.position[2] - a.position[2]) / (len || 1);
      const y = a.position[1];
      window.__atl.setFixedCamera(a.position[0] - dx * 15, y + 8, a.position[2] - dz * 15, b.position[0], b.position[1] + 1, b.position[2]);
    });
    await page.waitForTimeout(1500);
    const load = loadavg()[0];
    await page.evaluate(() => window.__atl.fps.start());
    // Samples of the NPC counts while the FPS window runs.
    const samples = [];
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      samples.push(await page.evaluate(() => ({ drawn: window.__atl.skaters.drawn, lod1: window.__atl.skaters.lod1Drawn ?? 0, verts: window.__atl.skaters.skinnedVertices ?? null, tris: window.__atl.rendererInfo.triangles, calls: window.__atl.rendererInfo.calls })));
      await page.waitForTimeout(250);
    }
    const frameMs = await page.evaluate(() => window.__atl.fps.stop());
    if (shotDir && r === 0) {
      mkdirSync(shotDir, { recursive: true });
      await page.screenshot({ path: resolve(shotDir, `npc-${c.label}.png`) });
    }
    const mean = (k) => Math.round((samples.reduce((s, x) => s + (x[k] ?? 0), 0) / samples.length) * 10) / 10;
    const row = {
      run: r + 1,
      case: c.label,
      build: c.build,
      quality: c.quality,
      extra: c.extra,
      load: Math.round(load * 10) / 10,
      npcs: await page.evaluate(() => window.__atl.skaters.count),
      drawn: mean("drawn"),
      lod1: mean("lod1"),
      // The main build has no counter: it draws only the full model, about
      // 74 K skinned vertices for each NPC (src/render/npc-skaters-view.js).
      skinnedVertices: samples[0].verts === null ? null : mean("verts"),
      calls: mean("calls"),
      triangles: Math.round(mean("tris")),
      ...frameStats(frameMs),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
    await page.close();
  }
}
await browser.close();
for (const s of servers) await new Promise((done) => s.httpServer.close(done));

const mid = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const table = configs.map((c) => {
  const rs = rows.filter((x) => x.case === c.label);
  return {
    case: c.label,
    quality: c.quality,
    npcs: rs[0]?.npcs,
    drawn: mid(rs.map((x) => x.drawn)),
    lod1: mid(rs.map((x) => x.lod1)),
    skinnedVertices: rs[0]?.skinnedVertices === null ? null : mid(rs.map((x) => x.skinnedVertices)),
    triangles: mid(rs.map((x) => x.triangles)),
    calls: mid(rs.map((x) => x.calls)),
    medianFps: mid(rs.map((x) => x.medianFps)),
    runsFps: rs.map((x) => x.medianFps).join(" "),
    p90Ms: mid(rs.map((x) => x.p90Ms)),
  };
});
console.table(table);
if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify({ date: new Date().toISOString(), gpu: "swiftshader", viewport: `${vw}x${vh}`, seconds, repeat, packTick, configs, rows, table, errors }, null, 2));
}
if (errors.length) console.error(errors);
