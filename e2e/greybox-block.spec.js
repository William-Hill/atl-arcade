import { expect, test } from "@playwright/test";
import { GREYBOX_BLOCK } from "../src/levels/greybox-block.js";
import { colliderCountFor } from "./helpers/level-counts.js";
import { collectConsoleErrors } from "./helpers/console.js";

test.describe("the greybox block", () => {
  test("loads with a Rapier collider for every object", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/?view=fixed");
    await page.waitForFunction(() => window.__atl?.ready === true, null, { timeout: 20000 });

    const info = await page.evaluate(() => ({
      levelId: window.__atl.levelId,
      objectCount: window.__atl.objectCount,
      colliderCount: window.__atl.colliderCount,
      triangles: window.__atl.rendererInfo.triangles,
    }));

    expect(info.levelId).toBe(GREYBOX_BLOCK.id);
    expect(info.objectCount).toBe(GREYBOX_BLOCK.objects.length);
    // One per box, one per stair tread, one per rail segment, one trimesh per ramp.
    expect(info.colliderCount).toBe(colliderCountFor(GREYBOX_BLOCK));
    expect(info.triangles).toBeGreaterThan(0);
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("matches the reference screenshot from the fixed camera", async ({ page }) => {
    await page.goto("/?view=fixed");
    await page.waitForFunction(() => window.__atl?.ready === true, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__atl.frames > 10, null, { timeout: 20000 });

    await expect(page.locator("#stage")).toHaveScreenshot("greybox-block.png", {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    });
  });

  test("draws the collider overlay on demand", async ({ page }) => {
    await page.goto("/?view=fixed");
    await page.waitForFunction(() => window.__atl?.ready === true, null, { timeout: 20000 });

    expect(await page.evaluate(() => window.__atl.collidersVisible)).toBe(false);
    expect(await page.evaluate(() => window.__atl.setColliderDebug(true))).toBe(true);
    await page.waitForFunction(() => window.__atl.frames > 10, null, { timeout: 20000 });

    // The overlay is a LineSegments that Rapier refills from the world each
    // frame, so a non-empty buffer means real colliders were drawn.
    const vertices = await page.evaluate(() => window.__atl.colliderDebugVertices);
    expect(vertices).toBeGreaterThan(100);

    await page.screenshot({ path: "e2e/__screenshots__/greybox-colliders.png" });
  });

  test("starts with the overlay up when asked by URL", async ({ page }) => {
    await page.goto("/?view=fixed&debug=colliders");
    await page.waitForFunction(() => window.__atl?.ready === true, null, { timeout: 20000 });
    expect(await page.evaluate(() => window.__atl.collidersVisible)).toBe(true);
  });
});

test("the quarter-pipe reads as a transition from the roll-in", async ({ page }) => {
  await page.goto("/?view=fixed&cam=ramp");
  await page.waitForFunction(() => window.__atl?.ready === true, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__atl.frames > 10, null, { timeout: 20000 });

  await expect(page.locator("#stage")).toHaveScreenshot("greybox-ramp.png", {
    maxDiffPixelRatio: 0.01,
    animations: "disabled",
  });
});
