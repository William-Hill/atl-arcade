import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Issue #105: game feel. The tests:
// - a picture of each new effect (camera shake, speed field of view, landing
//   dust, wall-slide sparks) on the phone tier (toon) and the high tier
//   (pbr), at 14:00 in clear weather. The hooks hold each effect still;
// - real rides drive the effects from the controller flags: a slide along
//   the edge fence (sparks and the scrape), a 3 m drop (dust and a landing
//   sound from the fall height), a full-push ride into the edge fence (the
//   wider field of view, a bonk shake and a bonk sound);
// - the sounds play on the beat clock's context after the first key press;
// - prefers-reduced-motion keeps the camera still and draws no particles,
//   and the sounds stay on.

const BEL = "/?level=beltline-eastside&mute=1&time=14&weather=clear&governor=0&run=free&peds=0&skaters=0&traffic=0&minimap=0";

async function ready(page) {
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 200000 });
}

async function nextFrames(page, n) {
  const f = await page.evaluate(() => window.__atl.frames);
  await page.waitForFunction(([f0, k]) => window.__atl.frames >= f0 + k, [f, n], { timeout: 400000 });
}

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

for (const [quality, look] of [
  ["phone", "toon"],
  ["high", "pbr"],
]) {
  test(`a picture of each game-feel effect (${quality}, ${look})`, async ({ page }) => {
    test.setTimeout(1800000);
    const errors = collectErrors(page);
    await page.goto(`${BEL}&quality=${quality}&look=${look}`);
    await ready(page);
    await nextFrames(page, 6);
    const shot = (name) => page.screenshot({ path: `e2e/__screenshots__/feel-${name}-${quality}-${look}.png`, timeout: 300000 });

    // The reference: no effect.
    await shot("none");
    const base = await page.evaluate(() => window.__atl.feel.info.camera);
    expect(base.fovBoost).toBe(0);

    // Camera shake, held at its first peak (a quarter period of the shake).
    await page.evaluate(() => window.__atl.feel.trigger("shake", { strength: 1, hold: 1 / (4 * 23) }));
    await nextFrames(page, 2);
    const shake = (await page.evaluate(() => window.__atl.feel.info.camera)).shake;
    expect(Math.abs(shake.pitch)).toBeGreaterThan(0.012);
    await shot("shake");
    await page.evaluate(() => window.__atl.feel.trigger("shake", { strength: 0, hold: null }));

    // The speed field of view, held at the full boost.
    await page.evaluate(() => window.__atl.feel.holdFov(7));
    await nextFrames(page, 2);
    const wide = await page.evaluate(() => window.__atl.feel.info.camera);
    expect(wide.fov).toBeCloseTo(base.fov + 7, 5);
    await shot("fov");
    await page.evaluate(() => window.__atl.feel.holdFov(null));
    await nextFrames(page, 2);

    // Landing dust and wall-slide sparks, held still.
    for (const kind of ["dust", "sparks"]) {
      await page.evaluate((k) => {
        window.__atl.effects.clear();
        window.__atl.effects.hold(true);
        window.__atl.feel.trigger(k, { strength: 1 });
      }, kind);
      await nextFrames(page, 2);
      const info = await page.evaluate(() => window.__atl.effects.info);
      expect(info.bursts).toBeGreaterThan(kind === "dust" ? 3 : 6);
      expect(info.draws).toBe(1);
      await shot(kind);
      await page.evaluate(() => {
        window.__atl.effects.hold(false);
        window.__atl.effects.clear();
      });
    }
    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });
}

test("a slide along the edge fence makes sparks and a scrape; a 3 m drop makes dust and a landing sound", async ({ page }) => {
  test.setTimeout(400000);
  const errors = collectErrors(page);
  // The phone tier: the greybox level always runs the low tier, which has no particles.
  await page.goto(`${BEL}&quality=phone&look=toon`);
  await ready(page);
  const result = await page.evaluate(async () => {
    const { fence } = window.__atl.level;
    const feel = () => window.__atl.feel.info;
    // 1 m inside the east fence, heading north and a little east, steering
    // into the fence: a long wall slide.
    const x = fence.maxX - 1;
    const z = 176;
    const y = window.__atl.level.sample(x, z)?.height ?? 0;
    await window.__atl.runScript([{ frames: 120, input: { push: true, steer: -0.3 } }], { position: [x, y, z], yaw: Math.PI / 2 - 0.15 });
    const slide = feel();
    // A drop from 3 m over the ground, 45 m inside the fence.
    const dx = fence.maxX - 45;
    const dy = window.__atl.level.sample(dx, z)?.height ?? 0;
    await window.__atl.runScript([{ frames: 60 }], { position: [dx, dy + 3, z], yaw: 0 });
    return { slide, drop: feel() };
  });
  const { slide, drop } = result;
  expect(slide.effects.sparks).toBeGreaterThan(20);
  expect(slide.sfx.scrapeTicks).toBeGreaterThan(20);
  expect(slide.effects.bonk).toBe(0);
  expect(drop.effects.dust - slide.effects.dust).toBe(1);
  expect(drop.sfx.land - slide.sfx.land).toBeGreaterThanOrEqual(1);
  expect(drop.sfx.last.kind).toBe("land");
  // About 3 m of fall (the feet start 3 m over the ground; the ground can slope).
  expect(drop.sfx.last.height).toBeGreaterThan(2.3);
  expect(drop.sfx.last.height).toBeLessThan(3.5);
  mkdirSync("reports/feel", { recursive: true });
  writeFileSync("reports/feel/slide-drop.json", `${JSON.stringify({ date: new Date().toISOString(), ...result }, null, 2)}\n`);
  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("a full-push ride into the edge fence opens the field of view, then the bonk shakes and sounds", async ({ page }) => {
  test.setTimeout(600000);
  const errors = collectErrors(page);
  // No ?mute=1: a key press starts the beat clock, so the sounds play.
  await page.goto(BEL.replace("mute=1&", "") + "&quality=phone&look=toon&music=0");
  await ready(page);
  await page.keyboard.press("Shift");
  await page.waitForFunction(() => window.__atl.feel.info.sfx.running, null, { timeout: 30000 });
  const result = await page.evaluate(async () => {
    const { bounds } = window.__atl.level;
    const x = bounds.maxX - 45;
    const z = 176;
    const y = window.__atl.level.sample(x, z)?.height ?? 0;
    let maxBoost = 0;
    let shakeSeq = 0;
    const poll = setInterval(() => {
      const c = window.__atl.feel.info.camera;
      maxBoost = Math.max(maxBoost, c.fovBoost);
      shakeSeq = Math.max(shakeSeq, c.shake.seq);
    }, 16);
    await window.__atl.runScript([{ frames: 420, input: { push: true } }], { position: [x, y, z], yaw: 0 });
    clearInterval(poll);
    return { maxBoost, shakeSeq, info: window.__atl.feel.info, fx: window.__atl.effects.info };
  });
  expect(result.fx.triggers.bonk).toBeGreaterThanOrEqual(1);
  expect(result.maxBoost).toBeGreaterThan(0);
  expect(result.shakeSeq).toBeGreaterThanOrEqual(1);
  expect(result.info.sfx.bonk).toBeGreaterThanOrEqual(1);
  expect(result.info.sfx.played).toBeGreaterThanOrEqual(1);
  mkdirSync("reports/feel", { recursive: true });
  writeFileSync("reports/feel/fence-ride.json", `${JSON.stringify({ date: new Date().toISOString(), ...result }, null, 2)}\n`);
  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("prefers-reduced-motion: no shake, no wider view, no particles; the sounds stay", async ({ page }) => {
  test.setTimeout(400000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${BEL}&quality=phone&look=toon`);
  await ready(page);
  const info = await page.evaluate(async () => {
    window.__atl.feel.trigger("shake", { strength: 1, hold: 1 / 92 });
    window.__atl.feel.trigger("dust", { strength: 1 });
    const { fence } = window.__atl.level;
    const z = 176;
    const x = fence.maxX - 1;
    const y = window.__atl.level.sample(x, z)?.height ?? 0;
    let maxBoost = 0;
    const poll = setInterval(() => {
      maxBoost = Math.max(maxBoost, window.__atl.feel.info.camera.fovBoost);
    }, 16);
    await window.__atl.runScript([{ frames: 120, input: { push: true, steer: -0.3 } }], { position: [x, y, z], yaw: Math.PI / 2 - 0.15 });
    const dx = fence.maxX - 45;
    const dy = window.__atl.level.sample(dx, z)?.height ?? 0;
    await window.__atl.runScript([{ frames: 60 }], { position: [dx, dy + 3, z], yaw: 0 });
    clearInterval(poll);
    return { maxBoost, feel: window.__atl.feel.info, fx: window.__atl.effects.info };
  });
  expect(info.fx.reducedMotion).toBe(true);
  expect(info.feel.camera.shake).toMatchObject({ amp: 0, pitch: 0, yaw: 0, roll: 0 });
  expect(info.maxBoost).toBe(0);
  expect(info.fx.bursts).toBe(0);
  expect(info.fx.triggers.dust + info.fx.triggers.sparks).toBe(0);
  expect(info.feel.sfx.land).toBeGreaterThanOrEqual(1);
  expect(info.feel.sfx.scrapeTicks).toBeGreaterThan(20);
});
