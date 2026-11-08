import { expect, test } from "@playwright/test";

// #231: at the spawn, and after a respawn before the first move, the skater
// model faces the sim heading, and the follow camera is behind the skater.

const SKATERS = ["nia", "marcus"];
const FIVE_DEG = (5 * Math.PI) / 180;
// The Beltline spawn heading, on the greybox level.
const RESPAWN = { position: [-24, 0, 0], yaw: 1.464 };

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// The model rotation, the clip, the lean and the camera, from window.__atl.
function readSpawn() {
  const a = window.__atl;
  const c = a.cameraState;
  return {
    yaw: a.skater.yaw,
    speed: a.skater.speed,
    position: [...a.skater.position],
    rotation: a.skaterRotation,
    facing: a.skaterModel.facing,
    clip: a.skaterModel.clip,
    lean: a.skaterModel.lean,
    camera: c ? [...c.position] : null,
  };
}

// The camera is behind the skater: the horizontal direction from the
// skater to the camera is the back of the heading, within 5 degrees.
function expectCameraBehind(r) {
  const dx = r.camera[0] - r.position[0];
  const dz = r.camera[2] - r.position[2];
  expect(Math.hypot(dx, dz)).toBeLessThan(15);
  const back = Math.atan2(-dz, dx); // the yaw of the skater-to-camera direction
  expect(Math.abs(wrap(back - (r.yaw + Math.PI)))).toBeLessThan(FIVE_DEG);
}

function expectFacesHeading(r) {
  expect(Math.abs(wrap(r.rotation.y - r.yaw))).toBeLessThan(FIVE_DEG);
  expect(Math.abs(r.rotation.x)).toBeLessThan(FIVE_DEG);
  expect(Math.abs(r.rotation.z)).toBeLessThan(FIVE_DEG);
  expect(Math.abs(wrap(r.facing))).toBeLessThan(FIVE_DEG);
}

// Waits for two frames, then holds the render for a screenshot.
const holdAfterFrames = () =>
  new Promise((resolve) => {
    const a = window.__atl;
    a.renderPaused = false;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        a.renderPaused = true;
        resolve();
      }),
    );
  });

for (const name of SKATERS) {
  test(`${name} faces the heading at the spawn and after a respawn (#231)`, async ({ page }) => {
    test.setTimeout(90000);
    const errors = collectErrors(page);
    await page.goto(`/?level=greybox&mute=1&skater=${name}`);
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.skaterModel.loaded, null, { timeout: 30000 });
    await page.waitForTimeout(500);

    // The first spawn, at speed 0.
    const load = await page.evaluate(readSpawn);
    expect(Math.abs(load.speed)).toBeLessThan(0.1);
    expectFacesHeading(load);
    expectCameraBehind(load);
    expect(load.clip).toBe("idle");
    await page.screenshot({ path: `e2e/__screenshots__/spawn-231-${name}.png` });

    // Push and carve left on the old heading, then respawn while the render
    // is paused, as the Autopilot does. No frame runs between the respawn
    // and the read.
    const keys = await page.evaluate(() => window.__atl.input.bindings.keyboard);
    await page.keyboard.down(keys.push[0]);
    await page.keyboard.down(keys.left[0]);
    await page.waitForTimeout(1500);
    const moving = await page.evaluate(readSpawn);
    expect(moving.clip).not.toBe("idle");
    const respawn = await page.evaluate((start) => {
      const a = window.__atl;
      a.renderPaused = true;
      a.resetSkater(start.position, start.yaw);
      const c = a.cameraState;
      return {
        yaw: a.skater.yaw,
        speed: a.skater.speed,
        position: [...a.skater.position],
        rotation: a.skaterRotation,
        facing: a.skaterModel.facing,
        clip: a.skaterModel.clip,
        lean: a.skaterModel.lean,
        camera: c ? [...c.position] : null,
      };
    }, RESPAWN);
    await page.keyboard.up(keys.push[0]);
    await page.keyboard.up(keys.left[0]);
    expect(respawn.yaw).toBeCloseTo(RESPAWN.yaw);
    expectFacesHeading(respawn);
    expect(respawn.clip).toBe("idle");
    expect(respawn.lean).toBe(0);

    // The first frames after the respawn keep the heading.
    await page.evaluate(holdAfterFrames);
    const after = await page.evaluate(readSpawn);
    expectFacesHeading(after);
    expectCameraBehind(after);
    expect(after.clip).toBe("idle");
    expect(Math.abs(after.lean)).toBeLessThan(0.01);
    await page.screenshot({ path: `e2e/__screenshots__/respawn-231-${name}.png` });
    await page.evaluate(() => {
      window.__atl.renderPaused = false;
    });

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
}
