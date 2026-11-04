// BEFORE / AFTER screenshots of the landmark GLBs in the real game renderer
// (pbr look), at identical cameras: BEFORE is the game as it is
// (index.html), AFTER is scripts/assets/landmarks-preview.html. Serial runs.
//   node scripts/assets/landmarks-shots.mjs --out docs/landmarks [name ...]
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const oi = args.indexOf("--out");
const out = oi >= 0 ? args.splice(oi, 2)[1] : "docs/landmarks";
// [name, cam: eye x, eye height over the ground, eye z, target x, target height, target z]
const SHOTS = [
  ["pcm-trail", [-98, 2.5, -812, -190, 22, -858]],
  ["pcm-wide", [-30, 48, -872, -232, 24, -850]],
  ["telephone-factory-lofts", [208, 9, -312, 238, 3, -362]],
  ["new-realm-brewing", [64, 14, -424, 120, 8, -476]],
  ["studioplex", [-232, 9, 856, -282, 2, 920]],
  ["bridge-freedom-parkway", [337, 1.7, 42, 338, 5, -30]],
  ["bridge-north-ave", [-12, 3, -716, -56, 1, -708]],
  ["bridge-ralph-mcgill", [256, 3, -334, 224, 2, -302]],
  ["bridge-ponce", [-88, 4, -962, -124, 1, -952]],
];
const want = args.length ? SHOTS.filter(([n]) => args.includes(n)) : SHOTS;
const BASE = "level=beltline-eastside&quality=high&look=pbr&date=06-21&time=13.5&weather=clear&governor=0&view=fixed&mute=1&skater=capsule&npcs=0&cars=0";

const server = await createServer({ server: { port: 5193, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  for (const [name, cam] of want) {
    for (const [tag, path] of [["before", "/"], ["after", "/scripts/assets/landmarks-preview.html"]]) {
      // A fresh page per shot: a heavy pbr page can stall the next navigation.
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.setDefaultTimeout(300000);
      page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
      await page.goto(`http://localhost:5193${path}?${BASE}&cam=${cam.join(",")}`, { waitUntil: "commit" });
      await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 8, null, { timeout: 300000 });
      if (tag === "after") await page.waitForFunction(() => window.__landmarkGlb?.ready, null, { timeout: 300000 });
      const f = await page.evaluate(() => window.__atl.frames);
      await page.waitForFunction((f0) => window.__atl.frames > f0 + 6, f, { timeout: 300000 });
      await page.screenshot({ path: `${out}/${name}-${tag}.png` });
      console.log(name, tag, "ok");
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
