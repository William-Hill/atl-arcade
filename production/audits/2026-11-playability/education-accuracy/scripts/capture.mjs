// Read-only audit script. Takes headless Playwright screenshots of the
// BeltLine level at landmarks and signs. Vite must run on port 5183:
//   npx vite --port 5183 --strictPort
//   node production/audits/2026-11-playability/education-accuracy/scripts/capture.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const OUT = "production/audits/2026-11-playability/education-accuracy/screenshots";
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5183/?level=beltline-eastside&mute=1&view=fixed";
// cam = x,y,z,lookX,lookY,lookZ (local meters; y over the terrain).
const SHOTS = [
  { name: "pcm-from-h4w-park", cam: "-150,70,-420,-215,45,-900", vp: [1280, 720], note: "The reference photo view: from Historic Fourth Ward Park, looking north at the tower and the sign" },
  { name: "pcm-sign-from-trail", cam: "-70,25,-860,-151,52,-857", vp: [1280, 720], note: "From the trail side, east of Ponce City Market" },
  { name: "ksm-front", cam: "-10,2,849,-48,6,849", vp: [1280, 720], note: "Krog Street Market front, about 38 m east, eye height" },
  { name: "sign-closed-lake-ave", cam: "83,2.6,683,76.26,3,675.95", vp: [1280, 720], note: "Street sign at Brickworks Cir / Closed Lake Ave" },
  { name: "phone-pcm-sign-844x390", cam: "-70,25,-860,-151,52,-857", vp: [844, 390], note: "Phone landscape (iPhone 14 CSS size), same view as pcm-sign-from-trail" },
  { name: "phone-street-sign-844x390", cam: "83,2.6,683,76.26,3,675.95", vp: [844, 390], note: "Phone landscape, street sign at about 9 m" },
];

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=metal"] });
const results = [];
for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: s.vp[0], height: s.vp[1] }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}&quality=high&cam=${s.cam}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__atl.level.landmarks && window.__atl.level.landmarks.towers >= 2, null, { timeout: 90000 }).catch(() => errors.push("landmarks not ready"));
  await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 90000 }).catch(() => errors.push("props not ready"));
  await page.waitForTimeout(1500);
  const path = `${OUT}/${s.name}.jpg`;
  await page.screenshot({ path, type: "jpeg", quality: 78 });
  const hud = await page.evaluate(() => ({ shellInfo: document.getElementById("shell-info")?.getBoundingClientRect().toJSON(), attribution: document.getElementById("attribution")?.getBoundingClientRect().toJSON(), quality: window.__atl.quality ?? null }));
  results.push({ ...s, path, errors, hud });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
