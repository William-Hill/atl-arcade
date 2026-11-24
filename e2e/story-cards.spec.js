import { readFileSync } from "node:fs";
import { expect, test, devices } from "@playwright/test";

// The landmark story cards, the results row and "Reset progress" (#220,
// design/gdd/landmark-discovery.md "Story card", "UI Requirements", AC-6,
// AC-7, E-5, E-8, R-1). The spot states are set through the dev test hook
// (window.__atl.landmarks). Screenshots go to e2e/__screenshots__.

const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars
const PHONE = { ...pixel, viewport: { width: 390, height: 844 } };
const FILE = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/landmarks.json", import.meta.url), "utf8"));
const SHOTS = "e2e/__screenshots__";
const JPEG = 80;

const HARD = "ponce-city-market"; // a hard spot: the foil edge
const EASY = "studioplex";
const FOUND = "krog-street-market";
const EDGE = "jimmy-carter-library";
const spotOf = (id) => FILE.spots.find((s) => s.id === id);

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function ready(page, query = "") {
  await page.goto(`/?level=beltline-eastside&mute=1${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5 && window.__atl.fullmap && window.__atl.landmarks, null, { timeout: 120000 });
  // Away from every find zone, with every spot Unknown again.
  await page.evaluate(() => {
    const [x, z] = [150, 600];
    window.__atl.resetSkater([x, window.__atl.level.sample(x, z)?.height ?? 0, z], 1.5);
    window.__atl.landmarks.reset();
  });
  const frames = await page.evaluate(() => window.__atl.frames);
  await page.waitForFunction((f) => window.__atl.frames > f + 3, frames);
}

// The art of the open card is loaded (a real picture, not a broken image).
const artLoaded = (card) => card.locator(".story-card-art img").evaluate((img) => img.complete && img.naturalWidth > 0);

async function expectStoryCard(card, id, { stamp, foil }) {
  const spot = spotOf(id);
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/is-story/);
  await expect(card).toHaveAttribute("data-spot", id);
  await expect(card.locator(".fullmap-card-title")).toHaveText(spot.name);
  await expect(card.locator(".fullmap-card-facts li")).toHaveCount(Math.min(5, spot.card.length));
  await expect(card.locator(".story-card-art")).toBeVisible();
  await expect.poll(() => artLoaded(card), { timeout: 10000 }).toBe(true);
  if (stamp) await expect(card.locator(".story-card-stamp")).toHaveText("NEW");
  else await expect(card.locator(".story-card-stamp")).toBeHidden();
  await expect(card).toHaveAttribute("data-foil", foil ? "1" : "0");
  const look = await card.evaluate((n) => {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    return { paper: cs.backgroundColor, band: getComputedStyle(n.querySelector(".fullmap-card-head")).backgroundColor, ratio: r.width / r.height, animation: cs.animationName, inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
  });
  // A foil card draws the paper as a gradient layer; a plain card is #f5ecd7.
  if (!foil) expect(look.paper).toBe("rgb(245, 236, 215)");
  expect(look.band).not.toBe("rgba(0, 0, 0, 0)");
  expect(look.inView).toBe(true);
  return look;
}

test.describe("on a desktop", () => {
  test("the full map opens the story card of a Claimed spot and a Found edge marker; a Found spot stays plain", async ({ page }) => {
    test.setTimeout(240000);
    const errors = collectErrors(page);
    await ready(page);
    await page.evaluate(({ HARD, FOUND, EDGE }) => {
      const L = window.__atl.landmarks;
      L.claim(HARD);
      L.find(FOUND);
      L.find(EDGE);
    }, { HARD, FOUND, EDGE });
    // AC-7: no story card shows during play after a claim.
    await expect(page.locator("#fullmap .fullmap-card")).toBeHidden();
    await expect(page.locator("#story-view")).toBeHidden();

    await page.evaluate(() => window.__atl.fullmap.open());
    const card = page.locator("#fullmap .fullmap-card");
    await page.evaluate((id) => window.__atl.fullmap.openSpot(id), HARD);
    const look = await expectStoryCard(card, HARD, { stamp: true, foil: true });
    // A portrait 3:4 card, with the foil shimmer on.
    expect(Math.abs(look.ratio - 0.75)).toBeLessThan(0.02);
    expect(look.animation).toBe("story-foil");
    // Every source is an https link that opens in a new tab.
    const links = await card.locator(".fullmap-card-source a").evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href"), target: a.target, rel: a.rel })));
    expect(links.length).toBe(5);
    for (const l of links) expect(l).toMatchObject({ target: "_blank", rel: "noopener noreferrer" });
    for (const l of links) expect(l.href.startsWith("https://")).toBe(true);
    await page.screenshot({ path: `${SHOTS}/story-card-fullmap-desktop.jpg`, type: "jpeg", quality: JPEG });

    // The Guide tab opens the same card from its row, by the keyboard.
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await page.keyboard.press("KeyG");
    const row = page.locator(`#fullmap .fullmap-guide-row[data-spot="${EDGE}"]`);
    await row.focus();
    await page.keyboard.press("Enter");
    await expectStoryCard(card, EDGE, { stamp: false, foil: false });
    await expect(card.locator(".fullmap-card-close")).toBeFocused();
    await page.screenshot({ path: `${SHOTS}/story-card-edge-desktop.jpg`, type: "jpeg", quality: JPEG });
    await page.keyboard.press("Escape");
    await expect(row).toBeFocused();

    // A Found claim spot: the plain panel, with no art and no facts.
    await page.evaluate((id) => window.__atl.fullmap.openSpot(id), FOUND);
    await expect(card).not.toHaveClass(/is-story/);
    await expect(card.locator(".story-card-art")).toBeHidden();
    await expect(card.locator(".fullmap-card-facts")).toHaveCount(0);
    expect(await card.innerText()).toContain("Claim it to unlock");
    expect(errors).toEqual([]);
  });

  test("the results screen shows a row of the cards of this run; a card opens and closes, and Enter does not replay under it", async ({ page }) => {
    test.setTimeout(240000);
    const errors = collectErrors(page);
    await ready(page);
    // A claim of an earlier run stays in the save, but it is not in the row (AC-6).
    await page.evaluate((id) => window.__atl.landmarks.claim(id), FOUND);
    await page.evaluate(() => window.__atl.goals.replay());
    await page.waitForFunction(() => window.__atl.goals.phase === "play", null, { timeout: 10000 });
    await page.evaluate(({ HARD, EASY }) => {
      window.__atl.landmarks.claim(EASY);
      window.__atl.landmarks.claim(HARD);
      window.__atl.goals.setTimeLeft(0);
    }, { HARD, EASY });
    await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 30000 });
    const row = page.locator("#results-spots");
    await expect(row).toBeVisible();
    await expect(row.locator(".results-spots-title")).toHaveText("Spots claimed");
    expect(await page.evaluate(() => window.__atl.goals.spots)).toEqual([EASY, HARD]);
    await expect(row.locator(".results-spot-stamp")).toHaveCount(2);
    await expect.poll(() => row.locator(".results-spot img").evaluateAll((imgs) => imgs.every((i) => i.complete && i.naturalWidth > 0)), { timeout: 10000 }).toBe(true);
    await page.screenshot({ path: `${SHOTS}/story-results-row-desktop.jpg`, type: "jpeg", quality: JPEG });

    // A click opens the card over the results.
    const button = row.locator(`.results-spot[data-spot="${HARD}"]`);
    await button.click();
    const view = page.locator("#story-view");
    await expect(view).toBeVisible();
    await expectStoryCard(view.locator(".fullmap-card"), HARD, { stamp: true, foil: true });
    await page.screenshot({ path: `${SHOTS}/story-results-card-desktop.jpg`, type: "jpeg", quality: JPEG });
    // Enter on the close button closes the card; it does not start a new run.
    await page.keyboard.press("Enter");
    await expect(view).toBeHidden();
    await expect(button).toBeFocused();
    expect(await page.evaluate(() => window.__atl.goals.shown !== null)).toBe(true);
    // Enter or Space on a focused card opens it again; Escape closes it.
    await page.keyboard.press("Space");
    await expect(view).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(view).toBeHidden();
    // A click outside the card closes it.
    await row.locator(`.results-spot[data-spot="${EASY}"]`).click();
    await expect(view).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(view).toBeHidden();
    expect(await page.evaluate(() => window.__atl.goals.shown !== null)).toBe(true);
    // "Skate again" clears the row for the next run.
    await page.locator("#results-replay").click();
    await expect(page.locator("#results")).toBeHidden();
    await page.evaluate(() => window.__atl.goals.setTimeLeft(0));
    await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 30000 });
    await expect(row).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("Reset progress asks first: Cancel changes nothing, Reset makes every spot Unknown and keeps the outfits", async ({ page }) => {
    test.setTimeout(240000);
    const errors = collectErrors(page);
    await ready(page);
    await page.evaluate(({ HARD, EDGE }) => {
      window.__atl.landmarks.claim(HARD);
      window.__atl.landmarks.find(EDGE);
    }, { HARD, EDGE });
    const before = await page.evaluate(() => window.__atl.landmarks.states());
    const outfits = await page.evaluate(() => JSON.parse(localStorage.getItem("atl.landmarks")).levels["beltline-eastside"].outfits);
    await page.keyboard.press("KeyO");
    const menu = page.locator("#settings-menu");
    await expect(menu).toBeVisible();
    await expect(page.locator("#settings-progress-note")).toBeHidden();
    await page.locator("#settings-reset").click();
    const confirm = page.locator("#settings-reset-dialog");
    await expect(confirm).toBeVisible();
    await expect(page.locator("#settings-reset-no")).toBeFocused();
    await page.screenshot({ path: `${SHOTS}/story-reset-confirm-desktop.jpg`, type: "jpeg", quality: JPEG });
    // Cancel: nothing changes, and the menu stays open.
    await page.locator("#settings-reset-no").click();
    await expect(confirm).toBeHidden();
    await expect(menu).toBeVisible();
    expect(await page.evaluate(() => window.__atl.landmarks.states())).toEqual(before);
    // Escape in the confirm is a Cancel too.
    await page.locator("#settings-reset").click();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    expect(await page.evaluate(() => window.__atl.landmarks.states())).toEqual(before);
    // Reset.
    await page.locator("#settings-reset").click();
    await page.locator("#settings-reset-yes").click();
    await expect(confirm).toBeHidden();
    await expect(page.locator("#settings-status")).toHaveText("Progress reset.");
    await expect(page.locator("#settings-reset")).toBeFocused();
    await page.screenshot({ path: `${SHOTS}/story-reset-done-desktop.jpg`, type: "jpeg", quality: JPEG });
    const after = await page.evaluate(() => ({ states: window.__atl.landmarks.states(), store: JSON.parse(localStorage.getItem("atl.landmarks")) }));
    expect(Object.values(after.states).every((s) => s === "unknown")).toBe(true);
    expect(after.store.levels["beltline-eastside"]).toMatchObject({ found: [], claimed: [], outfits });
    // The state stays after a reload.
    await page.reload();
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.landmarks, null, { timeout: 120000 });
    const reloaded = await page.evaluate(() => window.__atl.landmarks.states());
    expect(reloaded[HARD]).toBe("unknown");
    expect(reloaded[EDGE]).toBe("unknown");
    expect(errors).toEqual([]);
  });

  test("with blocked storage a claim stays for this run, and the menu says progress is not saved (E-5)", async ({ page }) => {
    test.setTimeout(240000);
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      Storage.prototype.setItem = function setItem() {
        throw new DOMException("blocked", "SecurityError");
      };
    });
    await ready(page);
    await page.evaluate((id) => window.__atl.landmarks.claim(id), HARD);
    expect(await page.evaluate((id) => window.__atl.landmarks.states()[id], HARD)).toBe("claimed");
    expect(await page.evaluate(() => window.__atl.landmarks.saved())).toBe(false);
    await page.keyboard.press("KeyO");
    await expect(page.locator("#settings-progress-note")).toHaveText("Progress is not saved in this browser.");
    await expect(page.locator("#settings-progress-note")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/story-not-saved-desktop.jpg`, type: "jpeg", quality: JPEG });
    expect(errors).toEqual([]);
  });

  test("with reduced motion the foil edge does not move (R-1)", async ({ page }) => {
    test.setTimeout(180000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ready(page);
    await page.evaluate((id) => window.__atl.landmarks.claim(id), HARD);
    await page.evaluate(() => window.__atl.fullmap.open());
    await page.evaluate((id) => window.__atl.fullmap.openSpot(id), HARD);
    const card = page.locator("#fullmap .fullmap-card");
    await expect(card).toHaveAttribute("data-motion", "reduced");
    await expect(card).toHaveAttribute("data-foil", "1");
    expect(await card.evaluate((n) => getComputedStyle(n).animationName)).toBe("none");
  });
});

test.describe("on a phone", () => {
  test.use(PHONE);

  test("the card fits the screen on the full map and from the results row, by touch", async ({ page }) => {
    test.setTimeout(300000);
    const errors = collectErrors(page);
    await ready(page);
    await page.evaluate(({ HARD, EASY }) => {
      window.__atl.landmarks.claim(EASY);
      window.__atl.landmarks.claim(HARD);
    }, { HARD, EASY });
    await page.evaluate(() => window.__atl.fullmap.open());
    await page.evaluate((id) => window.__atl.fullmap.openSpot(id), EASY);
    const card = page.locator("#fullmap .fullmap-card");
    const look = await expectStoryCard(card, EASY, { stamp: true, foil: false });
    expect(Math.abs(look.ratio - 0.75)).toBeLessThan(0.02);
    await page.screenshot({ path: `${SHOTS}/story-card-fullmap-phone.jpg`, type: "jpeg", quality: JPEG });
    await card.locator(".fullmap-card-close").tap();
    await expect(card).toBeHidden();
    await page.evaluate(() => window.__atl.fullmap.close());

    await page.evaluate(() => window.__atl.goals.setTimeLeft(0));
    await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 30000 });
    const row = page.locator("#results-spots");
    await expect(row).toBeVisible();
    await row.scrollIntoViewIfNeeded();
    // Each card is a 44 px or larger touch target.
    for (const box of await row.locator(".results-spot").evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().toJSON()))) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `${SHOTS}/story-results-row-phone.jpg`, type: "jpeg", quality: JPEG });
    await row.locator(`.results-spot[data-spot="${HARD}"]`).tap();
    const view = page.locator("#story-view");
    await expectStoryCard(view.locator(".fullmap-card"), HARD, { stamp: true, foil: true });
    await page.screenshot({ path: `${SHOTS}/story-results-card-phone.jpg`, type: "jpeg", quality: JPEG });
    // A tap outside the card closes it.
    await page.touchscreen.tap(195, 830);
    await expect(view).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("Reset progress works by touch", async ({ page }) => {
    test.setTimeout(240000);
    await ready(page);
    await page.evaluate((id) => window.__atl.landmarks.claim(id), HARD);
    await page.locator("#settings-toggle").tap();
    await page.locator("#settings-reset").scrollIntoViewIfNeeded();
    await page.locator("#settings-reset").tap();
    await expect(page.locator("#settings-reset-dialog")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/story-reset-confirm-phone.jpg`, type: "jpeg", quality: JPEG });
    await page.locator("#settings-reset-yes").tap();
    await expect(page.locator("#settings-reset-dialog")).toBeHidden();
    expect(await page.evaluate((id) => window.__atl.landmarks.states()[id], HARD)).toBe("unknown");
  });
});

test.describe("on a phone in landscape", () => {
  test.use({ ...PHONE, viewport: { width: 844, height: 390 } });

  test("the card turns on its side, and a closed card is hidden", async ({ page }) => {
    test.setTimeout(240000);
    await ready(page);
    await page.evaluate((id) => window.__atl.landmarks.claim(id), HARD);
    await page.evaluate(() => window.__atl.fullmap.open());
    await page.evaluate((id) => window.__atl.fullmap.openSpot(id), HARD);
    const card = page.locator("#fullmap .fullmap-card");
    const look = await expectStoryCard(card, HARD, { stamp: true, foil: true });
    expect(look.ratio).toBeGreaterThan(1);
    await page.screenshot({ path: `${SHOTS}/story-card-fullmap-landscape.jpg`, type: "jpeg", quality: JPEG });
    await card.locator(".fullmap-card-close").tap();
    await expect(card).toBeHidden();
    expect(await card.evaluate((n) => getComputedStyle(n).display)).toBe("none");
  });
});
