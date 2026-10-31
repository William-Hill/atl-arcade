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
    window.__atl.recorder.start(10);
    const end = await window.__atl.runScript(script);
    const samples = window.__atl.recorder.stop();
    return { end, samples };
  }, LAP);

  expect(result.end.tick).toBe(LAP.reduce((n, e) => n + e.frames, 0));
  expect(result.samples.length).toBeGreaterThan(20);
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
