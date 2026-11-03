import { expect, test } from "@playwright/test";

// Face decal states in the close-up view. The screenshots are the review evidence.
const FACES = [
  ["open", "neutral"],
  ["half", "neutral"],
  ["closed", "smile"],
  ["happy", "open"],
  ["open", "smile"],
  ["open", "open"],
];

test("the face decals change the eyes and the mouth", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/skater.html?skater=nia&view=face");
  await page.waitForFunction(() => window.__skater && (window.__skater.ready || window.__skater.error), null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__skater.error)).toBeNull();
  expect(await page.evaluate(() => window.__skater.info.face)).toBe(true);

  // The eyes and the mouth in the 1280 x 720 close-up.
  const eyes = { x: 440, y: 230, width: 400, height: 110 };
  const mouth = { x: 520, y: 400, width: 240, height: 110 };
  const shots = {};
  for (const [e, m] of FACES) {
    await page.evaluate(([a, b]) => window.__skater.setFace(a, b), [e, m]);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `assets/skaters/nia/face/views/${e}-${m}.png` });
    shots[`${e}-${m}`] = { eyes: await page.screenshot({ clip: eyes }), mouth: await page.screenshot({ clip: mouth }) };
  }
  expect(shots["closed-smile"].eyes.equals(shots["open-neutral"].eyes)).toBe(false);
  expect(shots["half-neutral"].eyes.equals(shots["open-neutral"].eyes)).toBe(false);
  expect(shots["happy-open"].eyes.equals(shots["closed-smile"].eyes)).toBe(false);
  expect(shots["open-smile"].mouth.equals(shots["open-neutral"].mouth)).toBe(false);
  expect(shots["open-open"].mouth.equals(shots["open-smile"].mouth)).toBe(false);
  // The eye state does not touch the mouth.
  expect(shots["half-neutral"].mouth.equals(shots["open-neutral"].mouth)).toBe(true);
  await expect(page.evaluate(() => window.__skater.setFace("wink", "smile"))).rejects.toThrow(/Unknown eye state/);
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("in the game Nia smiles while she stands and blinks", async ({ page }) => {
  await page.goto("/?mute=1");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.skaterModel.loaded, null, { timeout: 30000 });
  const seen = await page.evaluate(async () => {
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 7000) {
      out.push(window.__atl.skaterModel.face);
      await new Promise((r) => setTimeout(r, 15));
    }
    return out;
  });
  expect(seen.every((f) => f && f.mouth === "smile")).toBe(true);
  const eyes = new Set(seen.map((f) => f.eyes));
  expect(eyes.has("open")).toBe(true);
  expect(eyes.has("closed") || eyes.has("half")).toBe(true);
});
