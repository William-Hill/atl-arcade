// BEFORE / AFTER screenshots of the trail murals in the real game renderer
// (pbr look), from cameras computed from muralWalls(): each camera stands in
// front of one mural, looking at its center. Run it once on the base commit
// (--tag before) and once on this branch (--tag after). Serial, one page per
// shot (SwiftShader is slow).
//   node scripts/assets/murals-shots.mjs --tag before|after [--out docs/murals] [--extra "&murals=canvas"] [id ...]
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { muralWalls } from "../../src/level/geo/geo-mesh.js";
import { terrainOf } from "../../src/level/geo/terrain.js";

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
}
const tag = opt("--tag", "after");
const out = opt("--out", "docs/murals");
const extra = opt("--extra", "");
const level = JSON.parse(
  readFileSync(
    new URL("../../levels/beltline-eastside/level.json", import.meta.url),
    "utf8",
  ),
);
const terrain = terrainOf(level);
const walls = muralWalls(level);
// Four large murals along the trail, seen from 9 m up (over the trail
// trees) and from the side.
const IDS = args.length
  ? args
  : ["w211062135", "w269992060", "w335271424", "w887718742"];

function camFor(m, { distance = 0.75, height = 9, side = 0.3 } = {}) {
  const cx = (m.a[0] + m.b[0]) / 2;
  const cz = (m.a[1] + m.b[1]) / 2;
  const len = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]);
  const tx = (m.b[0] - m.a[0]) / len;
  const tz = (m.b[1] - m.a[1]) / len;
  const ex = cx + m.n[0] * distance * len + tx * side * len;
  const ez = cz + m.n[1] * distance * len + tz * side * len;
  const midY = (m.y0 + m.y1) / 2 - terrain.height(cx, cz);
  return [ex, height, ez, cx, midY, cz].map((v) => +v.toFixed(2));
}

const BASE =
  "level=beltline-eastside&quality=high&look=pbr&date=06-21&time=13.5&weather=clear&governor=0&view=fixed&mute=1&npcs=0&cars=0";
const server = await createServer({
  server: { port: 5194, strictPort: true },
  logLevel: "error",
});
await server.listen();
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const stats = {};
try {
  for (const id of IDS) {
    const m = walls.find((w) => w.id === id);
    if (!m) throw new Error(`no mural on ${id}`);
    const cam = camFor(m);
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    page.setDefaultTimeout(300000);
    page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
    await page.goto(
      `http://localhost:5194/?${BASE}${extra}&cam=${cam.join(",")}`,
      { waitUntil: "commit" },
    );
    await page.waitForFunction(
      () => window.__atl?.ready && window.__atl.frames > 8,
      null,
      { timeout: 300000 },
    );
    // Let the texture loads finish.
    await page.waitForTimeout(5000);
    const f = await page.evaluate(() => window.__atl.frames);
    await page.waitForFunction((f0) => window.__atl.frames > f0 + 6, f, {
      timeout: 300000,
    });
    const name = `${out}/${tag.toUpperCase()}-${id}-cell${m.cell}.png`;
    await page.screenshot({ path: name, timeout: 300000 });
    stats[id] = {
      cell: m.cell,
      cam,
      renderer: await page.evaluate(() => window.__atl.rendererInfo),
    };
    console.log(name, JSON.stringify(stats[id]));
    await page.close();
  }
} finally {
  writeFileSync(
    `${out}/shots-${tag}.json`,
    JSON.stringify(stats, null, 2) + "\n",
  );
  await browser.close();
  await server.close();
}
