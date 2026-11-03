// A human-style play of the BeltLine level with real key presses, plus a
// scripted grind on the greybox (the BeltLine has no rails).
// Needs a Vite server on port 5181: npx vite --port 5181 --strictPort
// Usage: node production/audits/2026-11-playability/fun-gameplay/scripts/play-beltline.mjs
// Writes screenshots and play-log.json next to this folder.

import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const OUT = resolve(import.meta.dirname, "..");
const BASE = "http://localhost:5181";
const log = { startedAt: new Date().toISOString(), load: [], steps: [] };
const load = () => execSync("uptime").toString().trim();
log.load.push(load());

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });

async function snap(page, name) {
  await page.screenshot({ path: resolve(OUT, `${name}.jpg`), type: "jpeg", quality: 72 });
}

async function state(page) {
  return page.evaluate(() => {
    const a = window.__atl;
    const s = a.skater;
    const c = a.combo;
    const txt = (id) => document.getElementById(id)?.textContent ?? null;
    const vis = (id) => {
      const e = document.getElementById(id);
      return e ? getComputedStyle(e).display !== "none" && getComputedStyle(e).opacity !== "0" : false;
    };
    return {
      tick: a.ticks,
      frames: a.frames,
      state: s.state,
      speed: Number(s.speed.toFixed(2)),
      pos: s.position.map((v) => Number(v.toFixed(1))),
      bonked: s.bonked,
      style: s.style ? s.style.name : null,
      stats: s.stats,
      score: c.score,
      links: c.links.length,
      pending: c.pending,
      multiplier: c.multiplier,
      lastBanked: c.lastBanked,
      styleMeter: c.style,
      signatureReady: c.signatureReady,
      hud: { score: txt("hud-score"), combo: txt("hud-combo"), pending: txt("hud-pending"), tag: txt("hud-tag"), hint: vis("hud-hint") ? txt("hud-hint") : null },
    };
  });
}

async function step(page, label, fn, shot) {
  const t0 = Date.now();
  if (fn) await fn();
  const s = await state(page);
  if (shot) await snap(page, shot);
  log.steps.push({ label, wallMs: Date.now() - t0, shot: shot ? `${shot}.jpg` : null, ...s });
  console.log(label, JSON.stringify({ state: s.state, speed: s.speed, links: s.links, score: s.score, tag: s.hud.tag, tick: s.tick }));
}

const hold = async (page, keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
};
const tap = async (page, key) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(120);
  await page.keyboard.up(key);
};

// ---- BeltLine, desktop viewport, real keys ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const tLoad = Date.now();
  await page.goto(`${BASE}/?level=beltline-eastside&mute=1`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 10, null, { timeout: 120000 });
  log.loadMs = Date.now() - tLoad;
  await page.waitForTimeout(1500);
  log.quality = await page.evaluate(() => window.__atl.quality);
  log.grindablesNote = await page.evaluate(() => window.__atl.level.objectCount);
  log.visibleText = await page.evaluate(() => document.body.innerText);
  await step(page, "t00 first view, no input", null, "01-first-view");
  await step(page, "t03 idle 3 s", () => page.waitForTimeout(3000), null);
  await step(page, "push: hold W 3 s", () => hold(page, ["KeyW"], 3000), "02-push");
  await step(page, "steer: hold W+A 1.2 s", () => hold(page, ["KeyW", "KeyA"], 1200), "03-steer");
  await step(page, "jump: tap Space, shot in air", async () => {
    await page.keyboard.down("Space");
    await page.waitForTimeout(150);
  }, "04-jump-air");
  await page.keyboard.up("Space");
  await step(page, "land", () => page.waitForTimeout(800), null);
  await step(page, "grind: hold W+F 3 s (no rails on this level)", () => hold(page, ["KeyW", "KeyF"], 3000), "05-grind-attempt-beltline");
  await step(page, "dance: press Q, shot mid-dance", async () => {
    await page.keyboard.down("KeyW");
    await page.keyboard.down("KeyQ");
    await page.waitForTimeout(500);
  }, "06-dance");
  await page.keyboard.up("KeyQ");
  await page.keyboard.up("KeyW");
  await step(page, "dance chain: alternate Q and E for 6 s while pushing", async () => {
    await page.keyboard.down("KeyW");
    for (let i = 0; i < 5; i += 1) {
      await tap(page, i % 2 ? "KeyE" : "KeyQ");
      await page.waitForTimeout(1000);
    }
    await page.keyboard.up("KeyW");
  }, "07-combo-open");
  // Wait for the bank and catch the +score flash.
  let banked = null;
  for (let i = 0; i < 30 && !banked; i += 1) {
    await page.waitForTimeout(150);
    const s = await state(page);
    if (s.links === 0 && s.score > 0) banked = s;
  }
  await step(page, "combo bank", null, "08-combo-bank");
  // Ride away from the trail at a building to look for a dead stop.
  await step(page, "turn right 1.4 s then push 6 s toward the buildings", async () => {
    await hold(page, ["KeyD", "KeyW"], 1400);
    await hold(page, ["KeyW"], 6000);
  }, "09-off-trail");
  let bonks = 0;
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(200);
    const s = await state(page);
    if (s.bonked || s.speed < 0.5) bonks += 1;
  }
  await page.keyboard.up("KeyW");
  await step(page, `push into the wall 4 s (stalled samples: ${bonks}/20)`, null, "10-wall-or-stall");
  log.wallStallSamples = bonks;
  // Respawn check: R is switch, not reset. Is there any restart or end?
  await step(page, "wait 20 s idle: does anything end the run?", () => page.waitForTimeout(20000), "11-idle-20s");
  log.beltlineErrors = errors;
  // Phone landscape view of the same page: HUD only, no touch controls exist.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(1500);
  await step(page, "phone landscape viewport 844x390", null, "12-phone-landscape");
  await ctx.close();
}

// ---- Greybox: scripted grind and combo (the BeltLine has no rails) ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?mute=1`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 10, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await snap(page, "13-greybox-first-view");
  const BAL = 0.55 / 2.2;
  // Push to the rail, then grind with balance; shot in the grind.
  const toRail = [{ frames: 90, input: { push: true } }, { frames: 40, input: { grind: true, steer: BAL } }];
  await page.evaluate((script) => window.__atl.runScript(script, { position: [-26, 0, -2], yaw: 0 }), toRail);
  await step(page, "greybox grind (scripted)", null, "14-greybox-grind");
  // Combo line from the playtest session: grind, hop, dance, push to the quarter pipe.
  const comboLine = [{ frames: 1, input: { grind: true, steer: BAL, jump: true } }, { frames: 45, input: {} }, { frames: 1, input: { style1: true } }, { frames: 40, input: {} }, { frames: 200, input: { push: true } }];
  await page.evaluate((script) => window.__atl.runScript(script), comboLine);
  await step(page, "greybox combo then quarter pipe", null, "15-greybox-combo");
  await page.evaluate(() => window.__atl.runScript([{ frames: 30, input: {} }]));
  await step(page, "greybox vert air", null, "16-greybox-vert");
  await page.evaluate(() => window.__atl.runScript([{ frames: 150, input: {} }]));
  await step(page, "greybox bank", null, "17-greybox-bank");
  await ctx.close();
}

await browser.close();
log.load.push(load());
writeFileSync(resolve(OUT, "play-log.json"), JSON.stringify(log, null, 2));
console.log("done", log.load);
