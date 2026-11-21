// Touch play and HUD checks on the four phone profiles, both looks, phone
// tier. Real touches through CDP (pointerType "touch"). Writes touch.json
// and touch-*.jpg.
//
// For each profile and look:
//  1. The HUD layout at the start: the boxes, the overlaps, off-screen items,
//     the font sizes, and the text contrast on its own pill (worst case: a
//     white and a black scene) and on the scene behind it.
//  2. Touch play on BeltLine Eastside: tap to start the beat, push, steer,
//     brake, jump, GROOVE and SPIN, a drag on the open screen (camera look),
//     the switch control if it exists, and a ride into the east edge fence.
//  3. The HUD with the edge hint on.
// Grind is checked on the greybox level (a known straight rail), once per
// profile.
//   ONLY=Pixel7-port,toon limits the runs.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OUT, LEVEL_URL, PROFILES, launch, profile, waitReady, loadAverage, fingers, targets } from "./common.mjs";

const ONLY = process.env.ONLY?.split(",");
const browser = await launch();
const report = { load: loadAverage(), runs: [], grind: [] };

const state = (page) =>
  page.evaluate(() => {
    const s = window.__atl.skater;
    return { position: s.position.map((v) => +v.toFixed(2)), speed: +s.speed.toFixed(2), yaw: +s.yaw.toFixed(3), state: s.state, backward: Boolean(s.backward), style: s.style?.name ?? null, source: window.__atl.input.source, look: window.__atl.cameraLook ?? null, beat: window.__atl.beat?.running ?? null };
  });

const poll = async (page, fn, arg, ms = 8000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
    return true;
  } catch {
    return false;
  }
};

// The boxes of every visible item that a player reads or touches.
const ITEMS = [
  ["score", "#hud-score"],
  ["timer", "#hud-timer"],
  ["combo", "#hud-combo"],
  ["pending", "#hud-pending"],
  ["tag", "#hud-tag"],
  ["hint", "#hud-hint"],
  ["edgeHint", "#hud-edge"],
  ["style", ".hud-style"],
  ["balance", "#hud-balance"],
  ["pulse", "#hud-pulse"],
  ["credit", "#attribution .attr-short"],
  ["creditFull", "#attribution .attr-full"],
  ["skaterSelect", "#skater-select"],
  ["minimap", "#minimap"],
  ["photo", "#photo-toggle"],
  ["settings", "#settings-toggle"],
  ["fullscreen", "#fullscreen-toggle"],
  ["stick", ".touch-stick-base"],
  ["jump", ".touch-jump"],
  ["grind", ".touch-grind"],
  ["groove", ".touch-style1"],
  ["spin", ".touch-style2"],
  ["switch", ".touch-switch"],
  ["fact", "#fact-popup"],
];

function layout(page) {
  return page.evaluate((items) => {
    const out = [];
    for (const [name, sel] of items) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (el.hidden || cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      if (["combo", "pending", "tag"].includes(name) && !el.textContent.trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out.push({ name, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    }
    const hits = [];
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    // The stick zone is a whole-corner area; only its base is a target.
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) if (ov(out[i], out[j])) hits.push(`${out[i].name} x ${out[j].name}`);
    const off = out.filter((a) => a.x < 0 || a.y < 0 || a.x + a.w > innerWidth + 0.5 || a.y + a.h > innerHeight + 0.5).map((a) => a.name);
    // Touch target sizes.
    const small = out.filter((a) => ["jump", "grind", "groove", "spin", "switch", "photo", "settings", "fullscreen"].includes(a.name) && Math.min(a.w, a.h) < 44).map((a) => `${a.name} ${a.w}x${a.h}`);
    for (const b of document.querySelectorAll("#minimap button, #skater-select button")) {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && Math.min(r.width, r.height) < 44) small.push(`${b.getAttribute("aria-label") ?? b.textContent.trim().slice(0, 12)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    // Text: size and contrast on its own pill (worst scene: white, black).
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const lin = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const con = (a, b) => {
      const la = lum(a);
      const lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    const over = ([r, g, b, a = 1], [br, bg, bb]) => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
    const text = [];
    for (const el of document.querySelectorAll("#hud *, #attribution *, #skater-select *, #minimap *, .touch-btn, #photo-toggle, #settings-toggle, #fullscreen-toggle")) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0 || el.closest("[hidden]")) continue;
      // The pill: the first ancestor (or itself) with a background.
      let pill = [0, 0, 0, 0];
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const p = parse(getComputedStyle(n).backgroundColor);
        const a = p.length === 4 ? p[3] : 1;
        if (a > 0) {
          pill = p.length === 4 ? p : [...p, 1];
          break;
        }
      }
      const fg = parse(cs.color);
      const worst = Math.min(...[[255, 255, 255], [0, 0, 0]].map((scene) => {
        const bg = over(pill, scene);
        return con(over([...fg.slice(0, 3), (fg[3] ?? 1) * Number(cs.opacity)], bg), bg);
      }));
      text.push({ text: el.textContent.trim().slice(0, 28), px: parseFloat(cs.fontSize), worstContrast: +worst.toFixed(2), pillAlpha: +pill[3].toFixed(2), shadow: cs.textShadow !== "none", box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
    }
    return { inner: [innerWidth, innerHeight], items: out, overlaps: hits, offScreen: off, smallTargets: small, text, under14px: text.filter((t) => t.px < 14).map((t) => `${t.text} (${t.px}px)`), under45: text.filter((t) => t.worstContrast < 4.5).map((t) => `${t.text} (${t.worstContrast})`) };
  }, ITEMS);
}

for (const p of PROFILES) {
  for (const look of ["toon", "pbr"]) {
    if (ONLY && !ONLY.every((k) => p.key === k || look === k)) continue;
    const ctx = await browser.newContext(profile(p.device));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    // run=free: no goal timer and no results screen in the middle of the
    // checks. The layout check below runs once more with the timer on.
    // The walkers, the NPC skaters and the moving cars are off, as in
    // e2e/edge-fence.spec.js, so none of them stands in the fence lane.
    await page.goto(LEVEL_URL(`quality=phone&look=${look}&governor=0&run=free&time=14&weather=clear&peds=0&skaters=0&traffic=0`));
    await waitReady(page);
    await page.waitForTimeout(3000);
    const tag = `${p.key}-${look}`;
    await page.screenshot({ path: resolve(OUT, `touch-${tag}-start.jpg`), type: "jpeg", quality: 75 });
    const start = await layout(page);
    const t = await targets(page);
    const f = await fingers(page);
    const g = {};
    const s0 = await state(page);

    // Tap on the open screen (top center) to start the beat.
    await f.tap(9, t.viewport.w * 0.5, t.viewport.h * 0.3);
    g.tapStartsBeat = await poll(page, () => window.__atl.beat?.running === true, null, 4000);
    g.hintAfterTap = await page.evaluate(() => getComputedStyle(document.getElementById("hud-hint")).display);

    // CDP lifts one finger of two only when the last finger lifts (the
    // pointerup comes late). So each button press below is the only finger
    // down: push with the stick, let go (she keeps rolling), press.
    const pushTo = async (v) => {
      await f.start(1, t.stick.x, t.stick.y);
      await f.move(1, t.stick.x, t.stick.y - 50);
      const ok = await poll(page, (v) => window.__atl.skater.speed > v, v, 20000);
      await f.end(1);
      return ok;
    };
    const press = async (b, fn, ms = 4000) => {
      await f.start(2, t[b].x, t[b].y);
      const ok = await poll(page, fn, null, ms);
      await f.end(2);
      return ok;
    };
    // Push: stick up.
    g.push = await pushTo(4);
    g.afterPush = await state(page);
    // GROOVE and SPIN at speed: a dance starts.
    await pushTo(8);
    g.groove = await press("style1", () => window.__atl.skater.style?.button === 0);
    g.grooveName = await page.evaluate(() => window.__atl.skater.style?.name ?? null);
    await poll(page, () => !window.__atl.skater.style, null, 30000);
    await pushTo(8);
    g.spin = await press("style2", () => window.__atl.skater.style?.button === 1);
    g.spinName = await page.evaluate(() => window.__atl.skater.style?.name ?? null);
    await poll(page, () => !window.__atl.skater.style, null, 30000);
    // Steer: stick up-left turns left (yaw goes up), up-right turns right.
    await f.start(1, t.stick.x, t.stick.y);
    const yaw0 = (await state(page)).yaw;
    await f.move(1, t.stick.x - 50, t.stick.y - 30);
    g.steerLeft = await poll(page, (y0) => window.__atl.skater.yaw > y0 + 0.3, yaw0, 8000);
    const yaw1 = (await state(page)).yaw;
    await f.move(1, t.stick.x + 50, t.stick.y - 30);
    g.steerRight = await poll(page, (y1) => window.__atl.skater.yaw < y1 - 0.3, yaw1, 8000);
    await f.end(1);
    // Jump.
    await pushTo(6);
    g.beforeJump = await state(page);
    g.jump = await press("jump", () => window.__atl.skater.state === "air", 3000);
    await poll(page, () => window.__atl.skater.state === "rolling", null, 4000);
    // Brake: stick down.
    await pushTo(8);
    const v0 = (await state(page)).speed;
    await f.start(1, t.stick.x, t.stick.y);
    await f.move(1, t.stick.x, t.stick.y + 50);
    g.brake = await poll(page, (v) => window.__atl.skater.speed < Math.max(0.5, v * 0.4), v0, 8000);
    g.brakeFrom = v0;
    g.brakeTo = (await state(page)).speed;
    await f.end(1);

    // Switch (ride backward): a touch player has a control only if a
    // .touch-switch button exists.
    if (t.switch) {
      await pushTo(3);
      g.switch = await press("switch", () => window.__atl.skater.backward === true, 3000);
      g.switchBack = await press("switch", () => window.__atl.skater.backward === false, 3000);
    } else g.switch = "no control";

    // Camera look: a drag on the open screen (upper middle).
    const look0 = await page.evaluate(() => JSON.stringify(window.__atl.cameraLook ?? null));
    const cam0 = await page.evaluate(() => window.__atl.cameraPosition);
    const x = t.viewport.w * 0.55;
    const y = t.viewport.h * 0.3;
    await f.start(5, x, y);
    for (let i = 1; i <= 6; i++) {
      await f.move(5, x + i * 20, y);
      await page.waitForTimeout(30);
    }
    const lookDuring = await page.evaluate(() => JSON.stringify(window.__atl.cameraLook ?? null));
    await f.end(5);
    const cam1 = await page.evaluate(() => window.__atl.cameraPosition);
    g.cameraLook = { before: look0, during: lookDuring, cameraMovedM: +Math.hypot(cam1[0] - cam0[0], cam1[2] - cam0[2]).toFixed(2) };

    // The east edge fence: ride east into it with the stick up.
    const lane = await page.evaluate(() => {
      const { bounds, fence } = window.__atl.level;
      const x = bounds.maxX - 45;
      const z = 176;
      const y = window.__atl.level.sample(x, z)?.height ?? 0;
      return { x, y, z, fence };
    });
    // The lane rolls back west at rest, so the stick is up before the reset
    // and the push starts on the first tick (as runScript in the spec).
    await f.start(1, t.stick.x, t.stick.y);
    await f.move(1, t.stick.x, t.stick.y - 50);
    await page.evaluate((l) => window.__atl.resetSkater([l.x, l.y, l.z], 0), lane);
    g.edgeHint = await poll(page, () => !document.getElementById("hud-edge").hidden, null, 30000);
    await poll(page, (mx) => window.__atl.skater.position[0] > mx - 1.5, lane.fence?.maxX ?? 1e9, 30000);
    await page.waitForTimeout(1500);
    const atFence = await state(page);
    g.fence = { fenceMaxX: lane.fence?.maxX ?? null, skaterX: atFence.position[0], speed: atFence.speed, stopped: atFence.speed < 0.5 && atFence.position[0] < (lane.fence?.maxX ?? 1e9) };
    const fenceLayout = await layout(page);
    await page.screenshot({ path: resolve(OUT, `touch-${tag}-fence.jpg`), type: "jpeg", quality: 75 });
    await f.end(1);

    // The full HUD: a combo, the pending score, a move tag and the balance
    // meter, with the edge hint still on (render paused, like the phone
    // layout spec).
    await page.evaluate(() => {
      window.__atl.renderPaused = true;
      const combo = document.getElementById("hud-combo");
      combo.textContent = "Rail Grind + Hop + Bankhead Bounce";
      combo.dataset.active = "1";
      document.getElementById("hud-pending").textContent = "1,890 x 3";
      const tg = document.getElementById("hud-tag");
      tg.textContent = "PERFECT Bankhead Bounce";
      tg.style.opacity = "1";
      document.getElementById("hud-balance").style.display = "";
      document.getElementById("hud-edge").hidden = false;
      document.getElementById("hud-timer").hidden = false;
      document.getElementById("hud-timer").textContent = "1:42";
    });
    const fullLayout = await layout(page);
    await page.screenshot({ path: resolve(OUT, `touch-${tag}-fullhud.jpg`), type: "jpeg", quality: 75 });

    report.runs.push({ profile: p.key, device: p.device, look, tier: await page.evaluate(() => window.__atl.quality), start: s0, gestures: g, layoutStart: start, layoutAtFence: fenceLayout, layoutFullHud: fullLayout, errors });
    console.log(JSON.stringify({ tag, g, overlapsStart: start.overlaps, overlapsFence: fenceLayout.overlaps, overlapsFull: fullLayout.overlaps, off: fullLayout.offScreen, small: start.smallTargets, under14: fullLayout.under14px, under45: fullLayout.under45, errors }));
    await ctx.close();
  }
}

// Grind with touch only, on the greybox straight rail (as e2e/touch.spec.js).
for (const p of PROFILES) {
  if (ONLY && !ONLY.some((k) => p.key === k)) continue;
  const ctx = await browser.newContext(profile(p.device));
  const page = await ctx.newPage();
  await page.goto(`${LEVEL_URL("mute=1&quality=phone", "greybox")}`);
  await waitReady(page);
  const t = await targets(page);
  const f = await fingers(page);
  await page.evaluate(() => window.__atl.resetSkater([-26, 0, -2], 0));
  await f.start(1, t.stick.x, t.stick.y);
  await f.move(1, t.stick.x, t.stick.y - 50);
  await poll(page, () => window.__atl.skater.position[0] > -22, null, 15000);
  await f.move(1, t.stick.x, t.stick.y);
  await f.start(2, t.grind.x, t.grind.y);
  const grind = await poll(page, () => window.__atl.skater.state === "grind", null, 15000);
  await page.screenshot({ path: resolve(OUT, `touch-${p.key}-grind.jpg`), type: "jpeg", quality: 70 });
  await f.end(2);
  await f.end(1);
  report.grind.push({ profile: p.key, grind });
  console.log(JSON.stringify({ grind: p.key, ok: grind }));
  await ctx.close();
}

// Reduced motion: does the page read the media query?
{
  const ctx = await browser.newContext({ ...profile("Pixel 7"), reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(LEVEL_URL("mute=1&quality=phone"));
  await waitReady(page);
  report.reducedMotion = await page.evaluate(() => ({ matches: matchMedia("(prefers-reduced-motion: reduce)").matches, effects: window.__atl.effects?.info?.reducedMotion ?? null, fullscreenButton: Boolean(document.querySelector("#fullscreen-toggle")), viewportMeta: document.querySelector('meta[name="viewport"]')?.content }));
  await ctx.close();
}
await browser.close();
writeFileSync(resolve(OUT, process.env.OUTFILE ?? "touch.json"), JSON.stringify(report, null, 2));
