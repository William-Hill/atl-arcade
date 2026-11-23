import { expect, test } from "@playwright/test";

const VIEWS = ["front", "back", "left", "right", "three-quarter"];
import { SKATER_BODIES, SKATE_STACK } from "../src/sim/skate/body.js";

// The height range (m) of each skater, with the skates: the dossier height
// plus the skate (src/sim/skate/body.js), +-3 cm.
const SKATERS = Object.fromEntries(Object.entries(SKATER_BODIES).map(([n, b]) => [n, [b.height + SKATE_STACK - 0.03, b.height + SKATE_STACK + 0.03]]));

for (const [name, [minH, maxH]] of Object.entries(SKATERS)) {

test(`the ${name} GLB loads skinned with Draco and no console errors`, async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  const cdn = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol.startsWith("http") && url.hostname !== "localhost") cdn.push(req.url());
  });

  await page.goto(`/skater.html?skater=${name}`);
  await page.waitForFunction(() => window.__skater && (window.__skater.ready || window.__skater.error), null, {
    timeout: 30000,
  });
  const info = await page.evaluate(() => ({ error: window.__skater.error, ...window.__skater.info }));
  expect(info.error).toBeNull();
  expect(info.skinned).toBe(true);
  expect(info.bones).toBe(65);
  expect(info.triangles).toBeLessThan(20000);
  // The dossier height, wheels on the ground, centered on the origin.
  expect(info.min[1]).toBeCloseTo(0, 1);
  expect(info.max[1] - info.min[1]).toBeGreaterThan(minH);
  expect(info.max[1] - info.min[1]).toBeLessThan(maxH);

  for (const view of VIEWS) {
    await page.evaluate((v) => window.__skater.setView(v), view);
    await page.waitForTimeout(100);
    // Test evidence goes to e2e/__screenshots__/. The committed review views in
    // assets/skaters/<name>/views/ change only when someone copies them on purpose.
    await page.screenshot({ path: `e2e/__screenshots__/${name}-${view}.png` });
  }

  expect(cdn, `requests off localhost: ${cdn.join(" | ")}`).toEqual([]);
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
}
