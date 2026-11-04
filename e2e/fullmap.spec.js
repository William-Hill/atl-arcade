import { expect, test, devices } from "@playwright/test";

// The full map (src/ui/fullmap.js): M or the minimap expand button opens it
// over the game, the game stops, the wheel and the keys zoom and pan it, and
// M or Escape closes it. Screenshots: desktop overview, desktop zoom, phone.

const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars

async function ready(page) {
  await page.goto("/?level=beltline-eastside&mute=1");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5 && window.__atl.fullmap, null, { timeout: 60000 });
}

test("M opens the map at the overview, the game stops, and M closes it", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("KeyM");
  await expect(page.locator("#fullmap")).toBeVisible();
  await page.waitForFunction(() => window.__atl.fullmap.state.draws > 0);
  const t0 = await page.evaluate(() => window.__atl.ticks);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__atl.ticks)).toBe(t0);
  // The 3D layer (the baked isometric map) is the default; the plan layer
  // fits the whole level on the screen at the overview.
  expect(await page.evaluate(() => window.__atl.fullmap.state.layer)).toBe("iso");
  await page.screenshot({ path: "e2e/__screenshots__/fullmap-iso.png" });
  await page.keyboard.press("KeyV");
  expect(await page.evaluate(() => window.__atl.fullmap.state.layer)).toBe("plan");
  const view = await page.evaluate(() => window.__atl.fullmap.state.view);
  const level = await page.evaluate(() => window.__atl.level.bounds ?? null);
  if (level) expect(view.zoom * (level.maxZ - level.minZ)).toBeLessThanOrEqual(720);
  await page.screenshot({ path: "e2e/__screenshots__/fullmap-overview.png" });
  await page.keyboard.press("KeyV");
  expect(await page.evaluate(() => window.__atl.fullmap.state.layer)).toBe("iso");
  await page.keyboard.press("KeyM");
  await expect(page.locator("#fullmap")).toBeHidden();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__atl.ticks)).toBeGreaterThan(t0);
});

test("the wheel zooms, the keys pan, C centers on the skater, and Escape closes", async ({ page }) => {
  await ready(page);
  await page.locator("#minimap .minimap-expand").click();
  await expect(page.locator("#fullmap")).toBeVisible();
  await page.evaluate(() => window.__atl.fullmap.setLayer("plan"));
  const z0 = (await page.evaluate(() => window.__atl.fullmap.state.view)).zoom;
  await page.mouse.move(640, 360);
  for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, -300);
  const z1 = (await page.evaluate(() => window.__atl.fullmap.state.view)).zoom;
  expect(z1).toBeGreaterThan(z0 * 2);
  const x1 = (await page.evaluate(() => window.__atl.fullmap.state.view)).x;
  await page.keyboard.press("ArrowRight");
  expect((await page.evaluate(() => window.__atl.fullmap.state.view)).x).toBeGreaterThan(x1);
  await page.keyboard.press("KeyC");
  const v = await page.evaluate(() => window.__atl.fullmap.state.view);
  const p = await page.evaluate(() => window.__atl.skater.position);
  expect(Math.abs(v.x - p[0])).toBeLessThan(1);
  expect(Math.abs(v.z - p[2])).toBeLessThan(1);
  await page.waitForTimeout(200);
  await page.screenshot({ path: "e2e/__screenshots__/fullmap-zoom.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#fullmap")).toBeHidden();
});

test("photo mode blocks the map", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.__atl.photo.open());
  await page.keyboard.press("KeyM");
  await expect(page.locator("#fullmap")).toBeHidden();
});

test.describe("phone map", () => {
  test.use({ ...pixel, viewport: { width: 390, height: 844 } });

  test("the expand button opens the map, and the close button closes it", async ({ page }) => {
    await ready(page);
    await page.locator("#minimap .minimap-expand").click();
    await expect(page.locator("#fullmap")).toBeVisible();
    await page.waitForFunction(() => window.__atl.fullmap.state.draws > 0);
    await page.screenshot({ path: "e2e/__screenshots__/fullmap-phone.png" });
    const close = await page.locator("#fullmap .fullmap-close").boundingBox();
    expect(close.width).toBeGreaterThanOrEqual(44);
    await page.locator("#fullmap .fullmap-close").click();
    await expect(page.locator("#fullmap")).toBeHidden();
  });
});

test("fast travel: pick a landmark, press T, and the skater is there on the ground", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("KeyM");
  await expect(page.locator("#fullmap")).toBeVisible();
  expect(await page.evaluate(() => window.__atl.fullmap.state.travel)).toBe(true);
  const ksm = await page.evaluate(() => window.__atl.minimap.icons.find((i) => i.id === "krog-street-market"));
  await page.evaluate((icon) => window.__atl.fullmap.select(icon), ksm);
  await expect(page.locator("#fullmap .fullmap-travel")).toBeVisible();
  await page.keyboard.press("KeyT");
  await expect(page.locator("#fullmap")).toBeHidden();
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({ p: window.__atl.skater.position, state: window.__atl.skater.state }));
  expect(Math.hypot(s.p[0] - ksm.x, s.p[2] - ksm.z)).toBeLessThan(60);
  expect(s.state).toBe("rolling");
  await page.screenshot({ path: "e2e/__screenshots__/fullmap-travel.png" });
});

test("?travel=0 turns fast travel off", async ({ page }) => {
  await page.goto("/?level=beltline-eastside&mute=1&travel=0");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.fullmap, null, { timeout: 60000 });
  await page.keyboard.press("KeyM");
  expect(await page.evaluate(() => window.__atl.fullmap.state.travel)).toBe(false);
  await expect(page.locator("#fullmap .fullmap-travel")).toHaveCount(0);
});
