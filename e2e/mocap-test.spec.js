import { test, expect } from "@playwright/test";

// The GVHMR evaluation clip (docs/research/2026-11-21-gvhmr-mocap-test.md)
// loads on Nia in the skater viewer with ?clips=, and its frames pose the
// rig. The game does not ship this clip.
const CLIP_GLB = "/assets/skaters/nia/mocap-test/mocap_test_push.glb";
// MOCAP_SHOT=<path.png> saves the front sheet as evidence.
const SHOT = process.env.MOCAP_SHOT;

test("the mocap test clip plays on Nia", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/skater.html?skater=nia&clips=${encodeURIComponent(CLIP_GLB)}`);
  await page.waitForFunction(() => window.__skater?.ready || window.__skater?.error, null, { timeout: 60000 });
  expect(await page.evaluate(() => window.__skater.error)).toBeNull();
  const clips = await page.evaluate(() => window.__skater.clips);
  expect(clips).toContain("mocap_test_push");
  expect(clips).toContain("push");

  const info = await page.evaluate(() => window.__skater.sheet("mocap_test_push", 6, "front"));
  expect(info.duration).toBeGreaterThan(1.5);
  expect(info.tracks).toBeGreaterThan(10);
  // Two sheets of the same clip at other times differ: the bones move.
  const a = await page.screenshot({ path: SHOT });
  await page.evaluate(() => window.__skater.sheet("mocap_test_push", 5, "left"));
  const b = await page.screenshot();
  expect(a.equals(b)).toBe(false);
  expect(errors).toEqual([]);
});
