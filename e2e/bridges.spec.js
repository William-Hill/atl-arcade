import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

// #131: the bridge decks did not meet their roads. On the high tier (the
// road markings show) take a fixed-camera picture of each bridge end:
// 7 m over the ground, 10 m out on the approach road and beside it (on the
// trails: on the trail, clear of the trees), looking at the joint and the
// OSM end. The two footway bridges end at the wall of Ponce City Market, so
// their cameras are outside the building. The pictures go to reports/bridges/<set>/
// (BRIDGE_SHOTS=before|after, default after). The numbers (joint heights,
// terrain under the decks, skater rolls) are in src/level/geo/bridges.test.js.
//
// The views are fixed coordinates, so the same views work on an older build.
//
// The page pins the toon look and a clear afternoon. Since #182 the high tier
// draws the pbr look, and a pbr frame on the software GPU takes 4 to 10 s,
// so 17 views did not fit in the time limit. The look does not change the
// deck joints. Without ?time= the game uses the clock of the computer.

const SET = process.env.BRIDGE_SHOTS ?? "after";
const DIR = `reports/bridges/${SET}`;

// name, OSM end of the bridge, camera (x, z), look at (x, z).
const VIEWS = [
  { name: "parkway-west-eb", end: [297.24, 49.36], camera: [283.81, 70.52], look: [291.99, 52.27] },
  { name: "parkway-west-wb", end: [296.94, 64], camera: [283, 84.2], look: [291.82, 66.51] },
  { name: "parkway-mid-wb", end: [363.65, 4.23], camera: [366.46, -20.67], look: [367.1, -0.68] },
  { name: "parkway-mid-eb", end: [362.09, -15.01], camera: [363.12, -40.05], look: [365.18, -20.15] },
  { name: "parkway-east-eb", end: [412.5, -101.09], camera: [411.37, -126.12], look: [415.13, -106.48] },
  { name: "parkway-east-wb", end: [417.47, -83.2], camera: [417.12, -108.26], look: [420.27, -88.51] },
  { name: "highland-west", end: [-401.21, 380.65], camera: [-423.08, 391.9], look: [-407.21, 380.72] },
  { name: "highland-mid", end: [-283.03, 380.16], camera: [-271.09, 369.1], look: [-282.03, 380.15] },
  { name: "highland-east-west", end: [107.03, 377.57], camera: [85.36, 389.21], look: [101.03, 377.75] },
  { name: "highland-east-east", end: [190.45, 377.7], camera: [210.11, 362.91], look: [196.35, 376.62] },
  { name: "randolph-north", end: [-426.18, 456.29], camera: [-416.01, 478.21], look: [-426.13, 462.29] },
  { name: "randolph-south", end: [-425.53, 397.34], camera: [-434.31, 375.08], look: [-425.08, 391.36] },
  { name: "footway-pcm-east", end: [-214.12, -880.11], camera: [-250, -870], look: [-225, -881.5] },
  { name: "footway-pcm-spur", end: [-153.66, -876.4], camera: [-125, -866], look: [-153.66, -876.4] },
  { name: "trail-ponce", end: [-121.23, -941.58], camera: [-117.08, -922.02], look: [-121.98, -945.1] },
  { name: "trail-north-ave", end: [-50.36, -722.17], camera: [-57.76, -738.68], look: [-49.17, -719.39] },
  { name: "trail-ralph-mcgill", end: [215.45, -314.33], camera: [202.64, -329.69], look: [217.76, -311.57] },
];

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test("high tier: a picture of each bridge end", async ({ page }) => {
  // About 2 minutes on a quiet 14-CPU Mac with the toon look; the margin is
  // for a loaded machine.
  test.setTimeout(360000);
  mkdirSync(DIR, { recursive: true });
  const errors = collectErrors(page);
  await page.goto("/?level=beltline-eastside&mute=1&quality=high&look=toon&time=14&weather=clear&governor=0&view=fixed&minimap=0");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 90000 });
  expect(await page.evaluate(() => window.__atl.render.quality)).toBe("high");

  for (const v of VIEWS) {
    const placed = await page.evaluate((view) => {
      const ground = (x, z) => window.__atl.level.sample(x, z)?.height;
      const [cx, cz] = view.camera;
      const [lx, lz] = view.look;
      const cy = ground(cx, cz);
      const ly = ground(lx, lz);
      if (!Number.isFinite(cy) || !Number.isFinite(ly)) return null;
      window.__atl.setFixedCamera(cx, cy + 7, cz, lx, ly + 0.5, lz);
      return { cy, ly, frames: window.__atl.frames };
    }, v);
    expect(placed, v.name).not.toBeNull();
    // Let a few frames draw at the new place.
    await page.waitForFunction((f) => window.__atl.frames > f + 3, placed.frames, { timeout: 30000 });
    await page.screenshot({ path: `${DIR}/${v.name}.jpg`, type: "jpeg", quality: 85 });
  }
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
