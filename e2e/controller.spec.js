import { expect, test } from "@playwright/test";
import { createSkateState, runScript } from "../src/sim/skate/controller.js";
import { createLevelEnv } from "../src/level/ground.js";
import { bodyFor, skateFor } from "../src/sim/skate/body.js";
// The page rides Nia (the default skater): the pure side uses her body constants.
const NIA = skateFor(bodyFor("nia"));
import { GREYBOX } from "../src/level/greybox.js";

// The same script runs in node through the pure controller and in the
// browser through the game loop. The end positions must agree.
const SCRIPT = [
  { frames: 90, input: { push: true } },
  { frames: 40, input: { steer: 1 } },
  { frames: 1, input: { jump: true } },
  { frames: 50, input: {} },
  { frames: 40, input: { steer: -1, push: true } },
  { frames: 45, input: { brake: true } },
];

test("the capsule follows the controller and a scripted run lands within tolerance", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  const env = createLevelEnv(GREYBOX);
  const expected = runScript(createSkateState({ position: GREYBOX.spawn.position, yaw: GREYBOX.spawn.yaw }), SCRIPT, { env, k: NIA }).state;

  await page.goto("/?level=greybox&view=orbit");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });

  const actual = await page.evaluate((script) => window.__atl.runScript(script), SCRIPT);

  expect(actual.tick).toBe(expected.tick);
  for (let i = 0; i < 3; i += 1) expect(Math.abs(actual.position[i] - expected.position[i])).toBeLessThan(0.01);
  expect(Math.abs(actual.yaw - expected.yaw)).toBeLessThan(0.001);
  expect(Math.abs(actual.speed - expected.speed)).toBeLessThan(0.01);
  expect(actual.state).toBe("rolling");
  // The script moved the skater well away from the spawn.
  expect(Math.hypot(actual.position[0] - GREYBOX.spawn.position[0], actual.position[2] - GREYBOX.spawn.position[2])).toBeGreaterThan(10);

  await page.screenshot({ path: "e2e/__screenshots__/controller-run.png" });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("keyboard input drives the skater", async ({ page }) => {
  await page.goto("/?level=greybox&view=orbit");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });
  const start = await page.evaluate(() => window.__atl.skater.position[0]);
  await page.keyboard.down("KeyW");
  try {
    // Poll: a slow frame loop advances fewer ticks per wall-clock second.
    await expect.poll(() => page.evaluate(() => window.__atl.skater.position[0]), { timeout: 10000 }).toBeGreaterThan(start + 1);
  } finally {
    await page.keyboard.up("KeyW");
  }
});
