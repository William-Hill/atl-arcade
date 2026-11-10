import { expect, test, devices } from "@playwright/test";
import { contrast, over } from "../src/ui/layout.js";

// The phone layout (#73): touch hints, no overlaps, HUD text size and
// contrast, and the skater size in landscape. Chromium with phone
// descriptors; WebKit is not installed.

const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars

const SIZES = [
  { name: "portrait", viewport: { width: 390, height: 844 } },
  { name: "landscape", viewport: { width: 844, height: 390 } },
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
// and the balance meter. The render loop pauses first, so the HUD update
// does not clear the text.
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
  });
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
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
      await fillHud(page);
      const { items, w, h } = await boxes(page);
      await page.screenshot({ path: `e2e/__screenshots__/phone-layout-${size.name}.png` });
      for (const a of items) {
        expect(a.x, `${a.name} left`).toBeGreaterThanOrEqual(0);
        expect(a.y, `${a.name} top`).toBeGreaterThanOrEqual(0);
        expect(a.x + a.w, `${a.name} right`).toBeLessThanOrEqual(w + 0.5);
        expect(a.y + a.h, `${a.name} bottom`).toBeLessThanOrEqual(h + 0.5);
      }
      const hits = [];
      for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) if (overlaps(items[i], items[j])) hits.push(`${items[i].name} x ${items[j].name}`);
      expect(hits).toEqual([]);
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
