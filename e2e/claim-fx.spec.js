import { readFileSync } from "node:fs";
import { expect, test, devices } from "@playwright/test";
import { rideIntoGap, startAt } from "./landmark-rides.js";
import { CLAIM_FX } from "../src/landmarks/claim-fx.js";

// The landmark claim effects (#221, design/gdd/landmark-discovery.md
// "Extra effects", R-1; docs/art-direction-pbr.md section 11): the burst at
// the feet, the dogwood petals and the golden-hour rim, on the high and the
// phone tier, and off with reduced motion. Screenshots go to
// e2e/__screenshots__/claim-fx-*.jpg.
//
// A claim effect lives 0.4 s (the burst) and 1 s (the petals), so the
// screenshots spawn it with __atl.landmarkFx.claimEffect(age) and hold the
// effects layer. One test claims the Freedom Parkway bridge with a real ride
// and checks that the claim spawns the effect.

const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars
const PHONE = { ...pixel, viewport: { width: 390, height: 844 } };
const SHOTS = "e2e/__screenshots__";
const JPEG = 80;
const BUDGET = JSON.parse(readFileSync(new URL("../docs/perf/budget.json", import.meta.url), "utf8")).tiers;
const GAP = rideIntoGap("freedom-parkway-bridge", startAt(336, 45, Math.PI / 2));
// June 21 at 20:15: the sun is about 6 degrees up (golden hour); 14:00 is midday.
const GOLDEN = "date=06-21&time=20.25&weather=clear";
const MIDDAY = "date=06-21&time=14&weather=clear";
// The card-art camera of Ponce City Market (src/landmarks/card-art.js).
const PCM_CAM = "view=fixed&cam=-5.9,35,-993.8,-213.7,22,-873.8";

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function open(page, query) {
  await page.goto(`/?level=beltline-eastside&mute=1&governor=0&cars=0&npcs=0&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5 && window.__atl.landmarks && window.__atl.landmarkFx, null, { timeout: 240000 });
  await page.evaluate(() => window.__atl.landmarks.reset());
}

async function frames(page, n = 3) {
  const f = await page.evaluate(() => window.__atl.frames);
  await page.waitForFunction((g) => window.__atl.frames > g, f + n, { timeout: 60000 });
}

// Spawn the claim effect at the skater's feet, aged `age` s, and hold it.
async function heldClaim(page, age) {
  await page.evaluate(
    (age) => {
      window.__atl.effects.clear();
      window.__atl.effects.hold(true);
      return window.__atl.landmarkFx.claimEffect(age);
    },
    age,
  );
  await frames(page);
  return page.evaluate(() => ({ claim: window.__atl.landmarkFx.claimFx, fx: window.__atl.effects.info }));
}

for (const [tier, look] of [
  ["high", "pbr"],
  ["phone", "pbr"],
]) {
  test.describe(`on the ${tier} tier`, () => {
    if (tier === "phone") test.use(PHONE);

    test(`a claim gives the burst ${tier === "high" ? "(star and ring)" : "(ring only)"} and ${tier === "high" ? 16 : 8} petals, and the draw calls stay in the budget`, async ({ page }) => {
      test.setTimeout(300000);
      const errors = collectErrors(page);
      await open(page, `quality=${tier}&look=${look}&${MIDDAY}`);
      const held = await heldClaim(page, 0.12);
      const want = tier === "high" ? ["ring", "star"] : ["ring"];
      const petals = tier === "high" ? 16 : 8;
      expect(held.claim.policy.claim).toMatchObject({ ring: true, star: tier === "high", core: tier === "high" });
      expect(held.claim.policy.petals).toBe(petals);
      expect(held.claim.last.filter((s) => s !== "petal")).toEqual(want);
      expect(held.claim.last.filter((s) => s === "petal")).toHaveLength(petals);
      expect(held.fx.bursts).toBe(want.length + petals);
      expect(held.fx.visible.bursts).toBe(true);
      // The burst and the petals share the 1 burst mesh of the effects layer.
      expect(held.fx.draws).toBeLessThanOrEqual(1);
      // The frame with the effect stays in the draw-call cap of the tier
      // (docs/perf/budget.json). Other draws change from frame to frame as
      // the tiles load, so the effect is counted by its own mesh above.
      const calls = await page.evaluate(() => window.__atl.rendererInfo.calls);
      expect(calls).toBeLessThanOrEqual(BUDGET[`${tier}/${look}`]?.calls ?? BUDGET[tier].calls);
      await page.screenshot({ path: `${SHOTS}/claim-fx-burst-${tier}.jpg`, type: "jpeg", quality: JPEG });
      // Later in the effect: the burst is gone, the petals still fall.
      await page.evaluate(() => window.__atl.effects.clear());
      await heldClaim(page, 0.6);
      const late = await page.evaluate(() => window.__atl.effects.info);
      expect(late.bursts).toBe(petals);
      await page.screenshot({ path: `${SHOTS}/claim-fx-petals-${tier}.jpg`, type: "jpeg", quality: JPEG });
      // After 1 s nothing is left, and the layer draws nothing.
      await page.evaluate(() => {
        window.__atl.effects.hold(false);
      });
      await page.waitForFunction(() => window.__atl.effects.info.bursts === 0, null, { timeout: 30000 });
      await frames(page);
      expect(await page.evaluate(() => window.__atl.effects.info.draws)).toBe(0);
      expect(errors).toEqual([]);
    });

    test(`the golden-hour rim on a Found building is ${tier === "high" ? "on" : "off"}`, async ({ page }) => {
      test.setTimeout(300000);
      const errors = collectErrors(page);
      await open(page, `quality=${tier}&look=${look}&${GOLDEN}&${PCM_CAM}`);
      await page.waitForFunction(() => window.__atl.level.landmarks?.loaded, null, { timeout: 240000 });
      const elevation = await page.evaluate(() => window.__atl.weather.elevation);
      expect(elevation).toBeGreaterThan(CLAIM_FX.rim.golden.full);
      expect(elevation).toBeLessThan(CLAIM_FX.rim.golden.fade);
      await page.evaluate(() => window.__atl.landmarks.find("ponce-city-market"));
      await frames(page);
      const rim = await page.evaluate(() => window.__atl.landmarkFx.rim);
      if (tier !== "high") {
        expect(rim).toBeNull();
        await page.screenshot({ path: `${SHOTS}/claim-fx-rim-${tier}.jpg`, type: "jpeg", quality: JPEG });
        expect(errors).toEqual([]);
        return;
      }
      expect(rim).toMatchObject({ visible: true, alpha: CLAIM_FX.rim.alpha, buildings: ["ponce-city-market"], draws: 1 });
      await page.screenshot({ path: `${SHOTS}/claim-fx-rim-${tier}.jpg`, type: "jpeg", quality: JPEG });
      // The same building with no rim, to compare.
      await page.evaluate(() => window.__atl.landmarks.reset());
      await frames(page);
      expect(await page.evaluate(() => window.__atl.landmarkFx.rim.visible)).toBe(false);
      await page.screenshot({ path: `${SHOTS}/claim-fx-rim-${tier}-off.jpg`, type: "jpeg", quality: JPEG });
      // Claimed: the rim goes.
      await page.evaluate(() => window.__atl.landmarks.claim("ponce-city-market"));
      await frames(page);
      expect(await page.evaluate(() => window.__atl.landmarkFx.rim)).toMatchObject({ visible: false, buildings: [] });
      expect(errors).toEqual([]);
    });
  });
}

test("the rim is off at midday", async ({ page }) => {
  test.setTimeout(240000);
  await open(page, `quality=high&look=pbr&${MIDDAY}&${PCM_CAM}`);
  await page.evaluate(() => window.__atl.landmarks.find("ponce-city-market"));
  await frames(page);
  expect(await page.evaluate(() => window.__atl.landmarkFx.rim)).toMatchObject({ visible: false, alpha: 0, buildings: ["ponce-city-market"] });
});

test("with reduced motion a claim gives no burst and no petals (R-1)", async ({ page }) => {
  test.setTimeout(240000);
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, `quality=high&look=pbr&${MIDDAY}`);
  const held = await heldClaim(page, 0.12);
  expect(held.claim.policy).toEqual({ claim: null, petals: null });
  expect(held.claim.last).toEqual([]);
  expect(held.fx.bursts).toBe(0);
  expect(held.fx.visible.bursts).toBe(false);
  await page.screenshot({ path: `${SHOTS}/claim-fx-reduced-motion.jpg`, type: "jpeg", quality: JPEG });
  expect(errors).toEqual([]);
});

test("a real claim (a hop under the Freedom Parkway bridge) spawns the burst and the petals once", async ({ page }) => {
  test.setTimeout(420000);
  const errors = collectErrors(page);
  await open(page, `quality=high&look=pbr&${MIDDAY}`);
  const before = await page.evaluate(() => window.__atl.landmarkFx.claimFx.claims);
  await page.evaluate(
    ({ script, start }) => {
      window.__ride = window.__atl.runScript(script, start);
    },
    { script: GAP.script, start: GAP.start },
  );
  await page.waitForFunction(() => window.__atl.landmarks.states()["freedom-parkway-bridge"] === "claimed", null, { timeout: 300000 });
  const after = await page.evaluate(() => window.__atl.landmarkFx.claimFx);
  expect(after.claims).toBe(before + 1);
  expect(after.last.filter((s) => s !== "petal")).toEqual(["ring", "star"]);
  expect(after.last.filter((s) => s === "petal")).toHaveLength(16);
  expect(errors).toEqual([]);
});
