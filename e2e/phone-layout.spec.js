import { expect, test, devices } from "@playwright/test";
import { contrast, over } from "../src/ui/layout.js";
import { COMBO_LINE, comboLine } from "../src/sim/skate/combo.js";

// The phone layout (#73): touch hints, no overlaps, HUD text size and
// contrast, and the skater size in landscape. Chromium with phone
// descriptors; WebKit is not installed.

const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars

// 667 x 375 (a short landscape phone) and 360 x 640 (a short portrait
// phone) came with #277: the landmark banner covered the goal chips at 667 px.
const SIZES = [
  { name: "portrait", viewport: { width: 390, height: 844 } },
  { name: "landscape", viewport: { width: 844, height: 390 } },
  { name: "landscape-667", viewport: { width: 667, height: 375 } },
  { name: "portrait-360", viewport: { width: 360, height: 640 } },
];

async function ready(page, query = "") {
  await page.goto(`/?level=beltline-eastside&mute=1${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
}

// The boxes of every visible item that a player reads or touches.
function boxes(page) {
  return page.evaluate(() => {
    const items = [
      ["score", "#hud-score"],
      ["combo", "#hud-combo"],
      ["pending", "#hud-pending"],
      ["tag", "#hud-tag"],
      ["hint", "#hud-hint"],
      ["style", ".hud-style"],
      ["balance", "#hud-balance"],
      ["pulse", "#hud-pulse"],
      ["credit", "#attribution .attr-short"],
      ["nia", '#skater-select button[data-skater="nia"]'],
      ["marcus", '#skater-select button[data-skater="marcus"]'],
      ["minimap", "#minimap"],
      ["stick", ".touch-stick-base"],
      ["jump", ".touch-jump"],
      ["grind", ".touch-grind"],
      ["groove", ".touch-style1"],
      ["spin", ".touch-style2"],
      ["switch", ".touch-switch"],
      // The landmark goal line (#219): the spawn is in the find zone of a spot.
      ["goal", "#hud-goal"],
      // The round goals (#268) and the confirmation of a met goal.
      ["goals", "#hud-goals"],
      ["met", "#hud-met"],
    ];
    const out = [];
    for (const [name, sel] of items) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      if (["combo", "pending", "tag"].includes(name) && !el.textContent.trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out.push({ name, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return { items: out, w: innerWidth, h: innerHeight };
  });
}

// The longest HUD a player sees: a combo, the pending score, a move tag,
// the balance meter, and the confirmation of a met goal (#268). The render
// loop pauses first, so the HUD update does not clear the text.
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
    // A met round goal (#268): the confirmation line shows.
    const met = document.getElementById("hud-met");
    met.textContent = "\u2713 Goal met: Stone Mountain Trail Bridge Hop";
    met.hidden = false;
  });
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// The items of #277 and every item they must keep clear of. An item that
// is not on the screen (hidden, display none, or visibility hidden) has no box.
function bannerBoxes(page) {
  return page.evaluate(() => {
    const sels = {
      banner: "#landmark-banner", goals: "#hud-goals", met: "#hud-met", goal: "#hud-goal",
      photo: "#photo-toggle", settings: "#settings-toggle", fullscreen: "#fullscreen-toggle",
      nia: '#skater-select button[data-skater="nia"]', marcus: '#skater-select button[data-skater="marcus"]', minimap: "#minimap", turn: "#turn-hint",
      stick: ".touch-stick-base", jump: ".touch-jump", grind: ".touch-grind", groove: ".touch-style1", spin: ".touch-style2", switch: ".touch-switch",
      score: "#hud-score", combo: "#hud-combo", pending: "#hud-pending", tag: "#hud-tag", hint: "#hud-hint", style: ".hud-style", balance: "#hud-balance",
    };
    const out = {};
    for (const [name, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel);
      if (!el || el.hidden) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out[name] = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    return { items: out, w: innerWidth, h: innerHeight };
  });
}

// The pairs that overlap, for each item in `mine` against every other item.
// `allowed` lists pairs that overlap by design.
function hitsOf(items, mine, allowed = []) {
  const hits = [];
  for (const name of mine) {
    const a = items[name];
    if (!a) continue;
    for (const [other, b] of Object.entries(items)) {
      if (other === name || (mine.includes(other) && other < name)) continue;
      if (allowed.some(([x, y]) => (x === name && y === other) || (x === other && y === name))) continue;
      if (overlaps(a, b)) hits.push(`${name} x ${other}`);
    }
  }
  return hits;
}

for (const size of SIZES) {
  test.describe(`phone layout, ${size.name}`, () => {
    test.use({ ...pixel, viewport: size.viewport });

    test("the hint names a tap, and no developer hint shows", async ({ page }) => {
      await ready(page);
      await expect(page.locator("#hud-hint")).toHaveText("Tap to start the beat");
      await expect(page.locator("#shell-info")).toBeHidden();
      await expect(page.locator(".dev-only")).toBeHidden();
    });

    test("no item overlaps another, and every item is on the screen", async ({ page }) => {
      await ready(page);
      const check = async () => {
        const { items, w, h } = await boxes(page);
        for (const a of items) {
          expect(a.x, `${a.name} left`).toBeGreaterThanOrEqual(0);
          expect(a.y, `${a.name} top`).toBeGreaterThanOrEqual(0);
          expect(a.x + a.w, `${a.name} right`).toBeLessThanOrEqual(w + 0.5);
          expect(a.y + a.h, `${a.name} bottom`).toBeLessThanOrEqual(h + 0.5);
        }
        const hits = [];
        for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) if (overlaps(items[i], items[j])) hits.push(`${items[i].name} x ${items[j].name}`);
        expect(hits).toEqual([]);
      };
      // Before the beat: the start hint shows.
      await expect(page.locator("#hud-hint")).toBeVisible();
      await check();
      // During play. A touch or a key starts the beat (src/main.js), and the
      // HUD hides the start hint while the beat runs (src/ui/hud.js). So a
      // combo, a move tag and the balance meter never show with the hint.
      await fillHud(page);
      await page.evaluate(() => (document.getElementById("hud-hint").style.display = "none"));
      await page.screenshot({ path: `e2e/__screenshots__/phone-layout-${size.name}.png` });
      await check();
    });

    test("HUD text is 14 px or larger with a contrast of 4.5:1 or more on any scene", async ({ page }) => {
      await ready(page);
      await fillHud(page);
      const rows = await page.evaluate(() => {
        const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
        const out = [];
        for (const el of document.querySelectorAll("#hud *")) {
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (!own) continue;
          const cs = getComputedStyle(el);
          // A faded item (the move tag after 0.9 s) is not on the screen.
          if (cs.display === "none" || Number(cs.opacity) === 0) continue;
          // The pill is on the element or on its parent (a meter label).
          let pill = cs.backgroundColor;
          if (parse(pill)[3] === 0 || pill === "rgba(0, 0, 0, 0)") pill = getComputedStyle(el.parentElement).backgroundColor;
          out.push({ text: el.textContent.trim().slice(0, 30), size: parseFloat(cs.fontSize), color: parse(cs.color), opacity: Number(cs.opacity), pill: parse(pill) });
        }
        return out;
      });
      expect(rows.length).toBeGreaterThan(3);
      for (const r of rows) {
        expect(r.size, `${r.text} font size`).toBeGreaterThanOrEqual(14);
        const pill = r.pill.length === 4 ? r.pill : [...r.pill, 1];
        // The worst scene behind the pill: pure white, and pure black.
        for (const scene of [[255, 255, 255], [0, 0, 0]]) {
          const bg = over(pill, scene);
          const fg = over([...r.color.slice(0, 3), r.opacity * (r.color[3] ?? 1)], bg);
          expect(contrast(fg, bg), `${r.text} on ${scene.join(",")}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  });
}

// #277: the landmark banner, the round goals (#hud-goals), the goal
// confirmation (#hud-met), the touch controls, PHOTO and SETTINGS do not
// overlap. The chips show the widest text they can have (a met goal). In
// portrait the banner draws over the SETTINGS, PHOTO and FULL SCREEN column
// by design: it takes no tap, and the buttons still work (e2e/landmarks.spec.js).
const WIDE_CHIPS = ["\u2713 Score 6K/6K", "\u2713 Combo 1K/1K", "Cards 0/3", "Gaps 0/2"];
// The longest combo line a phone shows (#269), from a search of the move
// names: "… Jam Step! + Bankhead Bounce! (12)".
const LONG_COMBO = comboLine(
  Array.from({ length: 12 }, (_, i) => ({ name: ["Jam Step", "Bankhead Bounce"][i % 2], onBeat: true })),
  COMBO_LINE.phone,
);
for (const size of SIZES) {
  test.describe(`phone banner, ${size.name}`, () => {
    test.use({ ...pixel, viewport: size.viewport });

    test("the landmark banner, the goals, the confirmation, the touch controls, PHOTO and SETTINGS do not overlap", async ({ page }) => {
      test.setTimeout(180000);
      await ready(page);
      // The spawn is in the find zone of a spot, so a Found banner shows.
      await expect(page.locator("#landmark-banner")).toBeVisible({ timeout: 30000 });
      await page.waitForFunction(() => window.__atl.landmarkFx.banner.opacity > 0.95, null, { timeout: 30000 });
      await fillHud(page);
      await page.evaluate(({ texts, combo }) => {
        document.querySelectorAll("#hud-goals .hud-goal-chip").forEach((c, i) => (c.textContent = texts[i] ?? c.textContent));
        document.getElementById("hud-combo").textContent = combo;
        // The HUD hides the start hint while the beat runs (see above).
        document.getElementById("hud-hint").style.display = "none";
      }, { texts: WIDE_CHIPS, combo: LONG_COMBO });
      const portrait = size.viewport.height > size.viewport.width;
      // In portrait, a full HUD column (a combo, the "+N", a move tag and the
      // landmark goal line) can reach the banner band. That is the column
      // height limit of #268, not a part of #277.
      const column = ["score", "combo", "pending", "tag", "hint", "goal", "style", "balance"];
      const allowed = portrait ? [["banner", "settings"], ["banner", "photo"], ["banner", "fullscreen"], ...column.map((c) => ["banner", c])] : [];
      const mine = ["banner", "goals", "met", "photo", "settings", "turn"];

      // With the banner on show.
      const shown = await bannerBoxes(page);
      await page.screenshot({ path: `e2e/__screenshots__/phone-banner-${size.name}.png` });
      for (const name of ["banner", "met", "photo", "settings"]) expect(shown.items[name], name).toBeTruthy();
      for (const [name, a] of Object.entries(shown.items)) {
        expect(a.x, `${name} left`).toBeGreaterThanOrEqual(0);
        expect(a.y, `${name} top`).toBeGreaterThanOrEqual(0);
        expect(a.x + a.w, `${name} right`).toBeLessThanOrEqual(shown.w + 0.5);
        expect(a.y + a.h, `${name} bottom`).toBeLessThanOrEqual(shown.h + 0.5);
      }
      // A short landscape phone has no room for the banner and the chips:
      // the chips step aside while the banner shows (#277).
      // On a short portrait phone the chips also step aside while the turn
      // hint shows (its first 8 s).
      if (size.name === "landscape-667" || (size.name === "portrait-360" && shown.items.turn)) expect(shown.items.goals, "goals step aside").toBeUndefined();
      else expect(shown.items.goals, "goals").toBeTruthy();
      expect(hitsOf(shown.items, mine, allowed)).toEqual([]);

      // With no banner and no turn hint: the chips are back, and clear.
      await page.evaluate(() => {
        document.getElementById("landmark-banner").hidden = true;
        const turn = document.getElementById("turn-hint");
        if (turn) turn.hidden = true;
      });
      const after = await bannerBoxes(page);
      expect(after.items.goals, "goals").toBeTruthy();
      expect(hitsOf(after.items, mine, allowed)).toEqual([]);
    });
  });
}

test.describe("phone landscape camera", () => {
  test.use({ ...pixel, viewport: { width: 844, height: 390 } });

  test("the skater fills at least 15% of the screen height", async ({ page }) => {
    await ready(page);
    expect(await page.evaluate(() => window.__atl.fov)).toBe(42);
    await page.waitForTimeout(1500); // the follow camera settles
    const h = await page.evaluate(() => window.__atl.skaterScreenHeight());
    expect(h).toBeGreaterThanOrEqual(0.15);
  });
});

test("a desktop keeps the full credit and the 60 degree view", async ({ page }) => {
  await ready(page);
  expect(await page.evaluate(() => window.__atl.fov)).toBe(60);
  await expect(page.locator("#attribution .attr-full")).toBeVisible();
  await expect(page.locator("#attribution .attr-short")).toBeHidden();
});

test("a tap on the short credit shows the full text", async ({ browser }) => {
  const ctx = await browser.newContext({ ...pixel, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await ready(page);
  await expect(page.locator("#attribution .attr-full")).toBeHidden();
  await page.locator("#attribution .attr-short").tap();
  await expect(page.locator("#attribution .attr-full")).toBeVisible();
  await ctx.close();
});
