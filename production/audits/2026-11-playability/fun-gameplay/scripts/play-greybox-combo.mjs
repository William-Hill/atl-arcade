// The greybox combo line (grind, hop, dance, quarter pipe) with screenshots
// at set ticks. Needs Vite on port 5181. Writes 15-*.jpg to 17-*.jpg.
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const OUT = resolve(import.meta.dirname, "..");
const BAL = 0.55 / 2.2;
const script = [
  { frames: 90, input: { push: true } },
  { frames: 40, input: { grind: true, steer: BAL } },
  { frames: 1, input: { grind: true, steer: BAL, jump: true } },
  { frames: 45, input: {} },
  { frames: 1, input: { style1: true } },
  { frames: 40, input: {} },
  { frames: 260, input: { push: true } },
  { frames: 180, input: {} },
];
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await page.goto("http://localhost:5181/?mute=1");
await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 10, null, { timeout: 60000 });
await page.evaluate((s) => {
  window.__done = false;
  window.__atl.runScript(s, { position: [-26, 0, -2], yaw: 0 }).then(() => (window.__done = true));
}, script);
const shots = [
  { name: "15-greybox-dance-in-combo", when: (s) => s.style },
  { name: "16-greybox-vert-air", when: (s) => s.state === "air" && s.airFrom === "ramp" && s.airTime > 0.25 },
  { name: "17-greybox-combo-bank", when: (s) => s.links === 0 && s.score > 0 },
];
const out = [];
for (const shot of shots) {
  for (let i = 0; i < 400; i += 1) {
    const s = await page.evaluate(() => {
      const k = window.__atl.skater;
      return { style: k.style ? k.style.name : null, state: k.state, airFrom: k.airFrom, airTime: k.airTime, links: window.__atl.combo.links.length, score: window.__atl.combo.score, combo: document.getElementById("hud-combo").textContent, pending: document.getElementById("hud-pending").textContent, tick: window.__atl.ticks };
    });
    if (shot.when(s)) {
      await page.screenshot({ path: resolve(OUT, `${shot.name}.jpg`), type: "jpeg", quality: 72 });
      out.push({ shot: shot.name, ...s });
      break;
    }
    await page.waitForTimeout(25);
  }
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
