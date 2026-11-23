// Screenshots at the LOD switch, fade off (before) and on (after).
// Usage: node shots.mjs <baseURL> <outDir> <quality>
import { chromium } from "@playwright/test";
const [base, out, quality = "low", extra = ""] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--disable-dev-shm-usage"] });
const cam = (k) => [-125 + k, 9.5, -706, 20 + k, 16.5, -700];
const errors = [];
let switchStep = null;
for (const mode of ["1", "0"]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push(`${mode}: ${e}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${mode}: ${m.text()}`));
  await page.clock.install();
  await page.goto(`${base}/?level=beltline-eastside&mute=1&quality=${quality}&view=fixed&cam=${cam(0).join(",")}&lodfade=${mode}${extra}`);
  await page.waitForFunction(() => window.__atl?.ready && window.__atl.level.props?.loaded && window.__atl.frames > 5, null, { timeout: 180000 });
  await page.addStyleTag({ content: "* { visibility: hidden !important; } canvas { visibility: visible !important; }" });
  await page.clock.pauseAt(Date.now() + 1000);
  const frame = async (ms = 17) => {
    await page.clock.runFor(ms);
  };
  // Settle at k = 0.
  for (let i = 0; i < 4; i += 1) await frame(34);
  let k = 0;
  if (mode === "1") {
    let s0 = await page.evaluate(() => window.__atl.level.propFade.started);
    for (k = 1; k < 60; k += 1) {
      await page.evaluate((c) => window.__atl.setFixedCamera(...c), cam(k));
      await frame(1);
      const s = await page.evaluate(() => window.__atl.level.propFade.started);
      console.log("step", k, s - s0);
      if (s - s0 >= 3) break;
      s0 = s;
      await frame(34);
    }
    switchStep = k;
  }
  k = switchStep;
  await page.evaluate((c) => window.__atl.setFixedCamera(...c), cam(k - 0.5));
  for (let i = 0; i < 12; i += 1) await frame(34);
  await page.screenshot({ path: `${out}/${quality}-fade${mode}-a-before-switch.png` });
  await page.evaluate((c) => window.__atl.setFixedCamera(...c), cam(k));
  await frame(1);
  // Mid fade (0.15 s into 0.3 s).
  await frame(100);
  await frame(1);
  const info = await page.evaluate(() => window.__atl.level.propFade);
  await page.screenshot({ path: `${out}/${quality}-fade${mode}-b-mid-fade.png` });
  for (let i = 0; i < 12; i += 1) await frame(34);
  await page.screenshot({ path: `${out}/${quality}-fade${mode}-c-after.png` });
  console.log(mode, k, JSON.stringify(info));
  await page.close();
}
await browser.close();
console.log("errors", errors);
