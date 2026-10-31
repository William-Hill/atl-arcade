import { expect, test } from "@playwright/test";
import { GREYBOX_BLOCK } from "../src/levels/greybox-block.js";
import { FIXED_DT } from "../src/sim/fixed-step.js";
import { createSkater, createWorld, runScript } from "../src/sim/skate/controller.js";
import { expandScript } from "../src/sim/skate/input-script.js";
import { collectConsoleErrors } from "./helpers/console.js";

// One script, run twice: once here in Node, once in the browser. If the
// controller is really pure and really fixed-step, the two agree exactly.
// A lap: push up to speed, carve a full-lock arc, ollie, carve again, brake
// to a stop. Tuned to stay on the block, so nothing here depends on the
// respawn net firing.
const SCRIPT = [
  { for: 1.8, input: { push: true } },
  { for: 1.2, input: { push: true, steer: 1 } },
  { for: 0.9, input: { steer: 1 } },
  { for: 0.6, input: { steer: 0.3 }, tap: ["jump"] },
  { for: 1.4, input: { push: true, steer: 1 } },
  { for: 1.6, input: { brake: true } },
];

const expected = runScript(
  createSkater(GREYBOX_BLOCK),
  expandScript(SCRIPT, FIXED_DT),
  FIXED_DT,
  createWorld(GREYBOX_BLOCK),
);

test.describe("the skate controller in the browser", () => {
  test("replays an input script to the same end position as Node", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/?view=fixed");
    await page.waitForFunction(() => window.__atl?.ready === true, null, { timeout: 20000 });

    const actual = await page.evaluate((script) => window.__atl.runScript(script), SCRIPT);

    // Tolerance is 1 mm. The two runs should agree to floating point, so
    // anything looser would be hiding a real difference.
    expect(actual.position.x).toBeCloseTo(expected.position.x, 3);
    expect(actual.position.y).toBeCloseTo(expected.position.y, 3);
    expect(actual.position.z).toBeCloseTo(expected.position.z, 3);
    expect(actual.yaw).toBeCloseTo(expected.yaw, 6);
    expect(actual.speed).toBeCloseTo(expected.speed, 6);
    expect(actual.state).toBe(expected.state);
    expect(actual.jumps).toBe(expected.jumps);
    expect(actual.respawns).toBe(0);

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("the script actually moved the skater somewhere interesting", async ({ page }) => {
    await page.goto("/?view=fixed");
    await page.waitForFunction(() => window.__atl?.ready === true, null, { timeout: 20000 });

    const start = await page.evaluate(() => window.__atl.reset());
    const end = await page.evaluate((script) => window.__atl.runScript(script), SCRIPT);

    const travelled = Math.hypot(end.position.x - start.position.x, end.position.z - start.position.z);
    expect(travelled).toBeGreaterThan(15);
    expect(end.jumps).toBe(1);
    // The lap stays on the block, so the safety net never has to fire.
    expect(end.respawns).toBe(0);
    expect(end.speed).toBe(0);
    expect(end.grounded).toBe(true);
  });

  test("the frame loop lands in the same place as the batch run", async ({ page }) => {
    await page.goto("/?view=fixed");
    await page.waitForFunction(() => window.__atl?.ready === true, null, { timeout: 20000 });

    const steps = await page.evaluate((script) => window.__atl.playScript(script), SCRIPT);
    expect(steps).toBe(Math.round((1.8 + 1.2 + 0.9 + 0.6 + 1.4 + 1.6) * 60));

    // Played out across real animation frames, with whatever frame rate the
    // machine happens to give. The fixed-step accumulator should make that
    // irrelevant.
    await page.waitForFunction(() => window.__atl.scriptEndState !== null, null, { timeout: 40000 });
    const played = await page.evaluate(() => window.__atl.scriptEndState);

    expect(played.position.x).toBeCloseTo(expected.position.x, 3);
    expect(played.position.y).toBeCloseTo(expected.position.y, 3);
    expect(played.position.z).toBeCloseTo(expected.position.z, 3);
    expect(played.yaw).toBeCloseTo(expected.yaw, 6);
    expect(played.jumps).toBe(1);
    expect(played.respawns).toBe(0);

    await page.screenshot({ path: "e2e/__screenshots__/skater-after-script.png" });
  });

  test("resets to the spawn on demand", async ({ page }) => {
    await page.goto("/?view=fixed");
    await page.waitForFunction(() => window.__atl?.ready === true, null, { timeout: 20000 });

    await page.evaluate((script) => window.__atl.runScript(script), SCRIPT);
    const reset = await page.evaluate(() => window.__atl.reset());

    expect(reset.position).toEqual(GREYBOX_BLOCK.spawn.position);
    expect(reset.speed).toBe(0);
    expect(reset.state).toBe("coast");
  });
});
