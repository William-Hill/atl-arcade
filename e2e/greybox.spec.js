import { expect, test } from "@playwright/test";

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test("the greybox block matches the reference from a fixed camera", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/?view=fixed");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });

  const info = await page.evaluate(() => ({
    name: window.__atl.level.name,
    triangles: window.__atl.rendererInfo.triangles,
  }));
  expect(info.name).toBe("greybox-block");
  expect(info.triangles).toBeGreaterThan(100);

  await expect(page).toHaveScreenshot("greybox.png", { maxDiffPixelRatio: 0.02 });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("every level object has a Rapier collider and the debug overlay draws them", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/?view=fixed&debug=1");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });

  const info = await page.evaluate(() => ({
    ids: window.__atl.level.ids,
    objectCount: window.__atl.level.objectCount,
    colliderCount: window.__atl.physics.colliderCount,
    collidersById: window.__atl.physics.collidersById,
    debugVisible: window.__atl.debug.visible,
    debugVertexCount: window.__atl.debug.vertexCount,
  }));

  expect(info.colliderCount).toBeGreaterThanOrEqual(info.objectCount);
  for (const id of info.ids) expect(info.collidersById[id], `collider for ${id}`).toBeGreaterThan(0);
  expect(info.debugVisible).toBe(true);
  expect(info.debugVertexCount).toBeGreaterThan(0);

  await page.screenshot({ path: "e2e/__screenshots__/greybox-colliders.png" });

  // The H key hides the overlay.
  await page.keyboard.press("KeyH");
  expect(await page.evaluate(() => window.__atl.debug.visible)).toBe(false);
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
