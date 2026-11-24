import { expect, test, devices } from "@playwright/test";
import { planRide } from "./landmark-rides.js";
import { GUIDE, NEARBY_DONE, REACH, TOO_FAR } from "../src/landmarks/guide.js";
import { OVERTIME_TEXT, ROUND_END, STOPPING_TEXT } from "../src/sim/skate/round-end.js";
import { TOUR_BUTTON } from "../src/ui/results-text.js";
import { GRIND } from "../src/sim/skate/constants.js";

// #260: the landmark loop with no timer (?run=tour), the reach warning, the
// "next spot" pointer, and the soft end of a timed round.

const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars
const SHOTS = "e2e/__screenshots__";
const JPEG = 85;
const BAL = GRIND.balanceDrift / GRIND.balanceCorrect;

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon/.test(msg.location()?.url ?? "")) errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

// The query of e2e/landmarks.spec.js: no cars, no walkers (the rides are
// planned with the level alone).
async function open(page, query = "") {
  await page.goto(`/?level=beltline-eastside&mute=1&governor=0&weather=clear&time=14&cars=0&npcs=0&peds=0&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 240000 });
}

const guide = (page) => page.evaluate(() => window.__atl.landmarkFx.guide);
const box = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
  }, sel);
const inside = (b) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= b.vw + 0.5 && b.y + b.h <= b.vh + 0.5;

// The 2 spots near the spawn are Claimed (round 2 of the audit, B2), and
// the skater stands at the spawn.
async function nearSpotsDone(page) {
  await page.evaluate(() => {
    window.__atl.landmarks.reset();
    window.__atl.landmarks.claim("freedom-parkway-bridge");
    window.__atl.landmarks.claim("historic-fourth-ward-skatepark");
    window.__atl.resetSkater();
  });
  await page.waitForFunction(() => window.__atl.landmarkFx.guide?.kind === "next", null, { timeout: 30000 });
}

// The order of the tour: the spots near the spawn first, then north on the
// Beltline. Each ride is a plan of e2e/landmark-rides.js with the real
// controller.
const TOUR = ["freedom-parkway-bridge", "historic-fourth-ward-skatepark", "ralph-mcgill-bridge", "telephone-factory-lofts"];
const SPAWN = [337.07, 24.26, -1.3];

test.describe("a tour (?run=tour)", () => {
  test("has no timer, no goal list and no results; it shows the rings, claims 4 spots, and the 4 claims fit in 5 minutes", async ({ page }) => {
    test.setTimeout(1500000);
    const errors = collectErrors(page);
    const plans = TOUR.map((id) => planRide(id));
    for (const p of plans) expect(p.claimed, p.id).toBe(true);
    await open(page, "run=tour");
    const start = await page.evaluate(() => ({ mode: window.__atl.landmarkFx.mode, timed: window.__atl.landmarkFx.timed, goals: window.__atl.goals, timer: document.getElementById("hud-timer").textContent, timerHidden: document.getElementById("hud-timer").hidden, chips: document.querySelectorAll("#hud-goals .hud-goal-chip").length, results: document.getElementById("results") }));
    expect(start).toEqual({ mode: "tour", timed: true, goals: null, timer: "TOUR", timerHidden: false, chips: 0, results: null });
    await page.evaluate(() => window.__atl.landmarks.reset());

    // The rides, one after the other, in one tour. Each ride starts where its
    // plan starts; the time between 2 rides is the reach estimate of the
    // guide line (src/landmarks/guide.js) for the straight distance.
    const rows = [];
    let from = SPAWN;
    let claims = 0;
    for (const plan of plans) {
      const travel = Math.hypot(plan.start.position[0] - from[0], plan.start.position[2] - from[2]);
      await page.evaluate(({ id, start }) => {
        window.__atl.resetSkater(start.position, start.yaw);
        window.__atl.landmarks.find(id);
      }, plan);
      // The ring of the Found spot shows in a tour.
      await page.waitForFunction((id) => window.__atl.landmarkFx.rings.ids.some((k) => k.startsWith(id)), plan.id, { timeout: 60000 });
      if (plan.id === "ralph-mcgill-bridge") await page.screenshot({ path: `${SHOTS}/tour-desktop-ring.jpg`, type: "jpeg", quality: JPEG });
      const t0 = await page.evaluate(() => window.__atl.ticks);
      await page.evaluate(({ script, start }) => {
        window.__ride = { done: false };
        window.__atl.runScript(script, start).then((end) => (window.__ride = { done: true, end: [...end.position] }));
      }, plan);
      await page.waitForFunction((id) => window.__atl.landmarks.states()[id] === "claimed", plan.id, { timeout: 600000 });
      if (plan.id === "historic-fourth-ward-skatepark") {
        await page.waitForFunction(() => window.__atl.landmarkFx.banner.type === "claimed" && window.__atl.landmarkFx.banner.opacity > 0.95, null, { timeout: 60000 });
        await page.screenshot({ path: `${SHOTS}/tour-desktop-claimed.jpg`, type: "jpeg", quality: JPEG });
      }
      await page.waitForFunction(() => window.__ride.done, null, { timeout: 600000 });
      const end = await page.evaluate(() => ({ ticks: window.__atl.ticks, run: window.__atl.landmarks.run(), results: document.getElementById("results") }));
      expect(end.results).toBeNull();
      const claimed = end.run.claimed.find((c) => c.id === plan.id);
      expect(claimed, plan.id).toBeTruthy();
      claims += 1;
      rows.push({ id: plan.id, travelM: Math.round(travel), travelS: (travel * REACH.detour) / REACH.speed, rideS: plan.ticks / 60, claimS: plan.claimTick / 60, points: claimed.points, pageTicks: end.ticks - t0 });
      from = plan.end;
    }
    const total = rows.reduce((sum, r) => sum + r.travelS + r.rideS, 0);
    console.log(`tour: ${claims} claims in ${total.toFixed(1)} s of tour time`);
    console.table(rows.map((r) => ({ ...r, travelS: r.travelS.toFixed(1), rideS: r.rideS.toFixed(1), claimS: r.claimS.toFixed(1) })));
    expect(claims).toBeGreaterThanOrEqual(4);
    expect(total).toBeLessThanOrEqual(300);
    // No run cap in a tour: each first claim pays its full tier points.
    expect(rows.map((r) => r.points)).toEqual([200, 500, 300, 300]);
    // The page played each ride for its full plan (a frame can add a few ticks).
    for (const r of rows) expect(r.pageTicks).toBeGreaterThanOrEqual(Math.round(r.rideS * 60));
    expect(errors).toEqual([]);
  });

  test("points to the next spot when the spots near the spawn are done, with no reach warning", async ({ page }) => {
    test.setTimeout(300000);
    const errors = collectErrors(page);
    await open(page, "run=tour");
    await nearSpotsDone(page);
    // The banners of the 2 claims end first.
    await page.waitForFunction(() => window.__atl.landmarks.banner().current === null, null, { timeout: 60000 });
    const g = await guide(page);
    expect(g.kind).toBe("next");
    expect(g.warn).toBe(false);
    expect(g.text.split("\n")[0]).toBe(NEARBY_DONE);
    expect(g.text.split("\n")[1]).toMatch(/^Next: a new spot, \d+ m /);
    expect(await page.locator("#hud-goal").textContent()).toBe(g.text);
    await page.screenshot({ path: `${SHOTS}/tour-desktop-next-spot.jpg`, type: "jpeg", quality: JPEG });
    expect(errors).toEqual([]);
  });
});

test.describe("a timed round", () => {
  test("warns when the target spot is too far for the time left", async ({ page }) => {
    test.setTimeout(300000);
    const errors = collectErrors(page);
    await open(page);
    await nearSpotsDone(page);
    await page.waitForFunction(() => window.__atl.landmarks.banner().current === null, null, { timeout: 60000 });
    const early = await guide(page);
    expect(early.warn).toBe(false);
    // The next spot is more than GUIDE.near away. With 20 s left it cannot be reached.
    await page.evaluate(() => window.__atl.goals.setTimeLeft(20));
    await page.waitForFunction(() => window.__atl.landmarkFx.guide?.warn === true, null, { timeout: 10000 });
    const late = await guide(page);
    expect(late.kind).toBe("next");
    expect(late.text.split("\n")[1]).toBe(TOO_FAR);
    expect(await page.locator("#hud-goal").textContent()).toBe(late.text);
    await page.screenshot({ path: `${SHOTS}/reach-warning-desktop.jpg`, type: "jpeg", quality: JPEG });

    // A Found spot near the skater, with too little time: the claim line warns too.
    await page.evaluate(() => {
      window.__atl.resetSkater([336, window.__atl.level.sample(336, 60, 26.5).height, 60], Math.PI / 2);
      window.__atl.landmarks.reset();
      window.__atl.landmarks.find("freedom-parkway-bridge");
      window.__atl.landmarks.claim("historic-fourth-ward-skatepark");
    });
    await page.waitForFunction(() => window.__atl.landmarkFx.guide?.kind === "claim", null, { timeout: 10000 });
    expect((await guide(page)).warn).toBe(false);
    await page.evaluate(() => window.__atl.goals.setTimeLeft(3));
    await page.waitForFunction(() => window.__atl.landmarkFx.guide?.warn === true, null, { timeout: 10000 });
    expect((await guide(page)).text).toBe(`Claim it: hop under the Freedom Parkway bridge\n${TOO_FAR}`);
    expect(GUIDE.near).toBeGreaterThan(40);
    expect(errors).toEqual([]);
  });

  test("ends softly: the input stops with a message, the results follow, and a push key held through the results works after Skate again", async ({ page }) => {
    test.setTimeout(300000);
    const errors = collectErrors(page);
    await open(page);
    await page.evaluate(() => window.__atl.resetSkater());
    // The push key is held from before the end to after the replay.
    await page.keyboard.down("KeyW");
    await page.waitForFunction(() => window.__atl.skater.speed > 3, null, { timeout: 30000 });
    // Each frame: the run tick when the run ended, and when the results show.
    await page.evaluate(() => {
      const w = (window.__end = { ended: null, shown: null });
      const tick = () => {
        const a = window.__atl;
        if (w.ended === null && a.goals.state.ended) w.ended = a.events.find((e) => e.type === "run-end")?.tick ?? null;
        if (w.shown === null && a.goals.shown) w.shown = a.run.tick;
        if (w.shown === null) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__atl.goals.setTimeLeft(0);
    });
    await page.waitForFunction(() => window.__atl.goals.phase === "stopping", null, { timeout: 10000 });
    const stopping = await page.evaluate(() => ({ status: document.getElementById("hud-notice").textContent, hidden: document.getElementById("hud-notice").hidden, round: document.getElementById("hud-notice").dataset.round, results: window.__atl.goals.shown, goal: document.getElementById("hud-goal").hidden, speed: window.__atl.skater.speed }));
    expect(stopping).toMatchObject({ status: STOPPING_TEXT, hidden: false, round: "1", results: null, goal: true });
    expect(inside(await box(page, "#hud-notice"))).toBe(true);
    await page.screenshot({ path: `${SHOTS}/round-end-desktop.jpg`, type: "jpeg", quality: JPEG });
    // The results show after the hold, in sim time. The skater rolls on with no push.
    await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 30000 });
    await page.waitForFunction(() => window.__end.shown !== null, null, { timeout: 10000 });
    const shown = await page.evaluate(() => ({ end: window.__end, speed: window.__atl.skater.speed, status: document.getElementById("hud-notice").hidden }));
    // The results show ROUND_END.hold s of sim time after the end (a frame can add a few ticks).
    expect(shown.end.shown - shown.end.ended).toBeGreaterThanOrEqual(Math.round(ROUND_END.hold * 60) - 1);
    expect(shown.end.shown - shown.end.ended).toBeLessThanOrEqual(Math.round(ROUND_END.hold * 60) + 12);
    expect(shown.speed).toBeLessThan(stopping.speed + 0.05);
    expect(shown.status).toBe(true);
    await expect(page.locator("#results-tour")).toHaveText(TOUR_BUTTON);

    // Enter replays while W is still down: the held key pushes in the new run (audit E1).
    await page.keyboard.press("Enter");
    await expect(page.locator("#results")).toBeHidden();
    await page.waitForFunction(() => window.__atl.goals.phase === "play", null, { timeout: 10000 });
    await page.waitForFunction(() => window.__atl.skater.speed > 3, null, { timeout: 10000 });
    // The same with a click on "Skate again".
    await page.evaluate(() => window.__atl.goals.setTimeLeft(0));
    await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 30000 });
    await page.locator("#results-replay").click();
    await expect(page.locator("#results")).toBeHidden();
    await page.waitForFunction(() => window.__atl.skater.speed > 3, null, { timeout: 10000 });
    await page.keyboard.up("KeyW");
    expect(errors).toEqual([]);
  });

  test("an open combo at the end shows the overtime line, then the round line", async ({ page }) => {
    test.setTimeout(300000);
    await page.goto("/?mute=1&level=greybox");
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
    // The 3-link combo of e2e/goals.spec.js.
    await page.evaluate((bal) => {
      window.__atl.runScript(
        [
          { frames: 90, input: { push: true } },
          { frames: 40, input: { grind: true, steer: bal } },
          { frames: 1, input: { grind: true, steer: bal, jump: true } },
          { frames: 45, input: {} },
          { frames: 1, input: { style1: true } },
          { frames: 80, input: {} },
        ],
        { position: [-26, 0, -2], yaw: 0 },
      );
    }, BAL);
    await page.waitForFunction(() => window.__atl.combo.active, null, { timeout: 20000 });
    await page.evaluate(() => window.__atl.goals.setTimeLeft(0));
    await page.waitForFunction(() => window.__atl.goals.phase === "overtime", null, { timeout: 10000 });
    const text = await page.locator("#hud-notice").textContent();
    expect(text).toMatch(new RegExp(`^${OVERTIME_TEXT}: \\d+ s$`));
    await page.screenshot({ path: `${SHOTS}/round-overtime-desktop.jpg`, type: "jpeg", quality: JPEG });
    await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 30000 });
  });

  test("the Tour button of the results loads the same level as a tour", async ({ page }) => {
    test.setTimeout(300000);
    await open(page);
    await page.evaluate(() => window.__atl.goals.setTimeLeft(0));
    await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 30000 });
    await page.screenshot({ path: `${SHOTS}/results-tour-button-desktop.jpg`, type: "jpeg", quality: JPEG });
    await Promise.all([page.waitForURL(/run=tour/, { timeout: 60000 }), page.locator("#results-tour").click()]);
    const url = new URL(page.url());
    expect(url.searchParams.get("run")).toBe("tour");
    expect(url.searchParams.get("level")).toBe("beltline-eastside");
    await page.waitForFunction(() => window.__atl && window.__atl.ready, null, { timeout: 240000 });
    expect(await page.evaluate(() => window.__atl.landmarkFx.mode)).toBe("tour");
  });
});

for (const size of [
  { name: "portrait", viewport: { width: 390, height: 844 } },
  { name: "landscape", viewport: { width: 844, height: 390 } },
]) {
  test.describe(`phone ${size.name}`, () => {
    test.use({ ...pixel, viewport: size.viewport });

    test("the tour, the next spot line, the reach warning, the round line and the Tour button are on the screen", async ({ page }) => {
      test.setTimeout(600000);
      const errors = collectErrors(page);
      await open(page, "run=tour");
      await expect(page.locator("#hud-timer")).toHaveText("TOUR");
      await nearSpotsDone(page);
      await page.waitForFunction(() => window.__atl.landmarks.banner().current === null, null, { timeout: 60000 });
      expect(inside(await box(page, "#hud-goal"))).toBe(true);
      expect(inside(await box(page, "#hud-timer"))).toBe(true);
      await page.screenshot({ path: `${SHOTS}/tour-phone-${size.name}.jpg`, type: "jpeg", quality: JPEG });

      await open(page);
      await nearSpotsDone(page);
      await page.waitForFunction(() => window.__atl.landmarks.banner().current === null, null, { timeout: 60000 });
      await page.evaluate(() => window.__atl.goals.setTimeLeft(20));
      await page.waitForFunction(() => window.__atl.landmarkFx.guide?.warn === true, null, { timeout: 10000 });
      expect(inside(await box(page, "#hud-goal"))).toBe(true);
      await page.screenshot({ path: `${SHOTS}/reach-warning-phone-${size.name}.jpg`, type: "jpeg", quality: JPEG });

      await page.evaluate(() => window.__atl.goals.setTimeLeft(0));
      await page.waitForFunction(() => window.__atl.goals.phase === "stopping", null, { timeout: 10000 });
      expect(inside(await box(page, "#hud-notice"))).toBe(true);
      await page.screenshot({ path: `${SHOTS}/round-end-phone-${size.name}.jpg`, type: "jpeg", quality: JPEG });
      await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 30000 });
      // The replay button stays on the screen with no scroll; the Tour button is a touch target.
      const replay = await box(page, "#results-replay");
      const tour = await box(page, "#results-tour");
      expect(inside(replay)).toBe(true);
      expect(tour.h).toBeGreaterThanOrEqual(44);
      // In landscape both buttons share a row inside the card, with no scroll.
      if (size.name === "landscape") {
        const card = await box(page, ".results-card");
        expect(Math.abs(tour.y - replay.y)).toBeLessThan(1);
        expect(tour.y + tour.h).toBeLessThanOrEqual(card.y + card.h + 0.5);
      }
      await page.screenshot({ path: `${SHOTS}/results-tour-button-phone-${size.name}.jpg`, type: "jpeg", quality: JPEG });
      expect(errors).toEqual([]);
    });
  });
}
