import { expect, test, devices } from "@playwright/test";
import { contrast, over } from "../src/ui/layout.js";

// The round goals on the HUD (#268): a chip per goal with its progress
// during play, a short confirmation when a goal is met, no overlap with the
// landmark goal line or the touch controls. Chromium with phone descriptors.

const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars

async function ready(page, query = "&level=beltline-eastside") {
  await page.goto(`/?mute=1${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 90000 });
}

const chips = (page) => page.evaluate(() => [...document.querySelectorAll("#hud-goals .hud-goal-chip")].map((c) => [c.dataset.goal, c.textContent, c.dataset.done]));

// The boxes of the items a player reads or touches.
function boxes(page) {
  return page.evaluate(() => {
    const sels = {
      score: "#hud-score", timer: "#hud-timer", combo: "#hud-combo", pending: "#hud-pending", tag: "#hud-tag", hint: "#hud-hint",
      notice: "#hud-notice", edge: "#hud-edge", goal: "#hud-goal", style: ".hud-style", balance: "#hud-balance", pulse: "#hud-pulse",
      goals: "#hud-goals", met: "#hud-met",
      credit: "#attribution .attr-short", nia: '#skater-select button[data-skater="nia"]', marcus: '#skater-select button[data-skater="marcus"]',
      minimap: "#minimap", stick: ".touch-stick-base", jump: ".touch-jump", grind: ".touch-grind", groove: ".touch-style1", spin: ".touch-style2", switch: ".touch-switch",
      settings: "#settings-toggle", photo: "#photo-toggle", fullscreen: "#fullscreen-toggle", turn: "#turn-hint",
      banner: "#landmark-banner", popup: "#fact-popup",
    };
    const out = {};
    for (const [name, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || el.hidden || Number(cs.opacity) === 0) continue;
      if (["combo", "pending", "tag"].includes(name) && !el.textContent.trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out[name] = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    return { items: out, w: innerWidth, h: innerHeight };
  });
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Shows a full HUD: a combo, a move tag, the balance meter, the landmark goal
// line, and a met goal. The render loop pauses, so the HUD keeps the text.
async function fillHud(page) {
  await page.evaluate(() => {
    window.__atl.renderPaused = true;
    const combo = document.getElementById("hud-combo");
    combo.textContent = "Rail Grind + Hop + Bankhead Bounce";
    combo.dataset.active = "1";
    document.getElementById("hud-pending").textContent = "1,890 x 3";
    const tag = document.getElementById("hud-tag");
    tag.textContent = "PERFECT Bankhead Bounce";
    tag.style.opacity = "1";
    document.getElementById("hud-balance").style.display = "";
    const goal = document.getElementById("hud-goal");
    goal.textContent = "Claim it: hop under the Freedom Parkway bridge";
    goal.hidden = false;
    const met = document.getElementById("hud-met");
    met.textContent = "✓ Goal met: Stone Mountain Trail Bridge Hop";
    met.hidden = false;
  });
  // The landmark banner (#219) shows at the spawn: the spawn is in the find
  // zone of a spot. The goals are measured against it too.
  await expect(page.locator("#landmark-banner")).toBeVisible();
}

// No item overlaps the round goals or the confirmation, and both are on the screen.
async function expectClear(page) {
  const { items, w, h } = await boxes(page);
  for (const name of ["goals", "met"]) {
    const a = items[name];
    expect(a, name).toBeTruthy();
    expect(a.x, `${name} left`).toBeGreaterThanOrEqual(0);
    expect(a.y, `${name} top`).toBeGreaterThanOrEqual(0);
    expect(a.x + a.w, `${name} right`).toBeLessThanOrEqual(w + 0.5);
    expect(a.y + a.h, `${name} bottom`).toBeLessThanOrEqual(h + 0.5);
    for (const [other, b] of Object.entries(items)) if (other !== name) expect(overlaps(a, b), `${name} x ${other}`).toBe(false);
  }
}

// Each chip and the confirmation: 14 px or larger, 4.5:1 or more on any scene.
async function expectReadable(page) {
  const rows = await page.evaluate(() => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    return [...document.querySelectorAll("#hud-goals .hud-goal-chip, #hud-met")].map((el) => {
      const cs = getComputedStyle(el);
      return { text: el.textContent, size: parseFloat(cs.fontSize), color: parse(cs.color), pill: parse(cs.backgroundColor) };
    });
  });
  for (const r of rows) {
    expect(r.size, `${r.text} size`).toBeGreaterThanOrEqual(14);
    const pill = r.pill.length === 4 ? r.pill : [...r.pill, 1];
    for (const scene of [[255, 255, 255], [0, 0, 0]]) {
      const bg = over(pill, scene);
      expect(contrast(over([...r.color.slice(0, 3), r.color[3] ?? 1], bg), bg), `${r.text} on ${scene.join(",")}`).toBeGreaterThanOrEqual(4.5);
    }
  }
}

test("desktop: the HUD shows each round goal and its progress, and a met goal shows a confirmation", async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await ready(page);
  await expect(page.locator("#hud-goals")).toBeVisible();
  expect(await chips(page)).toEqual([
    ["score", "Score 0/6,000", "0"],
    ["combo", "Combo 0/1,000", "0"],
    ["cards", "Cards 0/3", "0"],
    ["gap", "Gaps 0/2", "0"],
  ]);
  await expect(page.locator("#hud-met")).toBeHidden();

  // Progress: a fact card counts at once.
  await page.evaluate(() => window.__atl.goals.collectCard("test-card"));
  await expect.poll(() => chips(page).then((c) => c[2][1])).toBe("Cards 1/3");

  // A banked combo of 1,200 points meets the combo goal: the chip gets a
  // check mark, and the confirmation names the goal.
  await page.evaluate(() => {
    const c = window.__atl.run.combo;
    c.best = 1200;
    c.score = 1200;
  });
  await expect(page.locator("#hud-met")).toBeVisible();
  await expect(page.locator("#hud-met")).toHaveText("✓ Goal met: Land a 1,000 point combo");
  expect((await chips(page))[1]).toEqual(["combo", "✓ Combo 1,000/1,000", "1"]);
  expect((await chips(page))[0]).toEqual(["score", "Score 1,200/6,000", "0"]);
  await page.evaluate(() => (window.__atl.renderPaused = true));
  await page.screenshot({ path: "e2e/__screenshots__/hud-goals-desktop-met.png" });
  await page.evaluate(() => (window.__atl.renderPaused = false));

  // The confirmation goes after a short time; the chip keeps the check mark.
  await expect(page.locator("#hud-met")).toBeHidden({ timeout: 15000 });
  expect((await chips(page))[1][2]).toBe("1");

  await fillHud(page);
  await expectClear(page);
  await expectReadable(page);
  await page.screenshot({ path: "e2e/__screenshots__/hud-goals-desktop-full.png" });
  expect(errors).toEqual([]);
});

test("a real gap on the greybox shows its confirmation at that moment", async ({ page }) => {
  test.setTimeout(180000);
  await ready(page, "&level=greybox");
  // Air off the quarter pipe (e2e/goals.spec.js): the Quarter Pipe Air gap.
  await page.evaluate(() => window.__atl.runScript([{ frames: 150, input: { push: true } }, { frames: 300, input: {} }], { position: [8, 0, 0], yaw: 0 }));
  await expect(page.locator("#hud-met")).toHaveText("✓ Goal met: Quarter Pipe Air");
  expect((await chips(page))[3]).toEqual(["gap", "Gaps 1/2", "0"]);
});

test("?run=free shows no round goals", async ({ page }) => {
  await ready(page, "&level=beltline-eastside&run=free");
  await expect(page.locator("#hud-goals")).toBeHidden();
  await expect(page.locator("#hud-met")).toBeHidden();
});

for (const size of [
  { name: "portrait", viewport: { width: 390, height: 844 } },
  { name: "landscape", viewport: { width: 844, height: 390 } },
]) {
  test.describe(`phone ${size.name}`, () => {
    test.use({ ...pixel, viewport: size.viewport });

    test("the goals are compact and clear of the touch controls, PHOTO, SETTINGS and the landmark goal line", async ({ page }) => {
      test.setTimeout(180000);
      await ready(page);
      await page.evaluate(() => {
        const c = window.__atl.run.combo;
        c.score = 6400;
        c.best = 640;
      });
      await expect(page.locator("#hud-met")).toHaveText("✓ Goal met: Score 6,000 points");
      expect(await chips(page)).toEqual([
        ["score", "✓ Score 6K/6K", "1"],
        ["combo", "Combo 640/1K", "0"],
        ["cards", "Cards 0/3", "0"],
        ["gap", "Gaps 0/2", "0"],
      ]);
      await fillHud(page);
      await page.screenshot({ path: `e2e/__screenshots__/hud-goals-phone-${size.name}.png` });
      await expectClear(page);
      await expectReadable(page);
    });
  });
}
