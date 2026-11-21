// In-context preview of the storefront pieces in the real pbr renderer:
// picks a storefront building of the level near the spawn (the same front
// wall as the facade kit, frontEdges()), lays the pieces on its bays (the
// grid in docs/storefronts.md), opens the game with view=fixed, injects them
// with scripts/assets/storefront-preview.js, and saves a screenshot.
// No game file changes; the pieces exist only in this page.
//   node scripts/assets/storefront-context.mjs --out shot.png [--pick 0] [--time 13.5] [--bare]
// --bare shoots the same camera without the pieces (the BEFORE frame).
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { frontEdges, KIT } from "../../src/level/geo/facade-kit.js";
import { orientRing } from "../../src/level/geo/extrude.js";
import { STYLES, STYLE_INDEX, chooseStyle } from "../../src/level/geo/styles.js";
import { buildingSpan, terrainOf } from "../../src/level/geo/terrain.js";

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const LEVEL = "beltline-eastside";
const level = JSON.parse(readFileSync(`levels/${LEVEL}/level.json`, "utf8"));
const ground = (x, z) => terrainOf(level).height(x, z);
const [sx, , sz] = level.spawn.position;

// Storefront buildings with a front wall 14-40 m long, nearest the spawn first.
const fronts = frontEdges(level);
const cands = [];
for (const b of level.buildings) {
  const f = fronts.get(b.id);
  if (!f || f.edge < 0) continue;
  const style = STYLES[STYLE_INDEX[chooseStyle(b, level)]];
  const ring = orientRing(b.outer, false);
  const [px, pz] = ring[f.edge];
  const [qx, qz] = ring[(f.edge + 1) % ring.length];
  const len = Math.hypot(qx - px, qz - pz);
  if (len < 14 || len > 40) continue;
  const t = [(qx - px) / len, (qz - pz) / len];
  const span = buildingSpan(level, b);
  // A flat apron: the ground in front of the wall within 1 m of the floor.
  const mid = [(px + qx) / 2 - t[1] * 10, (pz + qz) / 2 + t[0] * 10];
  if (Math.abs(ground(mid[0], mid[1]) - span.base) > 1) continue;
  cands.push({ b, f, style, o: [px, pz], t, n: [-t[1], t[0]], len, dist: Math.hypot((px + qx) / 2 - sx, (pz + qz) / 2 - sz) });
}
cands.sort((a, b) => a.dist - b.dist);
const W = cands[Number(arg("--pick", 0))];
if (!W) throw new Error("no storefront wall");
const span = buildingSpan(level, W.b);
const floors = Math.max(1, Math.round((span.top - span.base) / W.style.floorHeight));
const floorH = (span.top - span.base) / floors;
const bays = Math.max(1, Math.round(W.len / W.style.bay));
const bl = W.len / bays;
const ry = Math.atan2(W.n[0], W.n[1]);
const at = (a, d) => [W.o[0] + W.t[0] * a + W.n[0] * d, W.o[1] + W.t[1] * a + W.n[1] * d];
const base = span.base;
// The kit sign band (facade-kit.js signBay): y0 .. y1 on the ground floor.
const y0 = base + KIT.sign.y0 * floorH;
const y1 = base + floorH - KIT.belt.height / 2 - KIT.sign.beltGap;
const OUT = KIT.sign.out + KIT.sign.boardOut;

const SHOPS = [
  { id: "taqueria", set: "patio_set_four", umb: "patio_umbrella_marigold", neon: "taqueria" },
  { id: "coffee", set: "patio_set_bistro_teal", umb: "patio_umbrella_teal", neon: "coffee", sandwich: true },
  { id: "records", neon: "records", sandwich: true },
  { id: "creamery", set: "patio_set_bistro_red", umb: "patio_umbrella_tomato", neon: "creamery" },
  { id: "brewery", set: "patio_picnic", umb: "patio_umbrella_sage", neon: "brewery" },
  { id: "books", sandwich: true },
];
const items = [];
const add = (file, name, a, d, y, extra = {}) => {
  const [x, z] = at(a, d);
  items.push({ file, name, x, y: y ?? ground(x, z), z, ry, ...extra });
};
const used = Math.min(bays, SHOPS.length);
const first = Math.floor((bays - used) / 2);
for (let i = 0; i < used; i += 1) {
  const s = SHOPS[i];
  const k = first + i;
  const am = (k + 0.5) * bl;
  const wide = bl >= 5;
  add("sign_boards", `sign_board_${s.id}${wide ? "_wide" : ""}`, am, OUT, (y0 + y1) / 2 - 0.3);
  add("blade_signs", `blade_sign_${s.id}`, k * bl + KIT.pier.width / 2, KIT.pier.out, base + 2.75);
  if (s.neon) add("neon_signs", `neon_sign_${s.neon}`, am + bl * 0.2, 0.02, base + 1.6);
  if (["taqueria", "coffee", "creamery"].includes(s.id)) add("menu_boards", `menu_board_${s.id}`, k * bl + 0.75, 0.02, base + 1.05);
  if (s.sandwich) add("sandwich_boards", `sandwich_board_${s.id}`, am - bl * 0.25, 1.1);
  if (s.set) {
    add("cafe_barriers", `cafe_barrier_${s.id}`, am, 3.25);
    add("patio_furniture", s.set, am - 0.5, 1.9, undefined, s.set === "patio_picnic" ? { ry: ry + Math.PI / 2 } : {});
    if (s.umb) add("patio_umbrellas", s.umb, am - 0.5, 1.9);
  }
}
// String lights over the patios: wall anchor under the belt course to a post
// at the apron edge, spanning the 3.5 m apron.
for (const i of [0, 3].filter((i) => i < used)) {
  const a = (first + i + 0.85) * bl;
  const [px, pz] = at(a, 3.5);
  const gy = ground(px, pz);
  add("string_lights", "string_light_post", a, 3.5);
  // Rotate the 4 m string to run along the normal (local +x toward the wall)
  // and tilt that end up to the wall hook.
  const [mx, mz] = at(a, (0.15 + 3.18) / 2);
  const hi = base + floorH - 0.35, lo = gy + 3.12;
  items.push({ file: "string_lights", name: "string_lights_4m", x: mx, y: (hi + lo) / 2, z: mz, ry: ry + Math.PI / 2, tilt: Math.atan2(hi - lo, 3.03), sx: Math.hypot(3.03, hi - lo) / 4 });
}

const [ex, ez] = at(W.len / 2 - Number(arg("--side", 3)), Number(arg("--back", 13)));
const [lx, lz] = at(W.len / 2, 0);
const cam = [ex, base + 2.4 - ground(ex, ez), ez, lx, base + 2.6 - ground(lx, lz), lz].map((v) => +v.toFixed(2));
const query = `level=${LEVEL}&quality=high&look=pbr&date=06-21&time=${arg("--time", "13.5")}&weather=clear&governor=0&view=fixed&mute=1&cam=${cam.join(",")}`;
console.log(JSON.stringify({ building: W.b.id, name: W.b.name ?? null, style: W.style.id, wall: +W.len.toFixed(2), bays, bay: +bl.toFixed(2), floorH: +floorH.toFixed(2), signBand: [+(y0 - base).toFixed(2), +(y1 - base).toFixed(2)], query }));

const server = await createServer({ server: { port: 5194, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://localhost:5194/?${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 240000 });
  await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 240000 });
  let placed = null;
  if (!args.includes("--bare")) {
    placed = await page.evaluate(async (plan) => (await import("/scripts/assets/storefront-preview.js")).place(plan), { dir: "/assets/storefronts", items });
  }
  const f0 = await page.evaluate(() => window.__atl.frames);
  await page.waitForFunction((f) => window.__atl.frames > f + 6, f0, { timeout: 240000 });
  if (arg("--label")) {
    await page.evaluate((t) => {
      const d = document.createElement("div");
      d.textContent = t;
      d.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);top:34px;z-index:99;font:600 18px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.6);padding:6px 10px;border-radius:4px";
      document.body.appendChild(d);
    }, arg("--label"));
  }
  if (arg("--out")) await page.screenshot({ path: arg("--out"), timeout: 300000 });
  console.log(JSON.stringify({ placed, errors }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
