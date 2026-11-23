import { expect, test } from "@playwright/test";

// Issue #191: the baked leaf cut on the phone and low tiers. For each tier
// (phone, high) and tree view, the test draws the pbr look with the
// procedural cut (`leafcut=procedural`, the old look) and with the tier
// default. On phone the default is the baked cut, on high it stays
// procedural. The canopy must keep its silhouette and its color: in the top
// half of the frame (the crowns against the sky) the part of leaf pixels and
// the mean leaf color stay near the old values. The screenshots are the
// before and after evidence, at 14:00 in clear weather.
const CAMS = {
  spawn: "312,2,-175,334,3,-80",
  park: "-175,15,-385,-160,11,-260",
};
const BASE = "/?level=beltline-eastside&mute=1&look=pbr&time=14&weather=clear&governor=0&skater=capsule&view=fixed&npcs=0&peds=0&cars=0&wind=0&npcseed=1";

// The top half of the frame: the part of leaf pixels (green over blue) and
// their mean color. Read after a frame, as the frame-time probe does.
async function canopy(page) {
  return page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(done));
    const gl = document.querySelector("canvas").getContext("webgl2");
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let leaf = 0;
    const sum = [0, 0, 0];
    // readPixels starts at the bottom row: the top half is the second half.
    for (let i = (w * h * 4) / 2; i < px.length; i += 4) {
      if (px[i + 1] > px[i + 2] + 8) {
        leaf += 1;
        for (let c = 0; c < 3; c += 1) sum[c] += px[i + c];
      }
    }
    return { leafPart: leaf / ((w * h) / 2), mean: sum.map((v) => v / Math.max(leaf, 1)) };
  });
}

for (const quality of ["phone", "high"]) {
  for (const [cam, value] of Object.entries(CAMS)) {
    test(`the leaf cards keep the canopy with the ${quality} tier leaf cut (${cam})`, async ({ page }) => {
      test.setTimeout(900000);
      const errors = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      const shots = {};
      for (const [label, extra] of [
        ["before", "&leafcut=procedural"],
        ["after", ""],
      ]) {
        await page.goto(`${BASE}&quality=${quality}&cam=${value}${extra}`);
        await page.waitForFunction(() => window.__atl?.ready && window.__atl.level.props?.loaded && window.__atl.frames > 4, null, { timeout: 600000 });
        const frames = await page.evaluate(() => window.__atl.frames);
        await page.waitForFunction((f) => window.__atl.frames > f + 2, frames, { timeout: 300000 });
        shots[label] = { trees: await page.evaluate(() => window.__atl.trees), canopy: await canopy(page) };
        await page.screenshot({ path: `e2e/__screenshots__/leaf-cut-${quality}-${cam}-${label}.png` });
      }
      expect(shots.before.trees.leafCut).toBe("procedural");
      expect(shots.after.trees.leafCut).toBe(quality === "high" ? "procedural" : "baked");
      if (quality !== "high") {
        expect(shots.after.trees.leafBakeBytes).toBeGreaterThan(0);
        expect(shots.after.trees.leafBakeBytes).toBeLessThan(3 * 1024 * 1024);
      }
      // The silhouette: the part of leaf pixels in the top half changes by
      // less than 10 % of its value. The color: each channel of the mean leaf
      // color within 8/255.
      const [b, a] = [shots.before.canopy, shots.after.canopy];
      console.log(`${quality} ${cam}: bake ${shots.after.trees.leafBakeMs} ms, leaf part ${b.leafPart.toFixed(4)} -> ${a.leafPart.toFixed(4)}, mean ${b.mean.map(Math.round)} -> ${a.mean.map(Math.round)}`);
      expect(b.leafPart).toBeGreaterThan(0.02);
      expect(Math.abs(a.leafPart - b.leafPart)).toBeLessThan(0.1 * b.leafPart);
      for (let c = 0; c < 3; c += 1) expect(Math.abs(a.mean[c] - b.mean[c])).toBeLessThan(8);
      expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
    });
  }
}
