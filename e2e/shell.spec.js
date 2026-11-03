import { expect, test } from "@playwright/test";

test("the shell renders a Three.js scene with no console errors", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto("/");
  await expect(page.locator("#stage")).toBeVisible();

  // Wait for the fixed-step loop to have driven real simulation ticks.
  await page.waitForFunction(() => window.__atl && window.__atl.ticks > 30, null, { timeout: 15000 });

  const info = await page.evaluate(() => ({
    shell: window.__atl.shell,
    ticks: window.__atl.ticks,
    frames: window.__atl.frames,
    draws: window.__atl.rendererInfo.calls,
    triangles: window.__atl.rendererInfo.triangles,
    canvasWidth: document.getElementById("stage").width,
  }));

  expect(info.shell).toBe("skate-atl");
  expect(info.frames).toBeGreaterThan(0);
  expect(info.draws).toBeGreaterThan(0);
  expect(info.triangles).toBeGreaterThan(0);
  expect(info.canvasWidth).toBeGreaterThan(0);

  await page.screenshot({ path: "e2e/__screenshots__/shell.png" });

  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("the skater select menu loads the other skater on the BeltLine", async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto("/?level=beltline&mute=1");
  const menu = page.locator("#skater-select");
  await expect(menu.locator("button")).toHaveCount(2);
  await expect(menu.locator('button[data-skater="nia"]')).toHaveAttribute("aria-pressed", "true");
  await page.waitForFunction(() => window.__atl && window.__atl.skaterModel.loaded, null, { timeout: 60000 });

  await menu.locator('button[data-skater="marcus"]').click();
  await page.waitForURL(/skater=marcus/);
  expect(new URL(page.url()).searchParams.get("level")).toBe("beltline");
  await page.waitForFunction(() => window.__atl && window.__atl.skaterModel.loaded, null, { timeout: 60000 });
  expect(await page.evaluate(() => window.__atl.skaterModel.name)).toBe("marcus");
  await expect(page.locator('#skater-select button[data-skater="marcus"]')).toHaveAttribute("aria-pressed", "true");
  // The menu takes no keyboard focus, so Space still goes to the game.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.screenshot({ path: "e2e/__screenshots__/skater-select-marcus.png" });

  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
