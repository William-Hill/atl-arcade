import { expect, test } from "@playwright/test";

// #87: on the low tier the coarse far terrain drew over the skater at the
// BeltLine spawn. A strip joins the tile of its first point, so the trail of
// a far tile ran under the spawn. The far terrain now uses the mesh bounds.

const FAR_TERRAIN_DISTANCE = 60; // m, the same value as src/render/geo-view.js

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test("low tier: no far terrain tile is near the camera at the BeltLine spawn", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/?level=beltline-eastside&mute=1&quality=low&governor=0");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__atl.skaterModel.loaded || window.__atl.skaterModel.error, null, { timeout: 60000 });
  expect(await page.evaluate(() => window.__atl.skaterModel.error)).toBeNull();
  expect(await page.evaluate(() => window.__atl.render.quality)).toBe("low");

  // Let the follow camera settle behind her.
  await page.waitForTimeout(800);
  const lod = await page.evaluate(() => window.__atl.level.terrainLod);
  // The far level of detail is on, and some tiles use it.
  expect(lod.tiles).toBeGreaterThan(0);
  expect(lod.far).toBeGreaterThan(0);
  // No far tile has a vertex near the camera.
  expect(lod.nearestFar).toBeGreaterThan(FAR_TERRAIN_DISTANCE);

  await page.screenshot({ path: "e2e/__screenshots__/far-terrain-spawn-low.png" });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

// #188: the high tier shows the coarse far ground past 350 m only (inside
// the fog), so a near tile never swaps.
test("high tier: the far terrain starts past 350 m", async ({ page }) => {
  test.setTimeout(240000);
  const errors = collectErrors(page);
  await page.goto("/?level=beltline-eastside&mute=1&quality=high&look=toon&governor=0&peds=0&cars=0&skaters=0&npcs=0");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 3, null, { timeout: 200000 });
  const lod = await page.evaluate(() => window.__atl.level.terrainLod);
  expect(lod.tiles).toBeGreaterThan(0);
  expect(lod.far).toBeGreaterThan(0);
  expect(lod.nearestFar).toBeGreaterThan(350);
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
