// BEFORE / AFTER screenshots of the skate features in the real game renderer
// (pbr look), at identical cameras: BEFORE is the game as it is
// (index.html), AFTER is scripts/assets/skate-features-preview.html (every
// feature laid out in a plaza). Also logs window.__atl.rendererInfo (calls,
// triangles, textures, geometries) per shot. Serial runs.
//   node scripts/assets/skate-features-shots.mjs --out docs/skate-features [--only after] [--plaza x,z,yaw] [name ...]
import { writeFileSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const take = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const out = take("--out", "docs/skate-features");
const onlyTag = take("--only", null);
const plaza = take("--plaza", "311.5,-85.2,-1.403");
const [px, pz, pyaw = 0] = plaza.split(",").map(Number);
// Plaza space to world (the same yaw as toWorld in src/level/skate-features.js).
const cy = Math.cos(pyaw);
const sy = Math.sin(pyaw);
const wx = (dx, dz) => px + dx * cy + dz * sy;
const wz = (dx, dz) => pz - dx * sy + dz * cy;
// [name, cam relative to the plaza: eye dx, eye height over the ground, eye dz, target dx, target height, target dz]
const SHOTS = [
  ["plaza-wide", [0, 12, 30, 0, 0, 0]],
  ["rails", [-14, 2.5, -4, -1, 0.4, -13]],
  ["stairs", [2, 3.2, 5.5, 0, 0.8, -0.5]],
  ["ledges", [0, 2.6, 11.5, 0, 0.4, 6.5]],
  ["benches", [6.8, 2.8, -2.6, 6.8, 0.3, -6.5]],
  ["ramps", [-1, 3.2, 21, 0, 0.5, 12.5]],
  ["quarter", [-5, 2.2, 18.5, -6.5, 0.6, 13]],
];
const want = args.length ? SHOTS.filter(([n]) => args.includes(n)) : SHOTS;
const BASE =
  "level=beltline-eastside&quality=high&look=pbr&date=06-21&time=13.5&weather=clear&governor=0&view=fixed&mute=1&skater=capsule&npcs=0&cars=0";
const tags = [
  ["before", "/"],
  ["after", "/scripts/assets/skate-features-preview.html"],
].filter(([t]) => !onlyTag || t === onlyTag);

const server = await createServer({
  server: { port: 5195, strictPort: true },
  logLevel: "error",
});
await server.listen();
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const log = [];
try {
  for (const [name, c] of want) {
    const cam = [
      wx(c[0], c[2]),
      c[1],
      wz(c[0], c[2]),
      wx(c[3], c[5]),
      c[4],
      wz(c[3], c[5]),
    ].map((v) => +v.toFixed(2));
    for (const [tag, path] of tags) {
      // A fresh page per shot: a heavy pbr page can stall the next navigation.
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
      });
      page.setDefaultTimeout(300000);
      page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
      await page.goto(
        `http://localhost:5195${path}?${BASE}&plaza=${plaza}&cam=${cam.join(",")}`,
        { waitUntil: "commit" },
      );
      await page.waitForFunction(
        () => window.__atl?.ready && window.__atl.frames > 8,
        null,
        { timeout: 300000 },
      );
      if (tag === "after")
        await page.waitForFunction(() => window.__skateFeatures?.ready, null, {
          timeout: 300000,
        });
      const f = await page.evaluate(() => window.__atl.frames);
      await page.waitForFunction((f0) => window.__atl.frames > f0 + 6, f, {
        timeout: 300000,
      });
      await page.screenshot({
        path: `${out}/${name}-${tag.toUpperCase()}.png`,
      });
      const r = await page.evaluate(() => ({
        renderer: window.__atl.rendererInfo,
        features: window.__skateFeatures
          ? {
              models: window.__skateFeatures.models.length,
              grindables: window.__skateFeatures.grindables,
            }
          : null,
      }));
      log.push({ name, tag, cam, ...r });
      console.log(name, tag, JSON.stringify(r));
      await page.close();
    }
  }
} finally {
  writeFileSync(
    `${out}/shots-${onlyTag ?? "all"}.json`,
    JSON.stringify(log, null, 2) + "\n",
  );
  await browser.close();
  await server.close();
}
