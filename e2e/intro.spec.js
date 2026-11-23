import { expect, test, devices } from "@playwright/test";

// The intro and the title screen (#301). The pure phase logic has Vitest
// tests (src/ui/intro.test.js). Playwright runs under WebDriver, so the game
// starts without the intro unless ?intro=1 or ?intro=title asks for it.
// Screenshots: e2e/__screenshots__/intro-*.png.

const SHOTS = "e2e/__screenshots__";
const QUERY = "level=beltline-eastside&mute=1&governor=0&weather=clear&time=14&cars=0&npcs=0&peds=0";

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

async function open(page, extra) {
  await page.goto(`/?${QUERY}${extra}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 3, null, { timeout: 240000 });
}

// The software renderer is slow: stop the render for the picture.
async function shot(page, name) {
  await page.evaluate(() => (window.__atl.renderPaused = true));
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.evaluate(() => (window.__atl.renderPaused = false));
}

const phase = (page) => page.evaluate(() => window.__atl.front.phase);

test.describe("intro and title screen", () => {
  test.setTimeout(600000);

  test("high tier: the intro plays, a key skips it, a key starts the game", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, "&quality=high&intro=1");
    expect(await page.evaluate(() => window.__atl.render.quality)).toBe("high");
    expect(await phase(page)).toBe("intro");
    await expect(page.locator("#front")).toHaveAttribute("data-phase", "intro");
    await expect(page.locator("#front .front-logo")).toBeVisible();
    // The HUD hides; the ODbL attribution stays.
    await expect(page.locator("#hud")).toBeHidden();
    await expect(page.locator("#attribution")).toBeVisible();
    // The flight moves along the trail.
    const f0 = (await page.evaluate(() => window.__atl.front.state)).flight;
    await expect.poll(async () => (await page.evaluate(() => window.__atl.front.state)).flight, { timeout: 60000 }).toBeGreaterThan(f0 + 5);
    await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.querySelector("#front .front-logo")).opacity)), { timeout: 60000 }).toBeGreaterThan(0.9);
    await shot(page, "intro-high-1-flight");

    // A key skips the intro.
    await page.keyboard.press("KeyW");
    expect(await phase(page)).toBe("title");
    await expect(page.locator("#front")).toHaveAttribute("data-phase", "title");
    await expect(page.locator("#front .front-press")).toHaveText("Press any key");
    await expect(page.locator("#front #skater-select button")).toHaveCount(2);
    await expect(page.locator("#front .front-settings")).toBeVisible();
    // The return visit flag is set.
    expect(await page.evaluate(() => localStorage.getItem("atl.intro.v1"))).toBe("1");
    // The skater does not move and the timer does not run on the title screen.
    const pos0 = await page.evaluate(() => [...window.__atl.skater.position]);
    await page.waitForFunction(() => window.__atl.skaterModel.loaded, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    const pos1 = await page.evaluate(() => [...window.__atl.skater.position]);
    expect(Math.hypot(pos1[0] - pos0[0], pos1[2] - pos0[2])).toBeLessThan(0.05);
    await shot(page, "intro-high-2-title");

    // The Settings button opens the settings menu; the title screen stays.
    await page.locator("#front .front-settings").click();
    await expect.poll(() => page.evaluate(() => window.__atl.settings.isOpen)).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => window.__atl.settings.isOpen)).toBe(false);
    expect(await phase(page)).toBe("title");

    // A key starts the game: the first game frame follows.
    const framesBefore = await page.evaluate(() => window.__atl.frames);
    await page.keyboard.press("Space");
    expect(await phase(page)).toBe("play");
    await expect(page.locator("#front")).toHaveCount(0);
    await page.waitForFunction((n) => window.__atl.frames > n + 2, framesBefore, { timeout: 60000 });
    await expect(page.locator("#hud")).toBeVisible();
    // The skater select is back in the game HUD.
    await expect(page.locator("body > #skater-select")).toHaveCount(1);
    const events = await page.evaluate(() => window.__atl.events.map((e) => e.type));
    expect(events).toContain("front-play");
    // The follow camera has the skater in view.
    const s = await page.evaluate(() => window.__atl.projectSkater());
    expect(Math.abs(s.x)).toBeLessThan(1);
    expect(Math.abs(s.y)).toBeLessThan(1);
    await page.waitForTimeout(1000);
    await shot(page, "intro-high-3-play");
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("the intro ends by itself and goes to the title screen", async ({ page }) => {
    await open(page, "&intro=1");
    await expect.poll(() => phase(page), { timeout: 300000, intervals: [1000] }).toBe("title");
  });

  test("phone tier: a tap skips the intro and a tap starts the game", async ({ browser }) => {
    const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars
    const context = await browser.newContext({ ...pixel, viewport: { width: 844, height: 390 } });
    const page = await context.newPage();
    const errors = collectErrors(page);
    await open(page, "&quality=phone&intro=1");
    expect(await page.evaluate(() => window.__atl.render.quality)).toBe("phone");
    expect(await phase(page)).toBe("intro");
    await expect(page.locator("#front .front-skip")).toHaveText("Tap to skip");
    await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.querySelector("#front .front-logo")).opacity)), { timeout: 60000 }).toBeGreaterThan(0.9);
    await shot(page, "intro-phone-1-flight");
    await page.touchscreen.tap(422, 200);
    expect(await phase(page)).toBe("title");
    await expect(page.locator("#front .front-press")).toHaveText("Tap to start");
    // The buttons fit on the screen and are 44 px high or more.
    for (const b of await page.locator("#front button").all()) {
      const box = await b.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.y + box.height).toBeLessThanOrEqual(390);
    }
    // A tap on a skater button does not start the game.
    await page.locator("#front #skater-select button[data-skater=nia]").tap();
    expect(await phase(page)).toBe("title");
    await page.waitForFunction(() => window.__atl.skaterModel.loaded, null, { timeout: 120000 });
    await shot(page, "intro-phone-2-title");
    await page.touchscreen.tap(422, 200);
    expect(await phase(page)).toBe("play");
    const n = await page.evaluate(() => window.__atl.frames);
    await page.waitForFunction((k) => window.__atl.frames > k + 2, n, { timeout: 60000 });
    await shot(page, "intro-phone-3-play");
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
    await context.close();
  });

  test("reduced motion: no camera flight, the title screen shows a still camera", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "&intro=1");
    expect(await page.evaluate(() => window.__atl.front.plan)).toEqual({ start: "title", reason: "reduced-motion" });
    expect(await phase(page)).toBe("title");
    const a = await page.evaluate(() => ({ ...window.__atl.front.state }));
    await page.waitForFunction((n) => window.__atl.frames > n + 5, await page.evaluate(() => window.__atl.frames), { timeout: 60000 });
    const b = await page.evaluate(() => ({ ...window.__atl.front.state }));
    expect(b.orbit).toBe(a.orbit);
    expect(b.flight).toBe(a.flight);
    expect(b.t).toBeGreaterThan(a.t);
  });

  test("?intro=0 and a WebDriver browser go straight to the game", async ({ page }) => {
    await open(page, "&intro=0");
    expect(await phase(page)).toBe("play");
    await expect(page.locator("#front")).toHaveCount(0);
    await open(page, "");
    expect(await page.evaluate(() => window.__atl.front.plan)).toEqual({ start: "play", reason: "webdriver" });
    await expect(page.locator("#hud")).toBeVisible();
  });
});
