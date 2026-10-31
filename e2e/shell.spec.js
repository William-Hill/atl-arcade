import { expect, test } from "@playwright/test";
import { collectConsoleErrors } from "./helpers/console.js";

test("the shell boots and renders with no console errors", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/");
  await expect(page.locator("#stage")).toBeVisible();
  await page.waitForFunction(() => window.__atl?.ready === true, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__atl.ticks > 30, null, { timeout: 20000 });

  const info = await page.evaluate(() => ({
    frames: window.__atl.frames,
    draws: window.__atl.rendererInfo.calls,
    triangles: window.__atl.rendererInfo.triangles,
    canvasWidth: document.getElementById("stage").width,
  }));

  expect(info.frames).toBeGreaterThan(0);
  expect(info.draws).toBeGreaterThan(0);
  expect(info.triangles).toBeGreaterThan(0);
  expect(info.canvasWidth).toBeGreaterThan(0);

  await page.screenshot({ path: "e2e/__screenshots__/shell.png" });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
