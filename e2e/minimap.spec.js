import { expect, test, devices } from "@playwright/test";

// The minimap (#86): it draws on a geodata level, the keys and buttons
// change it, and on a phone it stays on the screen and off the touch
// controls and the HUD. Screenshots: desktop and phone.

const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars

async function ready(page, query = "") {
  await page.goto(`/?level=beltline-eastside&mute=1${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5 && window.__atl.minimap?.state.draws > 0, null, { timeout: 60000 });
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// The map pixel colors: the center (the skater arrow) and the count of
// pixels that are the trail pink.
function pixels(page) {
  return page.evaluate(() => {
    const c = document.querySelector("#minimap canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const at = (x, y) => [...d.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 3)];
    let pink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 220 && d[i + 1] < 130 && d[i + 2] > 140) pink += 1;
    return { center: at(Math.floor(c.width / 2), Math.floor(c.height / 2) - 2), pink, width: c.width };
  });
}

test("the desktop map shows the trail, the landmarks, and the skater arrow", async ({ page }) => {
  await ready(page);
  const box = await page.locator("#minimap").boundingBox();
  const vp = page.viewportSize();
  // The bottom right corner.
  expect(box.x + box.width).toBeGreaterThan(vp.width - 40);
  expect(box.y + box.height).toBeGreaterThan(vp.height - 40);
  await expect(page.locator("#minimap canvas")).toHaveAttribute("role", "img");
  await expect(page.locator("#minimap canvas")).toHaveAttribute("aria-label", /Map of .*north up.*Landmark spots: 0 of \d+ found/);
  const icons = await page.evaluate(() => window.__atl.minimap.icons.map((i) => i.id));
  expect(icons).toEqual(expect.arrayContaining(["ponce-city-market", "krog-street-market"]));
  const p = await pixels(page);
  // The spawn is on the trail: the trail shows, and the arrow is white.
  expect(p.pink).toBeGreaterThan(50);
  for (const ch of p.center) expect(ch).toBeGreaterThan(200);
  await page.screenshot({ path: "e2e/__screenshots__/minimap-desktop.png" });
  // Near Ponce City Market: the landmark icon and the footprints show.
  await page.evaluate(() => {
    const pcm = window.__atl.minimap.icons.find((i) => i.id === "ponce-city-market");
    window.__atl.resetSkater([pcm.x + 70, window.__atl.level.sample(pcm.x + 70, pcm.z)?.height ?? 0, pcm.z], 2.4);
  });
  await page.waitForTimeout(400);
  await page.locator("#minimap").screenshot({ path: "e2e/__screenshots__/minimap-desktop-close.png" });
});

test("N changes the mode, the × button hides and shows the map, and the choice stays after a reload", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("KeyN");
  expect(await page.evaluate(() => window.__atl.minimap.state.mode)).toBe("heading");
  await expect(page.locator("#minimap .minimap-mode")).toHaveAttribute("aria-pressed", "true");
  // M opens the full map now (e2e/fullmap.spec.js); the × button hides the minimap.
  await page.locator("#minimap .minimap-toggle").click();
  await expect(page.locator("#minimap canvas")).toBeHidden();
  await expect(page.locator("#minimap .minimap-toggle")).toHaveText("Map");
  await page.reload();
  await page.waitForFunction(() => window.__atl?.minimap, null, { timeout: 60000 });
  expect(await page.evaluate(() => window.__atl.minimap.state)).toMatchObject({ mode: "heading", hidden: true });
  await page.locator("#minimap .minimap-toggle").click();
  await expect(page.locator("#minimap canvas")).toBeVisible();
});

test("the map draws only when the skater moves or turns", async ({ page }) => {
  await ready(page, "&view=fixed");
  // The skater stands still at the spawn: no new draws.
  const a = await page.evaluate(() => window.__atl.minimap.state.draws);
  await page.waitForTimeout(500);
  const b = await page.evaluate(() => window.__atl.minimap.state.draws);
  expect(b - a).toBeLessThanOrEqual(1);
});

test("?minimap=0 leaves the map out", async ({ page }) => {
  await page.goto("/?level=beltline-eastside&mute=1&minimap=0");
  await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 5, null, { timeout: 60000 });
  await expect(page.locator("#minimap")).toHaveCount(0);
});

for (const size of [
  { name: "portrait", viewport: { width: 390, height: 844 } },
  { name: "landscape", viewport: { width: 844, height: 390 } },
]) {
  test.describe(`phone map, ${size.name}`, () => {
    test.use({ ...pixel, viewport: size.viewport });

    test("the map is on the screen and does not cover the touch controls or the HUD", async ({ page }) => {
      await ready(page);
      const r = await page.evaluate(() => {
        const box = (el) => {
          const b = el.getBoundingClientRect();
          return { x: b.left, y: b.top, w: b.width, h: b.height };
        };
        const others = {};
        for (const [name, sel] of [
          ["stick zone", ".touch-stick-zone"],
          ["jump", ".touch-jump"],
          ["grind", ".touch-grind"],
          ["groove", ".touch-style1"],
          ["spin", ".touch-style2"],
          ["switch", ".touch-switch"],
          ["hud", "#hud-score"],
          ["style", ".hud-style"],
          ["pulse", "#hud-pulse"],
          ["credit", "#attribution .attr-short"],
          ["skater select", "#skater-select"],
        ]) {
          const el = document.querySelector(sel);
          if (el && getComputedStyle(el).display !== "none") others[name] = box(el);
        }
        return { map: box(document.getElementById("minimap")), others, w: innerWidth, h: innerHeight };
      });
      expect(r.map.w).toBeGreaterThanOrEqual(72);
      expect(r.map.x).toBeGreaterThanOrEqual(0);
      expect(r.map.y).toBeGreaterThanOrEqual(0);
      expect(r.map.x + r.map.w).toBeLessThanOrEqual(r.w);
      expect(r.map.y + r.map.h).toBeLessThanOrEqual(r.h);
      expect(Object.keys(r.others)).toEqual(expect.arrayContaining(["stick zone", "jump", "skater select"]));
      const hits = Object.entries(r.others).filter(([, b]) => overlaps(r.map, b)).map(([n]) => n);
      expect(hits).toEqual([]);
      await page.screenshot({ path: `e2e/__screenshots__/minimap-phone-${size.name}.png` });
    });
  });
}
