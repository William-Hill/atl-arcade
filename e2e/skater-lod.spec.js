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
