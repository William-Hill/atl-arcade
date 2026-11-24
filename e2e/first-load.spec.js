import { readFileSync } from "node:fs";
import { expect as baseExpect, test } from "@playwright/test";

// The first load for the City pitch (#353) and the New Realm Brewing story
// card text (#354). Owner decisions 2026-11-24 in docs/decisions.md.
// The pure clock rule has Vitest tests (src/render/weather-view.test.js).
// Screenshots: e2e/__screenshots__/first-load-*.png.

const expect = baseExpect.configure({ timeout: 60000 });
const SHOTS = "e2e/__screenshots__";
const FILE = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/landmarks.json", import.meta.url), "utf8"));
const NEW_REALM = "new-realm-brewing";

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test.describe("first load (#353, #354)", () => {
  test.setTimeout(300000);

  test("with no URL parameters the level loads on a clear afternoon", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 8 && window.__atl.weather, null, { timeout: 240000 });
    const w = await page.evaluate(() => window.__atl.weather);
    expect(w.kind).toBe("clear");
    expect(w.hour).toBe(14);
    expect(w.elevation).toBeGreaterThan(20);
    expect(w.rain).toBe(0);
    expect(w.wet).toBe(0);
    await page.evaluate(() => (window.__atl.renderPaused = true));
    await page.screenshot({ path: `${SHOTS}/first-load-default.png` });
    await page.evaluate(() => (window.__atl.renderPaused = false));
    // A resample (every 30 s of play) keeps the afternoon.
    await page.waitForTimeout(2000);
    expect((await page.evaluate(() => window.__atl.weather)).hour).toBe(14);
    expect(errors).toEqual([]);
  });

  test("?time=now&weather=auto still gives the real Atlanta clock and the seasonal draw", async ({ page }) => {
    await page.goto("/?level=beltline-eastside&mute=1&time=now&weather=auto&cars=0&npcs=0&peds=0");
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.weather, null, { timeout: 240000 });
    const { hour, atl } = await page.evaluate(() => {
      const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
      const p = Object.fromEntries(f.map((x) => [x.type, Number(x.value)]));
      return { hour: window.__atl.weather.hour, atl: p.hour + p.minute / 60 };
    });
    expect(Math.abs(hour - atl)).toBeLessThan(0.1);
  });

  test("the New Realm Brewing story card names no alcohol", async ({ page }) => {
    const spot = FILE.spots.find((s) => s.id === NEW_REALM);
    for (const f of spot.card) expect(f.text).not.toMatch(/beer|spirits|brew(ed|s)?\b|ale\b|liquor|cocktail|wine/i);
    await page.goto("/?level=beltline-eastside&mute=1&cars=0&npcs=0&peds=0");
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5 && window.__atl.fullmap && window.__atl.landmarks, null, { timeout: 240000 });
    await page.evaluate((id) => {
      window.__atl.landmarks.reset();
      window.__atl.landmarks.claim(id);
      window.__atl.fullmap.open();
      window.__atl.fullmap.openSpot(id);
    }, NEW_REALM);
    const card = page.locator("#fullmap .fullmap-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-spot", NEW_REALM);
    await expect(card).toHaveAttribute("data-look", "claimed");
    const text = await card.innerText();
    expect(text).toContain("New Realm has a full food menu and hosts trivia, vintage market pop-ups and live music four days a week.");
    expect(text).not.toMatch(/beer|spirits/i);
    await page.screenshot({ path: `${SHOTS}/first-load-new-realm-card.png` });
  });
});
