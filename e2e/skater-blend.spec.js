import { expect, test } from "@playwright/test";

// #107: clip blends, carve lean, and foot IK. The animation lab
// (anim-lab.html) puts the skater on the greybox level and draws three
// contact sheets per skater into e2e/__screenshots__/.

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

const SKATERS = ["nia", "marcus"];
const sum = (w) => Object.entries(w).filter(([k]) => !k.startsWith("lean:")).reduce((a, [, v]) => a + v, 0);

for (const name of SKATERS) {
  test(`${name}: blend, lean, and foot contact sheets`, async ({ page }) => {
    test.setTimeout(180000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto(`/anim-lab.html?skater=${name}`);
    await page.waitForFunction(() => window.__lab && (window.__lab.ready || window.__lab.error), null, { timeout: 60000 });
    expect(await page.evaluate(() => window.__lab.error)).toBeNull();

    // Blends: every frame of a fade has weights that sum to 1, and a fade
    // that a second change cuts keeps the weights (no reset to 0).
    const blend = await page.evaluate(() => window.__lab.sheet("blend"));
    await page.screenshot({ path: `e2e/__screenshots__/anim-107-${name}-blend.png` });
    for (const row of blend) for (const tile of row) expect(sum(tile.weights), tile.label).toBeCloseTo(1, 2);
    const mid = blend[0][2].weights;
    expect(mid.coast).toBeGreaterThan(0.1);
    expect(mid.push).toBeGreaterThan(0.1);
    const cut = blend[2];
    expect(cut[0].weights.push).toBeGreaterThan(0.3);
    expect(cut[1].weights.push).toBeGreaterThan(0.3);
    expect(cut[4].weights).toEqual({ coast: 1 });

    // Lean: into the turn, 0 with no turn, the same size both ways.
    const lean = await page.evaluate(() => window.__lab.sheet("lean"));
    await page.screenshot({ path: `e2e/__screenshots__/anim-107-${name}-lean.png` });
    const leans = lean[0].map((t) => t.lean);
    expect(leans[0]).toBeLessThan(-0.15);
    expect(leans[1]).toBeLessThan(-0.05);
    expect(Math.abs(leans[2])).toBeLessThan(1e-3);
    expect(leans[3]).toBeCloseTo(-leans[1], 3);
    expect(leans[4]).toBeCloseTo(-leans[0], 3);
    expect(lean[0][1].weights["lean:carve_right"]).toBeGreaterThan(0.2);
    expect(lean[0][3].weights["lean:carve_left"]).toBeGreaterThan(0.2);

    // Foot contact: IK off and on, on the ramp and on the stairs.
    const contact = await page.evaluate(() => window.__lab.sheet("contact"));
    await page.screenshot({ path: `e2e/__screenshots__/anim-107-${name}-contact.png` });
    const [rampOff, , rampOn] = contact[0];
    const [stairsOff, , stairsOn] = contact[1];
    expect(stairsOff.gap.left).toBeGreaterThan(0.15);
    expect(Math.abs(stairsOn.gap.left)).toBeLessThan(0.01);
    expect(Math.abs(stairsOn.gap.right)).toBeLessThan(0.01);
    for (const side of ["left", "right"]) {
      expect(Math.abs(rampOn.gap[side])).toBeLessThan(0.05);
      expect(Math.abs(rampOn.gap[side])).toBeLessThan(Math.abs(rampOff.gap[side]));
    }

    // No pop: the largest bone turn in a frame near a clip change is not
    // larger than the push clip turns by itself.
    const pop = await page.evaluate(() => window.__lab.popCheck());
    expect(pop.changes.length).toBeGreaterThanOrEqual(6);
    expect(pop.change).toBeLessThanOrEqual(Math.max(...Object.values(pop.steady)) * 1.05);

    // The IK cost per frame.
    const ms = await page.evaluate(() => window.__lab.ikCost());
    expect(ms).toBeLessThan(1);
    test.info().annotations.push({ type: "result", description: JSON.stringify({ name, pop, ikMs: ms, ramp: [rampOff.gap, rampOn.gap], stairs: [stairsOff.gap, stairsOn.gap] }) });
    console.log(`#107 ${name}`, JSON.stringify({ pop: { steady: pop.steady, change: pop.change }, ikMs: ms, ramp: [rampOff.gap, rampOn.gap], stairs: [stairsOff.gap, stairsOn.gap] }));
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
}

test("the game turns foot IK on, and off on the phone tier", async ({ page }) => {
  test.setTimeout(120000);
  const errors = collectErrors(page);
  await page.goto("/?mute=1&skater=nia");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.skaterModel.loaded, null, { timeout: 60000 });
  // The IK weight fades in over FOOT_IK.fadeIn frames of game time.
  await page.waitForFunction(() => window.__atl.skaterModel.footIk.weight === 1, null, { timeout: 20000 });
  const ik = await page.evaluate(() => window.__atl.skaterModel.footIk);
  expect(ik.on).toBe(true);
  expect(ik.ms).toBeLessThan(2);
  expect(Math.abs(await page.evaluate(() => window.__atl.skaterModel.lean))).toBeLessThan(0.01);
  await page.goto("/?mute=1&skater=nia&quality=phone");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.skaterModel.loaded, null, { timeout: 60000 });
  expect((await page.evaluate(() => window.__atl.skaterModel.footIk)).on).toBe(false);
  await page.goto("/?mute=1&skater=nia&quality=phone&footik=1");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.skaterModel.loaded, null, { timeout: 60000 });
  expect((await page.evaluate(() => window.__atl.skaterModel.footIk)).on).toBe(true);
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
