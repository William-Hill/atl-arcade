import { expect, test, devices } from "@playwright/test";

// #94: the settings menu. O or the SETTINGS button opens it; a tier change
// saves to localStorage and applies on a reload; a URL flag wins over the
// saved value; the ink switches at once; the menu works with no storage.

const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

async function ready(page, query = "") {
  await page.goto(`/?level=beltline-eastside&mute=1&landmarks=0&props=0${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 90000 });
}

test("the menu opens, shows the auto tier, and a tier change applies on a reload", async ({ page }) => {
  test.setTimeout(240000);
  const errors = collectErrors(page);
  await ready(page);
  // Headless Chromium renders with SwiftShader: the auto tier is low.
  expect(await page.evaluate(() => window.__atl.render.quality)).toBe("low");

  // The button clears the photo button, the minimap and the help text.
  const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const toggle = await page.locator("#settings-toggle").boundingBox();
  for (const sel of ["#photo-toggle", "#minimap", "#attribution"]) expect(overlap(toggle, await page.locator(sel).boundingBox()), sel).toBe(false);
  await page.screenshot({ path: "e2e/__screenshots__/settings-desktop-button.png" });

  await page.locator("#settings-toggle").click();
  const menu = page.getByRole("dialog", { name: "SETTINGS" });
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => window.__atl.settings.isOpen)).toBe(true);
  // The three tiers and the auto tier, with labels.
  await expect(menu.getByRole("radio", { name: /Auto: Low/ })).toBeChecked();
  for (const name of ["Low", "Phone", "High"]) await expect(menu.getByRole("radio", { name: new RegExp(`^${name}`) })).toBeVisible();
  for (const name of ["Shadows", "Ink outlines", "Bloom"]) await expect(menu.getByRole("checkbox", { name: new RegExp(name) })).toBeVisible();
  await expect(menu.getByLabel("Walkers")).toBeVisible();
  // The low tier has no post chain: the live toggles are off with a reason.
  await expect(page.locator("#settings-bloom")).toBeDisabled();
  // The game stops while the menu is open.
  const t0 = await page.evaluate(() => window.__atl.ticks);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__atl.ticks)).toBe(t0);
  await page.screenshot({ path: "e2e/__screenshots__/settings-desktop.png" });

  await menu.getByRole("radio", { name: /^Phone/ }).check();
  await expect(page.locator("#settings-status")).toContainText("Reload to apply the quality tier");
  await expect(page.locator("#settings-reload")).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("atl.settings.v1")));
  expect(saved.quality).toBe("phone");

  await page.locator("#settings-reload").click();
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5 && window.__atl.render.quality === "phone", null, { timeout: 90000 });
  expect(await page.evaluate(() => window.__atl.render.post)).toBe("lite");

  // The ink switches at once on the phone tier.
  await page.keyboard.press("KeyO");
  await expect(menu).toBeVisible();
  await expect(page.locator("#settings-quality-phone")).toBeChecked();
  await page.locator("#settings-ink").uncheck();
  await expect(page.locator("#settings-status")).toContainText("Applied");
  expect(await page.evaluate(() => window.__atl.post.ink.uniforms.strength.value)).toBe(0);
  // Escape closes the menu and gives the focus back to the button.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator("#settings-toggle")).toBeFocused();
  // Space is the jump key: with the focus on the button it must not open the
  // menu again.
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__atl.settings.isOpen)).toBe(false);

  // A URL flag wins over the saved tier.
  await ready(page, "&quality=low");
  expect(await page.evaluate(() => window.__atl.render.quality)).toBe("low");
  await page.locator("#settings-toggle").click();
  await expect(page.locator("#settings-quality-low")).toBeChecked();
  await expect(page.locator("#settings-quality-note")).toContainText("page address");
  expect(errors).toEqual([]);
});

test("the menu works when localStorage throws", async ({ page }) => {
  test.setTimeout(180000);
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await ready(page);
  await page.keyboard.press("KeyO");
  await page.locator("#settings-quality-high").check();
  await expect(page.locator("#settings-status")).toContainText("this page only");
  // With no storage, the reload carries the choice in the URL flag.
  await page.locator("#settings-reload").click();
  await page.waitForURL(/quality=high/, { timeout: 30000 });
  // The shadows have no URL flag, so they cannot apply without storage.
  await ready(page, "&quality=low");
  await page.keyboard.press("KeyO");
  await page.locator("#settings-shadows").check();
  await expect(page.locator("#settings-status")).toContainText("cannot apply without saved settings");
  await expect(page.locator("#settings-reload")).toBeHidden();
  expect(errors.filter((e) => !/localStorage|SecurityError|blocked/.test(e))).toEqual([]);
});

test.describe("phone width", () => {
  test.use(pixel);

  test("the button and the menu fit a phone screen", async ({ page }) => {
    test.setTimeout(180000);
    const errors = collectErrors(page);
    await ready(page);
    const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const toggle = await page.locator("#settings-toggle").boundingBox();
    for (const sel of ["#photo-toggle", "#attribution", "#minimap", ".touch-jump", ".touch-grind", ".touch-style1", ".touch-style2", ".touch-stick-base", '#skater-select button[data-skater="nia"]', '#skater-select button[data-skater="marcus"]', "#fullscreen-toggle"]) {
      const box = await page.locator(sel).first().boundingBox();
      if (box) expect(overlap(toggle, box), sel).toBe(false);
    }
    // #97: the photo button also clears the skater select.
    const photoBox = await page.locator("#photo-toggle").boundingBox();
    for (const sel of ['#skater-select button[data-skater="nia"]', '#skater-select button[data-skater="marcus"]']) expect(overlap(photoBox, await page.locator(sel).boundingBox()), `photo x ${sel}`).toBe(false);
    await page.locator("#settings-toggle").tap();
    const menu = page.locator("#settings-menu");
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    const vw = page.viewportSize().width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vw);
    await page.screenshot({ path: "e2e/__screenshots__/settings-phone.png" });
    // Tap targets of 44 px or more (WCAG 2.5.5).
    for (const sel of ["#settings-toggle", "#settings-close", "#settings-peds", "#settings-menu .settings-option"]) {
      for (const b of await page.locator(sel).all()) expect((await b.boundingBox()).height, sel).toBeGreaterThanOrEqual(44);
    }
    await page.locator("#settings-close").tap();
    await expect(menu).toBeHidden();
    expect(errors).toEqual([]);
  });
});
