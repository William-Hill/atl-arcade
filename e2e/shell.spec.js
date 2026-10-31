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
