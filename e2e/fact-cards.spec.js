import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fixtureFacts } from "../src/facts/client.js";

// M1-07 (#17): 3 fact cards on the BeltLine level, from the open-data-atl
// fixture. Collecting a card adds its points, shows the text for 2 s, and
// does not pause play. The pop-up stays clear of the HUD, the minimap, the
// skater select, the map credit, and the touch controls.

const SPECS = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/facts.json", import.meta.url), "utf8")).cards;
const FIXTURE = JSON.parse(readFileSync(new URL("../src/facts/fixtures/beltline-eastside.json", import.meta.url), "utf8"));
const TEXTS = fixtureFacts(SPECS, FIXTURE).map((c) => c.text);

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

// Requests that leave the dev server for the open-data-atl site.
function watchFactCalls(page) {
  const calls = [];
  page.on("request", (req) => {
    if (/agenticatl\.ai|\/oda-api\//.test(req.url())) calls.push(req.url());
  });
  return calls;
}

async function open(page, query = "") {
  await page.goto(`/?level=beltline-eastside&mute=1&props=0&landmarks=0&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
}

// Puts the skater on card `i` (a new run) and waits for the pop-up.
async function collect(page, i) {
  await page.evaluate((i) => {
    const card = window.__atl.facts.cards[i];
    window.__atl.resetSkater(card.position, 0);
  }, i);
  await page.waitForFunction(() => window.__atl.facts.collected === 1 && window.__atl.facts.popup.visible, null, { timeout: 10000 });
}

// The boxes that the pop-up must not cover. Empty HUD items have no box.
async function overlaps(page) {
  return page.evaluate(() => {
    const popup = document.getElementById("fact-popup").getBoundingClientRect();
    const sel = ["#hud > *", "#minimap", "#skater-select button", "#attribution .attr-short", "#attribution .attr-full", ".touch-btn", ".touch-stick-base"];
    const hits = [];
    for (const s of sel) {
      for (const el of document.querySelectorAll(s)) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || el.closest("[hidden]")) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cross = r.left < popup.right && r.right > popup.left && r.top < popup.bottom && r.bottom > popup.top;
        if (cross) hits.push(`${s} ${el.id || el.className}`);
      }
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const inside = popup.left >= 0 && popup.top >= 0 && popup.right <= vw && popup.bottom <= vh;
    return { hits, inside, popup: { left: popup.left, top: popup.top, right: popup.right, bottom: popup.bottom } };
  });
}

test("the BeltLine level has 3 fact cards from the fixture, with no network call", async ({ page }) => {
  const errors = collectErrors(page);
  const calls = watchFactCalls(page);
  await open(page);
  const facts = await page.evaluate(() => ({ mode: window.__atl.facts.mode, total: window.__atl.facts.total, collected: window.__atl.facts.collected, cards: window.__atl.facts.cards, visible: window.__atl.facts.visibleCards, runCount: window.__atl.run.cards.count }));
  expect(facts.mode).toBe("fixture");
  expect(facts.total).toBe(3);
  expect(facts.collected).toBe(0);
  expect(facts.runCount).toBe(0);
  expect(facts.visible).toBe(3);
  expect(facts.cards.map((c) => c.text)).toEqual(TEXTS);
  for (const c of facts.cards) {
    expect(c.origin).toBe("fixture");
    expect(c.sourceUrl).toMatch(/^https:\/\/agenticatl\.ai\/datasets\//);
    // Each card is on the trail surface (not inside a building).
    const ground = await page.evaluate(([x, z]) => window.__atl.level.sample(x, z), [c.position[0], c.position[2]]);
    expect(Math.abs(ground.height - c.position[1])).toBeLessThan(0.01);
  }
  expect(calls).toEqual([]);
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("collecting a card scores it and shows the text for 2 s without pausing play", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page);
  for (let i = 0; i < 3; i += 1) {
    await collect(page, i);
    const s = await page.evaluate(() => ({ score: window.__atl.combo.score, popup: window.__atl.facts.popup, events: window.__atl.events.filter((e) => e.type === "fact"), visible: window.__atl.facts.visibleCards, href: document.querySelector("#fact-popup .fact-source").href, label: document.querySelector("#fact-popup .fact-label").textContent }));
    expect(s.score).toBe(250);
    expect(s.popup.text).toBe(TEXTS[i]);
    expect(s.label).toBe("ATL FACT 1/3");
    expect(s.href).toBe(`https://agenticatl.ai/datasets/${SPECS[i].dataset}`);
    expect(s.events).toHaveLength(1);
    expect(s.events[0].id).toBe(SPECS[i].id);
    expect(s.visible).toBe(2);
    if (i === 0) {
      const box = await overlaps(page);
      expect(box.hits, JSON.stringify(box)).toEqual([]);
      expect(box.inside).toBe(true);
      await page.screenshot({ path: "e2e/__screenshots__/fact-card-desktop.png" });
    }
  }
  // Play does not pause: the sim ticks and the skater moves while the
  // pop-up shows. Then the pop-up hides after about 2 s.
  const before = await page.evaluate(() => ({ ticks: window.__atl.ticks, shownAt: performance.now() }));
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(800);
  const during = await page.evaluate(() => ({ ticks: window.__atl.ticks, visible: window.__atl.facts.popup.visible, speed: window.__atl.skater.speed }));
  await page.keyboard.up("KeyW");
  expect(during.visible).toBe(true);
  expect(during.ticks - before.ticks).toBeGreaterThan(20);
  expect(during.speed).toBeGreaterThan(0.5);
  await page.waitForFunction(() => !window.__atl.facts.popup.visible, null, { timeout: 4000 });
  const hiddenAfter = await page.evaluate((t0) => performance.now() - t0, before.shownAt);
  expect(hiddenAfter).toBeLessThan(2600);
  // The same card does not count twice in one run.
  expect(await page.evaluate(() => window.__atl.facts.collected)).toBe(1);
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

for (const vp of [
  { name: "portrait", width: 390, height: 844 },
  { name: "landscape", width: 844, height: 390 },
]) {
  test(`the pop-up stays clear of the touch controls and the HUD on a phone in ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await open(page, "touch=1");
    await collect(page, 1);
    const box = await overlaps(page);
    expect(box.hits, JSON.stringify(box)).toEqual([]);
    expect(box.inside).toBe(true);
    await page.screenshot({ path: `e2e/__screenshots__/fact-card-phone-${vp.name}.png` });
  });
}

test("?facts=0 removes the cards", async ({ page }) => {
  await open(page, "facts=0");
  const f = await page.evaluate(() => ({ mode: window.__atl.facts.mode, total: window.__atl.facts.total, popup: window.__atl.facts.popup }));
  expect(f).toEqual({ mode: "off", total: 0, popup: null });
});

test("an uncollected card floats over the trail", async ({ page }) => {
  await open(page, "view=fixed&npcs=0");
  const card = await page.evaluate(() => window.__atl.facts.cards[0]);
  const [x, y, z] = card.position;
  await page.evaluate(([x, y, z]) => window.__atl.setFixedCamera(x - 5, y + 2.6, z + 4, x, y + 1.4, z), [x, y, z]);
  await page.waitForTimeout(300);
  // Evidence: the screenshot shows the card. The WebGL canvas keeps no
  // buffer to read back, so the test checks the view state.
  expect(await page.evaluate(() => window.__atl.facts.visibleCards)).toBe(3);
  await page.screenshot({ path: "e2e/__screenshots__/fact-card-world.png" });
});
