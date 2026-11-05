// Cost and shots of the landmark GLBs in the real game (pbr look), day and
// night, at fixed cameras: draw calls, triangles, the landmark GPU texture
// memory (w x h x 4 x 4/3 per unique texture), and the GLB bytes.
//   node scripts/assets/landmarks-cost.mjs --root . --tag after --out shots [name ...]
// --root: the checkout to serve (e.g. a worktree of the BEFORE commit).
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const take = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const root = path.resolve(take("--root", "."));
const tag = take("--tag", "after");
const out = path.resolve(take("--out", "shots"));
const port = Number(take("--port", "5195"));
const times = take("--times", "13.5,21.5").split(",");
const extra = take("--extra", "");
fs.mkdirSync(out, { recursive: true });

// [name, cam: eye x, eye height over the ground, eye z, target x, target height, target z]
const SHOTS = [
  ["pcm-trail", [-98, 2.5, -812, -190, 22, -858]],
  ["new-realm-brewing", [64, 14, -424, 120, 8, -476]],
  ["telephone-factory-lofts", [208, 9, -312, 238, 3, -362]],
  ["bridge-ralph-mcgill", [196, 2.5, -266, 226, 1, -304]],
  ["pcm-wide", [-30, 48, -872, -232, 24, -850]],
  ["studioplex", [-226, 6, 878, -282, 3, 906]],
  ["pcm-140", [-80, 6, -760, -235, 20, -852]],
];
const want = args.length
  ? SHOTS.filter(([n]) => args.includes(n))
  : SHOTS.slice(0, 4);
const BASE =
  "level=beltline-eastside&quality=high&look=pbr&date=06-21&weather=clear&governor=0&view=fixed&mute=1&skater=capsule&npcs=0&cars=0";

const glbBytes = {};
const lmDir = path.join(root, "assets/landmarks");
for (const k of fs.readdirSync(lmDir)) {
  const f = path.join(lmDir, k, `${k}.glb`);
  if (fs.existsSync(f)) glbBytes[k] = fs.statSync(f).size;
}

const server = await createServer({
  root,
  configFile: path.join(root, "vite.config.js"),
  server: {
    port,
    strictPort: true,
    fs: { allow: [root, fs.realpathSync(path.join(root, "node_modules"))] },
  },
  logLevel: "error",
});
await server.listen();
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const results = [];
try {
  for (const [name, cam] of want) {
    for (const time of times) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
      });
      page.setDefaultTimeout(300000);
      page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
      await page.goto(
        `http://localhost:${port}/?${BASE}&time=${time}&cam=${cam.join(",")}${extra}`,
        { waitUntil: "commit" },
      );
      await page.waitForFunction(
        () => window.__atl?.ready && window.__atl.frames > 8,
        null,
        { timeout: 300000 },
      );
      await page.waitForFunction(
        () => (window.__atl.level.landmarks?.glb?.models ?? 8) >= 8,
        null,
        { timeout: 300000 },
      );
      const f = await page.evaluate(() => window.__atl.frames);
      await page.waitForFunction((f0) => window.__atl.frames > f0 + 6, f, {
        timeout: 300000,
      });
      const stats = await page.evaluate(() => {
        const r = window.__atl.rendererInfo;
        const lm = window.__atl.scene.getObjectByName("landmark-models");
        const tex = new Map();
        lm?.traverse((o) => {
          if (!o.isMesh) return;
          for (const m of [o.material].flat())
            for (const v of Object.values(m))
              if (v && v.isTexture && v.image)
                tex.set(v.uuid, [v.image.width, v.image.height]);
        });
        const gpu = [...tex.values()].reduce(
          (s, [w, h]) => s + w * h * 4 * (4 / 3),
          0,
        );
        return {
          ...r,
          landmarkTextures: tex.size,
          landmarkGpuMiB: +(gpu / 2 ** 20).toFixed(1),
          glb: window.__atl.level.landmarks?.glb ?? null,
        };
      });
      const file = `${name}-${time === times[0] ? "day" : "night"}-${tag}.png`;
      await page.screenshot({ path: path.join(out, file), timeout: 300000 });
      const row = { name, time, tag, ...stats, file };
      results.push(row);
      console.log(JSON.stringify(row));
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
fs.writeFileSync(
  path.join(out, `cost-${tag}.json`),
  JSON.stringify(
    {
      glbBytes,
      glbTotal: Object.values(glbBytes).reduce((a, b) => a + b, 0),
      results,
    },
    null,
    2,
  ),
);
