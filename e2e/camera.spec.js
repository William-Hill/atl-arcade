import { expect, test } from "@playwright/test";

// A scripted lap: east along the street, a left U-turn onto the north
// sidewalk, west, a second U-turn, east again. Verified in node to have no
// wall hits.
const LAP = [
  { frames: 140, input: { push: true } },
  { frames: 70, input: {} },
  { frames: 80, input: { steer: 1 } },
  { frames: 70, input: { push: true } },
  { frames: 60, input: {} },
  { frames: 80, input: { steer: 1 } },
  { frames: 40, input: { push: true } },
  { frames: 40, input: {} },
];

// The game runs at most 5 simulation ticks per render frame (maxStepsPerFrame
// in src/sim/fixed-step.js). A slow frame loop gives fewer frames and more
// ticks per frame. These tests sample every frame and check ticks, not frame
// counts, so they pass at a high machine load (see docs/decisions.md).
const MAX_TICKS_PER_FRAME = 5;

// The largest number of ticks between two samples that follow each other.
function maxTickGap(samples) {
  let gap = 0;
  for (let i = 1; i < samples.length; i += 1) gap = Math.max(gap, samples[i].tick - samples[i - 1].tick);
  return gap;
}

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test("the follow camera keeps the skater on screen for a whole lap", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });
  expect(await page.evaluate(() => window.__atl.view)).toBe("follow");

  const result = await page.evaluate(async (script) => {
    window.__atl.recorder.start(1);
    const end = await window.__atl.runScript(script);
    const samples = window.__atl.recorder.stop();
    return { end, samples };
  }, LAP);

  const lapTicks = LAP.reduce((n, e) => n + e.frames, 0);
  expect(result.end.tick).toBe(lapTicks);
  // The samples cover the whole lap: one sample each frame, no hole.
  const { samples } = result;
  expect(samples.length).toBeGreaterThan(20);
  expect(maxTickGap(samples)).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME);
  expect(samples[samples.length - 1].tick - samples[0].tick).toBeGreaterThanOrEqual(lapTicks - 2 * MAX_TICKS_PER_FRAME);
  const offscreen = result.samples.filter((s) => Math.abs(s.x) > 1 || Math.abs(s.y) > 1 || s.z > 1);
  expect(offscreen, `off-screen samples: ${JSON.stringify(offscreen.slice(0, 5))}`).toEqual([]);

  // The camera is behind the skater: the skater sits in the lower middle of the frame.
  const avgY = result.samples.reduce((n, s) => n + s.y, 0) / result.samples.length;
  expect(avgY).toBeLessThan(0.5);
  expect(avgY).toBeGreaterThan(-0.9);

  await page.screenshot({ path: "e2e/__screenshots__/camera-lap-end.png" });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("the follow camera does not clip through a building wall", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });

  // Stand on the north sidewalk facing south (yaw -pi/2), so the ideal
  // camera is inside the north building. The ray must pull it in front.
  const result = await page.evaluate(async () => {
    window.__atl.recorder.start(5);
    const end = await window.__atl.runScript([{ frames: 90, input: {} }], { position: [0, 0.15, -8.5], yaw: -Math.PI / 2 });
    const samples = window.__atl.recorder.stop();
    return { end, samples, camera: window.__atl.cameraPosition, state: window.__atl.cameraState };
  });

  // The building occupies z from -18 to -10. The camera must stay south of its face.
  expect(result.camera[2]).toBeGreaterThan(-10);
  expect(result.state.position[2]).toBeLessThan(-10);
  const last = result.samples[result.samples.length - 1];
  expect(last.wallHit).not.toBeNull();
  expect(Math.abs(last.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(last.y)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "e2e/__screenshots__/camera-wall-clip.png" });
});

test("the follow camera rides the quarter pipe without snapping or flipping", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });

  // Push east into the 3 m quarter pipe, launch off the lip, roll back down.
  const samples = await page.evaluate(async () => {
    window.__atl.recorder.start(1);
    await window.__atl.runScript([{ frames: 150, input: { push: true } }, { frames: 300, input: {} }], { position: [8, 0, 0], yaw: 0 });
    return window.__atl.recorder.stop();
  });

  expect(maxTickGap(samples)).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME);
  const onRamp = samples.filter((s) => s.skater[0] > 25);
  // The skater is on the ramp for about 95 ticks. Check ticks, not samples:
  // the count of on-ramp samples falls when the frames are slow.
  expect(onRamp.length).toBeGreaterThan(0);
  expect(onRamp[onRamp.length - 1].tick - onRamp[0].tick).toBeGreaterThanOrEqual(80);
  const offscreen = samples.filter((s) => Math.abs(s.x) > 1 || Math.abs(s.y) > 1 || s.z > 1);
  expect(offscreen, `off-screen samples: ${JSON.stringify(offscreen.slice(0, 3))}`).toEqual([]);

  let maxJump = 0;
  let minDistance = Infinity;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1].camera;
    const b = samples[i].camera;
    // Per tick, not per frame: a slow frame carries up to 5 ticks of motion.
    const ticks = Math.max(1, samples[i].tick - samples[i - 1].tick);
    maxJump = Math.max(maxJump, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / ticks);
    const s = samples[i].skater;
    minDistance = Math.min(minDistance, Math.hypot(b[0] - s[0], b[1] - s[1], b[2] - s[2]));
  }
  // Before the fix the camera jumped 12 m in one frame (1 tick) and came
  // within 1.2 m.
  expect(maxJump).toBeLessThan(1);
  expect(minDistance).toBeGreaterThan(4);
  // While the skater is on the ramp the camera stays on the street side.
  for (const s of onRamp) expect(s.camera[0]).toBeLessThan(s.skater[0]);
  await page.screenshot({ path: "e2e/__screenshots__/camera-quarter-pipe.png" });
});

test("a mouse drag turns the follow camera, and it goes back behind the skater", async ({ page }) => {
  // The waits for the skater model (60 s) and a still camera (6 s) are longer than the default 30 s.
  test.setTimeout(90000);
  const errors = collectErrors(page);
  await page.goto("/");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });
  // The skater GLB downloads in parallel with the level (#74), so the page
  // can be ready before the model and the camera settle. Wait for the model,
  // then for a camera that holds still for 300 ms.
  await page.waitForFunction(() => window.__atl.skaterModel.loaded || window.__atl.skaterModel.error, null, { timeout: 60000 });
  let before = await page.evaluate(() => window.__atl.cameraPosition);
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(300);
    const now = await page.evaluate(() => window.__atl.cameraPosition);
    const moved = Math.hypot(now[0] - before[0], now[1] - before[1], now[2] - before[2]);
    before = now;
    if (moved < 0.01) break;
  }
  const box = await page.locator("canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(cx + i * 26, cy + i * 4);
  await page.mouse.up();
  await page.waitForFunction(() => Math.abs(window.__atl.cameraLook.yaw) > 1, null, { timeout: 5000 });
  await page.waitForTimeout(300);
  const look = await page.evaluate(() => window.__atl.cameraLook);
  const turned = await page.evaluate(() => window.__atl.cameraPosition);
  await page.screenshot({ path: "e2e/__screenshots__/camera-look-drag.png" });
  // A drag right of 260 px looks right: the yaw offset is negative.
  expect(look.yaw).toBeLessThan(-1);
  expect(look.pitch).toBeGreaterThan(0);
  expect(Math.hypot(turned[0] - before[0], turned[2] - before[2])).toBeGreaterThan(3);
  // The skater stays on screen while the camera is turned.
  await page.evaluate(() => window.__atl.recorder.start(1));
  await page.waitForTimeout(200);
  const samples = await page.evaluate(() => window.__atl.recorder.stop());
  expect(samples.length).toBeGreaterThan(0);
  for (const p of samples) expect(Math.max(Math.abs(p.x), Math.abs(p.y))).toBeLessThan(0.9);
  await page.waitForFunction(() => window.__atl.cameraLook.yaw === 0 && window.__atl.cameraLook.pitch === 0, null, { timeout: 6000 });
  const back = await page.evaluate(() => window.__atl.cameraPosition);
  expect(Math.hypot(back[0] - before[0], back[1] - before[1], back[2] - before[2])).toBeLessThan(0.2);
  expect(errors).toEqual([]);
});
