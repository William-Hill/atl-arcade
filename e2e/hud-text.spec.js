import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { BANKED_FADE_MS, BANKED_SHOW_MS } from "../src/ui/hud.js";
import { COMBO_LINE } from "../src/sim/skate/combo.js";
import { LINE_RESTART } from "../src/landmarks/play.js";
import { rideLineRestart } from "./landmark-rides.js";

// The HUD text of #269: a long combo line keeps a fixed length, the "+N" of
// a bank fades after a fixed time, and a restarted ring line says so.

const DATA = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/landmarks.json", import.meta.url), "utf8"));
const shot = (name) => `e2e/__screenshots__/hud-text-${name}.png`;

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon/.test(msg.location()?.url ?? "")) errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

// A push, then hops and dance moves in turn: a combo of 10 or more links.
const LONG_COMBO = [{ frames: 60, input: { push: true } }];
for (let i = 0; i < 6; i += 1) {
  LONG_COMBO.push({ frames: 1, input: { jump: true } }, { frames: 30, input: {} });
  LONG_COMBO.push({ frames: 1, input: { style1: true } }, { frames: 20, input: {} });
}

async function longCombo(page) {
  await page.goto("/?level=greybox&mute=1");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
  await page.evaluate((script) => {
    window.__ride = { done: false };
    window.__atl.runScript(script).then(() => (window.__ride = { done: true }));
  }, LONG_COMBO);
  await page.waitForFunction(() => window.__ride.done, null, { timeout: 60000 });
  return page.evaluate(() => ({ text: document.getElementById("hud-combo").textContent, links: window.__atl.combo.links.length, active: window.__atl.combo.active }));
}

for (const size of [
  { name: "desktop", viewport: { width: 1280, height: 720 }, k: COMBO_LINE.desktop },
  { name: "phone", viewport: { width: 844, height: 390 }, k: COMBO_LINE.phone },
]) {
  test.describe(`the combo line, ${size.name}`, () => {
    test.use({ viewport: size.viewport });

    test(`a long combo shows its last links and the count, then the +N fades (${size.name})`, async ({ page }) => {
      const errors = collectErrors(page);
      const end = await longCombo(page);
      expect(end.active).toBe(true);
      expect(end.links).toBeGreaterThan(size.k.maxLinks);
      expect(end.text.startsWith("… ")).toBe(true);
      expect(end.text.endsWith(` (${end.links})`)).toBe(true);
      expect(end.text.length).toBeLessThanOrEqual(size.k.maxChars + ` (${end.links})`.length);
      expect(end.text.split(" + ").length).toBeLessThanOrEqual(size.k.maxLinks);
      // The line stays on one line of the HUD.
      const box = await page.locator("#hud-combo").boundingBox();
      const lineHeight = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById("hud-combo")).fontSize) * 1.6);
      expect(box.height).toBeLessThan(lineHeight + 8);
      await page.screenshot({ path: shot(`combo-${size.name}`) });

      // The bank: the +N shows, then fades after a fixed time, then goes.
      await page.waitForFunction(() => !window.__atl.combo.active, null, { timeout: 5000 });
      const bankedAt = Date.now();
      await page.waitForTimeout(100);
      const banked = await page.evaluate(() => ({ text: document.getElementById("hud-combo").textContent, fade: document.getElementById("hud-combo").dataset.fade, last: window.__atl.combo.lastBanked }));
      expect(banked.text).toBe(`+${banked.last.toLocaleString("en-US")}`);
      expect(banked.fade).toBe("0");
      if (size.name === "desktop") await page.screenshot({ path: shot("banked-shows") });
      await page.waitForFunction(() => document.getElementById("hud-combo").dataset.fade === "1", null, { timeout: BANKED_SHOW_MS + 2000 });
      const fadeAfter = Date.now() - bankedAt;
      expect(fadeAfter).toBeGreaterThanOrEqual(BANKED_SHOW_MS - 300);
      await page.waitForFunction(() => document.getElementById("hud-combo").textContent === "", null, { timeout: BANKED_FADE_MS + 2000 });
      if (size.name === "desktop") await page.screenshot({ path: shot("banked-gone") });
      expect(errors, errors.join(" | ")).toEqual([]);
    });
  });
}

test("a ride back into ring 1 shows that the ring line restarted", async ({ page }) => {
  test.setTimeout(600000);
  const errors = collectErrors(page);
  const id = "telephone-factory-lofts";
  const s = DATA.spots.find((x) => x.id === id);
  const plan = rideLineRestart(id);
  expect(plan, "a restart ride in the pure simulation").not.toBeNull();
  await page.goto("/?level=beltline-eastside&mute=1&governor=0&weather=clear&time=14&cars=0&npcs=0&peds=0");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 240000 });
  await page.evaluate(
    ({ id, script, start }) => {
      window.__atl.landmarks.reset();
      window.__atl.landmarks.find(id);
      window.__goals = [];
      const rec = window.__goals;
      const tick = () => {
        if (window.__goals !== rec) return;
        const g = window.__atl.landmarkFx.goalLine;
        if (rec[rec.length - 1] !== g) rec.push(g);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__atl.runScript(script, start);
    },
    { id, script: plan.script, start: plan.start },
  );
  const n = s.challenge.checkpoints.length;
  const restarted = new RegExp(`^${LINE_RESTART}\\nRing 2 of ${n}: \\d+ s left$`);
  await page.waitForFunction((src) => new RegExp(src).test(window.__atl.landmarkFx.goalLine ?? ""), restarted.source, { timeout: 300000 });
  await page.screenshot({ path: shot("ring-line-restarted") });
  const goals = await page.evaluate(() => window.__goals);
  // The line ran before the restart, then the message shows, then it goes.
  const first = goals.findIndex((g) => restarted.test(g ?? ""));
  expect(goals.slice(0, first).some((g) => /^Ring 2 of \d: \d+ s left$/.test(g ?? ""))).toBe(true);
  await page.waitForFunction(() => /^Ring \d of \d: \d+ s left$/.test(window.__atl.landmarkFx.goalLine ?? "") || /^Claim it/.test(window.__atl.landmarkFx.goalLine ?? ""), null, { timeout: 10000 });
  expect(errors, errors.join(" | ")).toEqual([]);
});
