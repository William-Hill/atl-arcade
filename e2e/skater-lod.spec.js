import { expect, test } from "@playwright/test";

// #280: the LOD1 skater model for far NPC skaters. The LOD1 mesh binds to
// the skeleton of the full model, so the same clips move it. The test page
// (skater-lod.html) shows LOD0 on the right and LOD1 on the left.

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

// Three poses for the side-by-side screenshots: [clip, time (0..1)].
const POSES = [
  ["idle", 0],
  ["air_japan", 0.5],
  ["grind_soul", 0.5],
];

for (const name of ["nia", "marcus"]) {
  test(`the ${name} LOD1 model keeps the 65 joints and plays every clip with no broken vertices`, async ({ page }) => {
    test.setTimeout(180000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 960, height: 720 });
    await page.goto(`/skater-lod.html?skater=${name}`);
    await page.waitForFunction(() => window.__lod && (window.__lod.ready || window.__lod.error), null, { timeout: 60000 });
    const info = await page.evaluate(() => ({ error: window.__lod.error, ...window.__lod.info }));
    expect(info.error).toBeNull();
    expect(info.lod0.bones).toBe(65);
    expect(info.lod1.bones).toBe(65);
    expect(info.lod1.sharesSkeleton).toBe(true);
    expect(info.lod1.triangles).toBeLessThanOrEqual(3200);
    expect(info.lod1.vertices * 6).toBeLessThan(info.lod0.vertices);
    // The ink hull of LOD1 comes from the LOD1 mesh.
    expect(info.lod1.hull).toBe(true);
    expect(info.lod1.hullGeometry).toBe(true);
    expect(info.clips).toHaveLength(24);

    // Every clip at 5 times: each skinned LOD1 vertex is finite and lies on
    // a skinned LOD0 vertex (within 5 mm: the Draco quantization). A vertex
    // with a wrong skin would move away from its LOD0 copy.
    const report = await page.evaluate(() => window.__lod.check());
    expect(report).toHaveLength(24);
    for (const r of report) {
      expect(r.nonFinite, `${r.clip} non-finite vertices`).toBe(0);
      expect(r.gap, `${r.clip} largest gap to LOD0 (m)`).toBeLessThan(0.005);
    }
    console.log(`${name} largest gap (mm): ${(Math.max(...report.map((r) => r.gap)) * 1000).toFixed(2)}`);

    for (const [clip, t] of POSES) {
      await page.evaluate(([c, tt]) => window.__lod.pose(c, tt), [clip, t]);
      await page.screenshot({ path: `e2e/__screenshots__/skater-lod-${name}-${clip}.png` });
    }
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
}

test("in the game, a near NPC skater uses the full model and a far one uses LOD1", async ({ page }) => {
  test.setTimeout(240000);
  const errors = collectErrors(page);
  await page.goto("/?level=beltline-eastside&mute=1&view=fixed&quality=phone");
  await page.waitForFunction(() => window.__atl?.ready && window.__atl.skaters && window.__atl.skaters.loaded + window.__atl.skaters.failed === window.__atl.skaters.count && window.__atl.frames > 5, null, { timeout: 120000 });
  // The camera 6 m from one NPC skater: that NPC is near, and the others are farther.
  const result = await page.evaluate(async () => {
    const n = window.__atl.skaters.list[0];
    const [x, y, z] = n.position;
    window.__atl.setFixedCamera(x + 5, y + 2.4, z + 3, x, y + 0.9, z);
    for (let i = 0; i < 4; i += 1) await new Promise((r) => requestAnimationFrame(r));
    const eye = [x + 5, y + 2.4, z + 3];
    return {
      draw: window.__atl.skaters.draw,
      skinnedVertices: window.__atl.skaters.skinnedVertices,
      list: window.__atl.skaters.list.map((m) => ({ id: m.id, visible: m.visible, lod: m.lod, d: Math.hypot(m.position[0] - eye[0], m.position[1] - eye[1], m.position[2] - eye[2]) })),
    };
  });
  const near = result.list.find((m) => m.d < 20);
  expect(near?.visible).toBe(true);
  expect(near?.lod).toBe(0);
  for (const m of result.list.filter((q) => q.visible && q.d > result.draw.lod1From + 1)) expect(m.lod, `${m.id} at ${m.d.toFixed(1)} m`).toBe(1);
  expect(result.list.filter((m) => m.visible && m.lod === 0).length).toBeLessThanOrEqual(result.draw.full);
  expect(result.skinnedVertices).toBeGreaterThan(0);
  await page.screenshot({ path: "e2e/__screenshots__/skater-lod-beltline-phone.png" });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
