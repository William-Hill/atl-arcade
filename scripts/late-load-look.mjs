// The look check of #190: the same fixed views on the pbr look, once with the
// late downloads (the default) and once with ?lateload=0, each taken after
// every late group has loaded. It saves the pictures and prints the mean
// pixel difference of each pair. Uses a built dist/.
//   node scripts/late-load-look.mjs [--tiers high,phone] [--out docs/perf/190/look]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { preview } from "vite";

const args = process.argv.slice(2);
const arg = (name, def) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : def);
const tiers = arg("tiers", "high,phone").split(",");
const out = arg("out", "docs/perf/190/look");
mkdirSync(out, { recursive: true });

// name, camera (x, y over the ground, z), look at (x, absolute y or null for ground + 1, z).
const VIEWS = [
  // The mural nearest the spawn (geo-mesh.js muralWalls()), from 24 m.
  { name: "mural", camera: [340.8 - 0.931 * 24, 6, -126.9 + 0.364 * 24], look: [340.8, 29.8, -126.9] },
  // The trail by the spawn: ground, trees, the street kit.
  { name: "trail", camera: [233, 1.7, -294], look: [262, null, -256] },
  // A street: the ground maps.
  { name: "street", camera: [380, 1.7, -367.5], look: [356.5, null, -357] },
];
const QUERY = "level=beltline-eastside&mute=1&governor=0&view=fixed&minimap=0&skater=capsule&weather=0&time=12&cars=0&traffic=0&peds=0&npcs=0&skaters=0&wind=0&npcseed=1";

const server = await preview({ preview: { port: 4183 }, logLevel: "silent" });
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });

async function shots(quality, extra) {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 })).newPage();
  // A high pbr frame takes seconds on a software GPU.
  page.setDefaultTimeout(300000);
  await page.goto(`${base}/?${QUERY}&quality=${quality}&look=pbr${extra}`);
  await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 2, null, { timeout: 180000 });
  await page.waitForFunction(
    () => {
      const l = window.__atl.lateLoads;
      return ["props", "murals", "ground"].every((g) => l.done[g] != null || l.failed[g] != null) && (window.__atl.level.props?.loaded || window.__atl.level.props?.error);
    },
    null,
    { timeout: 300000, polling: 250 },
  );
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    const main = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    for (const el of document.querySelectorAll("body *")) if (el !== main && !el.contains(main)) el.style.visibility = "hidden";
  });
  const pictures = {};
  for (const v of VIEWS) {
    const frames = await page.evaluate((view) => {
      const ground = (x, z) => window.__atl.level.sample(x, z)?.height ?? 0;
      const [cx, cu, cz] = view.camera;
      const [lx, ly, lz] = view.look;
      window.__atl.setFixedCamera(cx, ground(cx, cz) + cu, cz, lx, ly ?? ground(lx, lz) + 1, lz);
      return window.__atl.frames;
    }, v);
    await page.waitForFunction((f) => window.__atl.frames > f + 8, frames, { timeout: 300000 });
    if (!extra.includes("again")) await page.screenshot({ path: `${out}/${quality}-${v.name}-${extra ? "lateload0" : "late"}.jpg`, type: "jpeg", quality: 85 });
    pictures[v.name] = await page.screenshot({ type: "png" });
  }
  await page.close();
  return pictures;
}

// Mean absolute difference (0..255) of two PNGs, in the browser.
async function diff(a, b) {
  const page = await browser.newPage();
  const d = await page.evaluate(
    async ([a, b]) => {
      const img = async (b64) => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const [ia, ib] = await Promise.all([img(a), img(b)]);
      const c = new OffscreenCanvas(ia.width, ia.height);
      const g = c.getContext("2d");
      g.drawImage(ia, 0, 0);
      const da = g.getImageData(0, 0, ia.width, ia.height).data;
      g.drawImage(ib, 0, 0);
      const db = g.getImageData(0, 0, ia.width, ia.height).data;
      let sum = 0;
      let big = 0;
      for (let i = 0; i < da.length; i += 4) {
        const px = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3;
        sum += px;
        if (px > 24) big += 1;
      }
      return { mean: sum / (da.length / 4), bigShare: big / (da.length / 4) };
    },
    [a.toString("base64"), b.toString("base64")],
  );
  await page.close();
  return d;
}

const rows = [];
try {
  for (const q of tiers) {
    const late = await shots(q, "");
    const now = await shots(q, "&lateload=0");
    // A second default run gives the noise of two runs of the same build.
    const again = await shots(q, "&again=1");
    for (const v of VIEWS) {
      const d = await diff(late[v.name], now[v.name]);
      const n = await diff(late[v.name], again[v.name]);
      rows.push({ tier: q, view: v.name, meanDiff: +d.mean.toFixed(2), over24: +(d.bigShare * 100).toFixed(2), noiseMeanDiff: +n.mean.toFixed(2), noiseOver24: +(n.bigShare * 100).toFixed(2) });
      console.log(`${q} ${v.name}: late vs lateload=0 mean ${d.mean.toFixed(2)} / 255 (${(d.bigShare * 100).toFixed(2)} % over 24); late vs late ${n.mean.toFixed(2)} (${(n.bigShare * 100).toFixed(2)} %)`);
    }
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(JSON.stringify(rows));
