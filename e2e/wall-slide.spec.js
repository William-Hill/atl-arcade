import { expect, test } from "@playwright/test";

// Issue #58: the skater slides along a wall instead of a dead stop.
// Nia rolls east on the north sidewalk and turns 0.12 rad toward
// building-north (face at z = -10). She slides along the face, keeps
// moving, and her body stays one body radius (0.30 m) out of the wall.
const FACE = -10;
const BODY_RADIUS = 0.3;
const SCRIPT = [
  { frames: 60, input: { push: true } },
  { frames: 30, input: {} },
];

test("the skater slides along a greybox building on a shallow approach", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/?level=greybox&level=greybox");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });

  const result = await page.evaluate(async (script) => {
    window.__atl.recorder.start(1);
    const end = await window.__atl.runScript(script, { position: [-8, 0.15, -9.4], yaw: 0.12 });
    const samples = window.__atl.recorder.stop();
    return { end, minZ: Math.min(...samples.map((s) => s.skater[2])) };
  }, SCRIPT);

  expect(result.end.tick).toBe(SCRIPT.reduce((n, e) => n + e.frames, 0));
  expect(result.end.bonked).toBe(false);
  expect(result.end.speed).toBeGreaterThan(2);
  expect(result.end.position[0]).toBeGreaterThan(-6);
  // After the slide the heading is parallel to the wall face.
  expect(Math.abs(Math.sin(result.end.yaw))).toBeLessThan(1e-6);
  expect(result.end.position[2] - FACE).toBeGreaterThanOrEqual(BODY_RADIUS - 1e-9);
  expect(result.minZ - FACE).toBeGreaterThanOrEqual(BODY_RADIUS - 1e-6);

  await page.screenshot({ path: "e2e/__screenshots__/wall-slide.png" });
  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});
