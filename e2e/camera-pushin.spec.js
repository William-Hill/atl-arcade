import { expect, test } from "@playwright/test";

// Playtest 2026-11-09: the follow camera came in to 0.77 m from the skater,
// so her back filled the screen. A wall or the edge fence was between her
// and the camera, close to her. The camera now swings around her to a clear
// side (src/sim/camera.js, swing). These rides record the camera distance
// from the camera pivot (1 m over her feet) on each frame.
const LANE_Z = 176; // m: open ground along the east fence.
const URL = "/?level=beltline-eastside&mute=1&quality=low&look=toon&time=14&weather=clear&governor=0&run=free&peds=0&skaters=0&traffic=0";
const MIN = 3; // m: the closest the camera may come in these rides.

async function ride(page, { dx, yaw, frames, input }) {
  return page.evaluate(
    async ({ dx, yaw, frames, input, z }) => {
      const { fence } = window.__atl.level;
      const x = fence.maxX - dx;
      const y = window.__atl.level.sample(x, z)?.height ?? 0;
      window.__atl.recorder.start(1);
      await window.__atl.runScript([{ frames, input }], { position: [x, y, z], yaw });
      const samples = window.__atl.recorder.stop();
      // Skip the first frames: the camera starts at its goal, past the fence.
      const d = samples.slice(5).map((s) => Math.hypot(s.camera[0] - s.skater[0], s.camera[1] - (s.skater[1] + 1), s.camera[2] - s.skater[2]));
      return { n: d.length, min: Math.min(...d), fenceX: fence.maxX, maxCamX: Math.max(...samples.map((s) => s.camera[0])) };
    },
    { dx, yaw, frames, input, z: LANE_Z },
  );
}

test("the follow camera does not push into the skater at the edge fence", async ({ page }) => {
  test.setTimeout(400000);
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto(URL);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 150000 });

  // 0.4 m from the fence, she rides north and away from it at 0.6 rad. The
  // camera goal behind her is outside the fence.
  const away = await ride(page, { dx: 0.4, yaw: Math.PI / 2 + 0.6, frames: 90, input: { push: true } });
  // A wall slide along the fence (the playtest sparks case).
  const slide = await ride(page, { dx: 1, yaw: Math.PI / 2 - 0.15, frames: 120, input: { push: true, steer: -0.3 } });
  console.log(JSON.stringify({ away, slide }));

  for (const r of [away, slide]) {
    expect(r.n).toBeGreaterThan(10);
    expect(r.min).toBeGreaterThan(MIN);
    expect(r.maxCamX).toBeLessThan(r.fenceX);
  }
  await page.screenshot({ path: "e2e/__screenshots__/camera-pushin-after.png" });
  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});
