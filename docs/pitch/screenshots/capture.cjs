// Pitch screenshots from the production URL (#258).
// node docs/pitch/screenshots/capture.cjs <out-dir> <high|phone>
const { chromium, devices } = require("playwright");
const OUT = process.argv[2];
const TIER = process.argv[3];
const BASE = "https://skate-atl.vercel.app/";
const COMMON = "level=beltline-eastside&mute=1&weather=clear&time=14&travel=1&teach=0";
const spots = [
  ["spawn-skatepark", null],
  ["skatepark", [272.3, -1.5]],
  ["fourth-ward-park", [-130.1, -456.6]],
  ["ponce-city-market", [-111.5, -895.5]],
  ["krog-street-market", [-98.3, 890]],
  ["freedom-park-fact", [280.69, 227.13]],
];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--ignore-gpu-blocklist"] });
  const ctxOpts = TIER === "phone"
    ? { ...devices["Pixel 7 landscape"] }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const q = TIER === "phone" ? "quality=phone" : "quality=high&look=pbr";
  // 1. Title screen
  await page.goto(`${BASE}?${COMMON}&${q}&intro=title`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${TIER}-00-loader.jpg`, quality: 85, timeout: 600000 });
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 1800000 });
  log("loaded");
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/${TIER}-01-title.jpg`, quality: 85, timeout: 600000 });
  log("title", JSON.stringify(await page.evaluate(() => document.body.innerText.slice(0, 300))));
  // 2. Tour mode run, no intro
  await page.goto(`${BASE}?${COMMON}&${q}&intro=0&run=tour`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 1800000 });
  log("tour loaded");
  await page.waitForTimeout(8000);
  let i = 2;
  for (const [name, at] of spots) {
    if (at) { await page.evaluate(([x, z]) => window.__atl.fastTravel(x, z), at); await page.waitForTimeout(TIER === "phone" ? 9000 : 60000); }
    await page.screenshot({ path: `${OUT}/${TIER}-${String(i++).padStart(2, "0")}-${name}.jpg`, quality: 85, timeout: 600000 });
    log(name, JSON.stringify(await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400))));
  }
  log("ERRORS", JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
