import { expect, test } from "@playwright/test";

// Issue #229: the construction fence at the level edge. Nia rides east at
// full push toward the east bound of the BeltLine Eastside level. She stops
// at the fence, does not respawn, and the HUD shows the edge hint. The
// screenshots show the fence in both looks, at 14:00 in clear weather. The
// walkers, the NPC skaters, and the moving cars are off, so none of them
// stands in the lane.
const LANE_Z = 176; // m: open ground from here to the east fence, a little downhill.
const SCRIPT = [{ frames: 420, input: { push: true } }];

for (const look of ["toon", "pbr"]) {
  test(`the skater stops at the east edge fence (${look})`, async ({ page }) => {
    test.setTimeout(300000);
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.goto(`/?level=beltline-eastside&mute=1&quality=low&look=${look}&time=14&weather=clear&governor=0&run=free&peds=0&skaters=0&traffic=0`);
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 150000 });

    const result = await page.evaluate(async ({ script, z }) => {
      const { bounds, fence } = window.__atl.level;
      const x = bounds.maxX - 45;
      const y = window.__atl.level.sample(x, z)?.height ?? 0;
      window.__atl.recorder.start(1);
      const end = await window.__atl.runScript(script, { position: [x, y, z], yaw: 0 });
      const samples = window.__atl.recorder.stop();
      const xs = samples.map((s) => s.skater[0]);
      return { end, fence, startX: x, minX: Math.min(...xs), maxX: Math.max(...xs), hint: !document.getElementById("hud-edge").hidden };
    }, { script: SCRIPT, z: LANE_Z });

    expect(result.fence).not.toBeNull();
    expect(result.fence.panels).toBeGreaterThan(1000);
    // No respawn: the skater never left the lane for the spawn (x = 337 m).
    expect(result.end.stats.respawns).toBe(0);
    expect(result.minX).toBeGreaterThan(result.startX - 1);
    // She reached the fence and stays at it, pressed against it by the push.
    expect(result.maxX).toBeLessThan(result.fence.maxX);
    expect(result.maxX).toBeGreaterThan(result.fence.maxX - 1);
    expect(result.end.position[0]).toBeGreaterThan(result.fence.maxX - 1);
    expect(result.end.speed).toBe(0);
    expect(result.hint).toBe(true);

    // Let the follow camera settle behind her, then take the evidence.
    const frames = await page.evaluate(() => window.__atl.frames);
    await page.waitForFunction((f) => window.__atl.frames > f + 30, frames, { timeout: 120000 });
    await page.screenshot({ path: `e2e/__screenshots__/edge-fence-east-${look}.png` });
    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });
}
