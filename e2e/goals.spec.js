import { expect, test, devices } from "@playwright/test";
import { computeResults } from "../src/sim/skate/goals.js";
import { goalsFor } from "../src/level/goals.js";
import { GRIND } from "../src/sim/skate/constants.js";

const BAL = GRIND.balanceDrift / GRIND.balanceCorrect;

// Goals, the run timer, and the results screen (M1-05).

const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars

async function ready(page, query = "") {
  await page.goto(`/?mute=1${query}${query.includes("level=") ? "" : "&level=greybox"}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
}

// Ends the run now and waits for the results screen.
async function endRun(page) {
  await page.evaluate(() => window.__atl.goals.setTimeLeft(0));
  await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 10000 });
  await expect(page.locator("#results")).toBeVisible();
}

function box(page, sel) {
  return page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
  }, sel);
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Hop on the Beltline trail under the Stone Mountain Trail bridge (the same
// line as the Vitest in src/sim/skate/goals.test.js). The skater starts
// facing north (-z, yaw +PI/2): since 3a7c54e the controller does not turn
// her around on the grade.
async function stoneMountainHop(page) {
  return page.evaluate(async () => {
    const y = window.__atl.level.sample(336, 62, 26.5).height;
    await window.__atl.runScript([{ frames: 45, input: { push: true } }, { frames: 1, input: { push: true, jump: true } }, { frames: 90, input: {} }], { position: [336, y, 62], yaw: Math.PI / 2 });
    return window.__atl.events.filter((e) => e.type === "gap").map((e) => e.id);
  });
}

test("the HUD shows a 2:30 timer that counts down in sim time", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.__atl.resetSkater());
  const start = await page.locator("#hud-timer").textContent();
  expect(["2:30", "2:29"]).toContain(start);
  // runScript resets the run, then plays 120 ticks: 2 s of sim time. Read
  // the clock when the script ends (a frame can add up to a few ticks).
  const t1 = await page.evaluate(async () => {
    await window.__atl.runScript([{ frames: 120, input: {} }]);
    return window.__atl.goals.state.timeLeft;
  });
  expect(150 - t1).toBeGreaterThanOrEqual(2 - 1e-6);
  expect(150 - t1).toBeLessThan(2.2);
});

test("a gap, three fact cards and the end of the time give the results; replay starts a new run", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await ready(page);

  // Air off the quarter pipe: the Quarter Pipe Air gap.
  const gaps = await page.evaluate(async () => {
    await window.__atl.runScript([{ frames: 150, input: { push: true } }, { frames: 300, input: {} }], { position: [8, 0, 0], yaw: 0 });
    return window.__atl.events.filter((e) => e.type === "gap").map((e) => e.id);
  });
  expect(gaps).toEqual(["gap-quarter-pipe"]);

  // The fact cards (#17) call collectCard. A second call with one id counts once.
  const counts = await page.evaluate(() => ["a", "b", "b", "c"].map((id) => window.__atl.goals.collectCard(id)));
  expect(counts).toEqual([true, true, false, true]);

  await endRun(page);
  const json = await page.evaluate(() => window.__atl.goals.json);
  expect(json.ended).toBe(true);
  expect(json.cards).toBe(3);
  expect(json.gaps).toEqual(["gap-quarter-pipe"]);
  const events = await page.evaluate(() => window.__atl.events.filter((e) => e.type === "run-end"));
  expect(events).toHaveLength(1);

  // The medal and the goal list come from the run JSON alone.
  const expected = computeResults(json, goalsFor("greybox"));
  const shown = await page.evaluate(() => ({
    medal: document.getElementById("results").dataset.medal,
    score: document.getElementById("results-score").textContent,
    goals: [...document.querySelectorAll("#results-goals li")].map((li) => [li.dataset.goal, li.dataset.done === "1"]),
  }));
  expect(shown.medal).toBe(expected.medal ?? "none");
  expect(shown.score).toBe(expected.score.toLocaleString("en-US"));
  expect(shown.goals).toEqual(expected.goals.map((g) => [g.id, g.done]));
  expect(shown.goals).toContainEqual(["cards", true]);
  expect(shown.goals).toContainEqual(["gap-quarter-pipe", true]);
  expect(shown.goals).toContainEqual(["gap-plaza-stairs", false]);

  // Input after the end does not push the skater.
  const before = await page.evaluate(() => window.__atl.skater.speed);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyW");
  expect(await page.evaluate(() => window.__atl.skater.speed)).toBeLessThanOrEqual(before + 0.05);

  // Enter replays: the results close, and the clock is back to 2:30.
  await page.keyboard.press("Enter");
  await expect(page.locator("#results")).toBeHidden();
  const after = await page.evaluate(() => ({ timeLeft: window.__atl.goals.state.timeLeft, cards: window.__atl.goals.json.cards, gaps: window.__atl.goals.json.gaps }));
  expect(after.timeLeft).toBeGreaterThan(148);
  expect(after.cards).toBe(0);
  expect(after.gaps).toEqual([]);
  expect(errors).toEqual([]);
});

test("an open combo finishes before the results show", async ({ page }) => {
  await ready(page);
  // The 3-link combo of e2e/combo.spec.js. End the time while it is open.
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
  // The run waits for the combo to bank, so the grind points count.
  await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 20000 });
  const json = await page.evaluate(() => window.__atl.goals.json);
  expect(json.score).toBeGreaterThan(0);
  expect(json.score).toBe(json.bestCombo);
});

test("?run=free has no timer and no results", async ({ page }) => {
  await ready(page, "&run=free");
  expect(await page.evaluate(() => window.__atl.goals)).toBe(null);
  await expect(page.locator("#hud-timer")).toBeHidden();
  expect(await page.locator("#results").count()).toBe(0);
});

test("desktop: the results screen on the Beltline keeps clear of the minimap", async ({ page }) => {
  await ready(page, "&level=beltline-eastside");
  expect(await stoneMountainHop(page)).toEqual(["gap-stone-mountain"]);
  await page.evaluate(() => ["fact-1", "fact-2"].forEach((id) => window.__atl.goals.collectCard(id)));
  await endRun(page);
  const card = await box(page, ".results-card");
  const map = await box(page, "#minimap");
  expect(overlaps(card, map)).toBe(false);
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.x + card.w).toBeLessThanOrEqual(card.vw);
  expect(card.y + card.h).toBeLessThanOrEqual(card.vh);
  // The minimap draws over the backdrop: both are fixed children of the body.
  const z = await page.evaluate(() => ["minimap", "results"].map((id) => Number(getComputedStyle(document.getElementById(id)).zIndex)));
  expect(z[0]).toBeGreaterThan(z[1]);
  await expect(page.locator('#results-goals li[data-goal="gap-stone-mountain"]')).toHaveAttribute("data-done", "1");
  // The hop can also pass over a real fact card on the trail (#17). A card
  // counts once, so the count is the union of the two test ids and the
  // cards that the run collected.
  const cards = await page.evaluate(() => new Set(["fact-1", "fact-2", ...window.__atl.run.cards.collected]).size);
  expect(cards).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#results-goals li[data-goal="cards"] .results-progress')).toHaveText(`${Math.min(cards, 3)} / 3`);
  await page.screenshot({ path: "e2e/__screenshots__/results-desktop.png" });
});

for (const size of [
  { name: "portrait", viewport: { width: 390, height: 844 } },
  { name: "landscape", viewport: { width: 844, height: 390 } },
]) {
  test.describe(`phone ${size.name}`, () => {
    test.use({ ...pixel, viewport: size.viewport });

    test("the results screen fits the screen, keeps clear of the minimap, and a tap replays", async ({ page }) => {
      await ready(page, "&level=beltline-eastside");
      expect(await stoneMountainHop(page)).toEqual(["gap-stone-mountain"]);
      await page.evaluate(() => ["fact-1", "fact-2", "fact-3"].forEach((id) => window.__atl.goals.collectCard(id)));
      await endRun(page);
      // The touch controls hide while the results show.
      await expect(page.locator("#touch-controls")).toBeHidden();
      const card = await box(page, ".results-card");
      const map = await box(page, "#minimap");
      const replay = await box(page, "#results-replay");
      expect(overlaps(card, map), "card x minimap").toBe(false);
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.y).toBeGreaterThanOrEqual(0);
      expect(card.x + card.w).toBeLessThanOrEqual(card.vw + 0.5);
      expect(card.y + card.h).toBeLessThanOrEqual(card.vh + 0.5);
      // The replay button is on the screen with no scroll, and 44 px or larger.
      expect(replay.y + replay.h).toBeLessThanOrEqual(card.y + card.h + 0.5);
      expect(replay.h).toBeGreaterThanOrEqual(44);
      // Text is 14 px or larger.
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("#results *")]
          .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
          .map((el) => [el.textContent.trim().slice(0, 20), parseFloat(getComputedStyle(el).fontSize)])
          .filter(([, px]) => px < 14),
      );
      expect(small).toEqual([]);
      await page.screenshot({ path: `e2e/__screenshots__/results-phone-${size.name}.png` });

      await page.locator("#results-replay").tap();
      await expect(page.locator("#results")).toBeHidden();
      await expect(page.locator("#touch-controls")).toBeVisible();
    });
  });
}

// The fact cards on the trail (#17) count for the cards goal (#15).
test("a fact card on the trail counts for the cards goal", async ({ page }) => {
  await page.goto("/?mute=1&level=beltline-eastside");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5 && window.__atl.facts.total > 0, null, { timeout: 60000 });
  await page.evaluate(() => window.__atl.resetSkater(window.__atl.facts.cards[0].position, 0));
  await page.waitForFunction(() => window.__atl.facts.collected === 1, null, { timeout: 10000 });
  await page.waitForFunction(() => window.__atl.goals.state.cards === 1, null, { timeout: 10000 });
  // The test hook adds the same card again: it still counts once.
  const id = await page.evaluate(() => window.__atl.facts.cards[0].id);
  await page.evaluate((id) => window.__atl.goals.collectCard(id), id);
  await page.waitForFunction(() => window.__atl.goals.state.cards === 1, null, { timeout: 5000 });
});
