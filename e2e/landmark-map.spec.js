import { readFileSync } from "node:fs";
import { expect, test, devices } from "@playwright/test";

// The landmark spots on the maps (#218, design/gdd/landmark-discovery.md
// M-1, M-2, M-3, the map part of AC-1, the icon pulse of R-1): the 4 icon
// states on the minimap and the full map, in the toon look and the pbr look,
// on a desktop and a phone; the panel of each state by click, tap and
// keyboard; the Guide tab with its 2 counts.
//
// The spot states are set through the dev test hook (window.__atl.landmarks,
// src/sim/landmarks.js landmarkTestHook). The game steps the tracker since
// #219, and the spawn is in the find zone of the Freedom Parkway bridge, so
// ready() first moves the skater to a place with no find zone near and sets
// every spot Unknown again. The places of moveSkater() are in no find zone.

const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars
const PHONE = { ...pixel, viewport: { width: 390, height: 844 } };
const FILE = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/landmarks.json", import.meta.url), "utf8"));
const SPOTS = FILE.spots.length;
const CLAIM_SPOTS = FILE.spots.filter((s) => s.kind !== "edge").length;
const SHOTS = "e2e/__screenshots__";

// One spot in each state near Ponce City Market (the minimap shows 240 m),
// and one in each state near the Carter library for the full map.
const UNKNOWN = "ponce-de-leon-bridge";
const FOUND = "ponce-city-market";
const CLAIMED = "ford-factory-lofts";
const EDGE = "jimmy-carter-library";
const EAST = { unknown: "freedom-parkway-bridge", found: "ralph-mcgill-bridge", claimed: "telephone-factory-lofts", edge: EDGE };

async function ready(page, query = "") {
  await page.goto(`/?level=beltline-eastside&mute=1${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5 && window.__atl.fullmap && window.__atl.minimap?.state.draws > 0 && window.__atl.landmarks, null, { timeout: 120000 });
  await page.evaluate(() => {
    const [x, z] = [150, 600];
    window.__atl.resetSkater([x, window.__atl.level.sample(x, z)?.height ?? 0, z], 1.5);
    window.__atl.landmarks.reset();
  });
  // A few frames, and still no spot found.
  const frames = await page.evaluate(() => window.__atl.frames);
  await page.waitForFunction((f) => window.__atl.frames > f + 3, frames);
  expect(Object.values(await page.evaluate(() => window.__atl.landmarks.states())).every((st) => st === "unknown")).toBe(true);
}

async function setStates(page) {
  await page.evaluate(
    ({ FOUND, CLAIMED, EDGE, EAST }) => {
      const L = window.__atl.landmarks;
      L.find(FOUND);
      L.claim(CLAIMED);
      L.find(EDGE);
      L.find(EAST.found);
      L.claim(EAST.claimed);
    },
    { FOUND, CLAIMED, EDGE, EAST },
  );
}

async function moveSkater(page, x, z) {
  await page.evaluate(([x, z]) => window.__atl.resetSkater([x, window.__atl.level.sample(x, z)?.height ?? 0, z], 1.5), [x, z]);
  await page.waitForTimeout(500);
}

const FILL = { unknown: [0x6f, 0x74, 0x88], found: [255, 255, 255], claimed: [0xff, 0xd1, 0x66], edge: [255, 255, 255] };

// The icon of a spot on a map ("minimap" or "fullmap") with 2 canvas colors,
// read in the same frame as the icon position (the skater can still roll):
// `fill` is up and left of the center, where no mark is; `corner` is a point
// outside a circle of the icon size but on the outline of a square of it.
function probe(page, map, id) {
  return page.evaluate(
    ([map, id]) => {
      const icon = window.__atl[map].iconsOnScreen().find((i) => i.id === id);
      if (!icon) return null;
      const c = document.querySelector(map === "minimap" ? "#minimap canvas" : "#fullmap .fullmap-canvas");
      const r = c.getBoundingClientRect();
      // The picture starts inside the border of the canvas.
      const k = c.width / c.clientWidth;
      const at = (x, y) => [...c.getContext("2d").getImageData(Math.round((x - r.left - c.clientLeft) * k), Math.round((y - r.top - c.clientTop) * k), 1, 1).data.slice(0, 3)];
      return { ...icon, fill: at(icon.x - icon.size * 0.26, icon.y - icon.size * 0.26), corner: at(icon.x - icon.size * 0.44, icon.y + icon.size * 0.44) };
    },
    [map, id],
  );
}

// The icon has the fill of its look, and the edge marker has the ink outline
// of a square at its corner (a circle of the same size does not reach it).
async function expectIcon(page, map, id, look) {
  const icon = await probe(page, map, id);
  expect(icon, id).toMatchObject({ look });
  const want = FILL[look];
  for (let i = 0; i < 3; i += 1) expect(Math.abs(icon.fill[i] - want[i]), `${id} (${look}) fill ${icon.fill} on the ${map}`).toBeLessThanOrEqual(40);
  if (look === "edge") for (const ch of icon.corner) expect(ch, `${id} corner ${icon.corner} on the ${map}`).toBeLessThan(45);
  return icon;
}

for (const look of ["toon", "pbr"]) {
  for (const [sizeName, use] of [
    ["desktop", {}],
    ["phone", PHONE],
  ]) {
    test.describe(`${look} look, ${sizeName}`, () => {
      test.use(use);

      test("the 4 icon states show on the minimap and the full map", async ({ page }) => {
        test.setTimeout(480000);
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await ready(page, `&look=${look}`);
        expect(await page.evaluate(() => window.__atl.look)).toBe(look);
        const name = `landmark-map-${look}-${sizeName}`;

        // Every spot starts Unknown: a "?" and no name, on both maps.
        const ids = FILE.spots.map((s) => s.id);
        const mini0 = await page.evaluate(() => window.__atl.minimap.icons.filter((i) => i.spot));
        expect(mini0.map((i) => i.id)).toEqual(ids);
        expect(mini0.every((i) => i.look === "unknown" && i.name === null)).toBe(true);
        await expect(page.locator("#minimap canvas")).toHaveAttribute("aria-label", new RegExp(`Landmark spots: 0 of ${SPOTS} found, 0 of ${CLAIM_SPOTS} claimed\\.`));
        expect(await page.locator("#minimap canvas").getAttribute("aria-label")).not.toContain("Found:");

        await setStates(page);

        // The minimap near Ponce City Market: Unknown, Found and Claimed.
        await moveSkater(page, -150, -925);
        const iconPx = await page.evaluate(() => window.__atl.minimap.state.iconPx);
        expect(iconPx).toBeGreaterThanOrEqual(14);
        for (const [id, lookName] of [
          [UNKNOWN, "unknown"],
          [FOUND, "found"],
          [CLAIMED, "claimed"],
        ]) {
          const icon = await expectIcon(page, "minimap", id, lookName);
          expect(icon.shown, id).toBe(true);
          expect(icon.size).toBeGreaterThanOrEqual(14);
        }
        await page.locator("#minimap").screenshot({ path: `${SHOTS}/${name}-minimap.png` });
        // The minimap near the Carter library: the edge marker, Found.
        await moveSkater(page, 425, -150);
        const edgeMini = await expectIcon(page, "minimap", EDGE, "edge");
        expect(edgeMini.shown).toBe(true);
        expect(edgeMini.size).toBeGreaterThanOrEqual(14);
        await page.locator("#minimap").screenshot({ path: `${SHOTS}/${name}-minimap-edge.png` });
        await page.screenshot({ path: `${SHOTS}/${name}-game.jpg`, type: "jpeg", quality: 80 });

        // The full map lists the same ids as the minimap (AC-1).
        await page.locator("#minimap .minimap-expand").click();
        await expect(page.locator("#fullmap")).toBeVisible();
        await page.waitForFunction(() => window.__atl.fullmap.state.draws > 0);
        const full = await page.evaluate(() => ({ ids: window.__atl.fullmap.iconsOnScreen().map((i) => i.id), mini: window.__atl.minimap.icons.filter((i) => i.spot).map((i) => i.id), px: window.__atl.fullmap.state.iconPx }));
        expect(full.ids).toEqual(ids);
        expect(full.mini).toEqual(ids);
        expect(full.px).toBe(24);
        await page.waitForTimeout(1500); // the tiles of the 3D layer
        await page.screenshot({ path: `${SHOTS}/${name}-fullmap-3d.jpg`, type: "jpeg", quality: 85 });

        // The plan layer, near the Carter library: one spot in each state.
        const vp = page.viewportSize();
        await page.evaluate((zoom) => {
          window.__atl.fullmap.setLayer("plan");
          window.__atl.fullmap.setView({ x: 350, z: -170, zoom });
        }, vp.width < 600 ? 0.75 : 1.1);
        await page.waitForTimeout(300);
        for (const [lookName, id] of Object.entries(EAST)) {
          const icon = await expectIcon(page, "fullmap", id, lookName);
          expect(icon.size).toBe(24);
          expect(icon.x).toBeGreaterThan(12);
          expect(icon.x).toBeLessThan(vp.width - 12);
        }
        await page.screenshot({ path: `${SHOTS}/${name}-fullmap.png` });

        // The Guide tab: the 2 counts from the file, and the spots by kind.
        await page.locator("#fullmap-tab-guide").click();
        await expect(page.locator("#fullmap-guide")).toBeVisible();
        await expect(page.locator(".fullmap-guide-claimed")).toHaveText(`2 of ${CLAIM_SPOTS} claimed`);
        await expect(page.locator(".fullmap-guide-found")).toHaveText(`5 of ${SPOTS} found`);
        await expect(page.locator(".fullmap-guide-row")).toHaveCount(SPOTS);
        await page.screenshot({ path: `${SHOTS}/${name}-guide.png` });
        expect(errors).toEqual([]);
      });
    });
  }
}

const cardText = (page) => page.locator("#fullmap .fullmap-card").innerText();

// What the panel of each state shows.
async function expectPanel(page, lookName, id) {
  const card = page.locator("#fullmap .fullmap-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-spot", id);
  await expect(card).toHaveAttribute("data-look", lookName);
  const spot = FILE.spots.find((s) => s.id === id);
  const text = await cardText(page);
  if (lookName === "unknown") {
    await expect(card.locator(".fullmap-card-title")).toHaveText("?");
    expect(text).toContain("Not found yet");
    // No name, no short line and no fact, anywhere in the panel.
    expect(text).not.toContain(spot.name);
    expect(text).not.toContain(spot.short);
    await expect(card.locator(".fullmap-card-facts")).toHaveCount(0);
  } else if (lookName === "found") {
    await expect(card.locator(".fullmap-card-title")).toHaveText(spot.name);
    expect(text).toContain(spot.short);
    expect(text).toContain("Claim it to unlock");
    await expect(card.locator(".fullmap-card-facts")).toHaveCount(0);
    expect(text).not.toContain(spot.card[1].text);
  } else {
    await expect(card.locator(".fullmap-card-title")).toHaveText(spot.name);
    await expect(card.locator(".fullmap-card-facts li")).toHaveCount(spot.card.length);
    for (const fact of spot.card) expect(text).toContain(fact.text);
    expect(text).not.toContain("Claim it to unlock");
    // Each source is an https link of the file, opened in a new tab.
    const links = await card.locator(".fullmap-card-source a").evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href"), rel: a.rel, target: a.target, text: a.textContent })));
    expect(links).toEqual(spot.card.map((f) => ({ href: f.source.url, rel: "noopener noreferrer", target: "_blank", text: f.source.name })));
    for (const l of links) expect(l.href.startsWith("https://")).toBe(true);
  }
}

const STATES = [
  ["unknown", EAST.unknown],
  ["found", EAST.found],
  ["claimed", EAST.claimed],
  ["edge", EAST.edge],
];

async function openPlanMap(page, zoom) {
  await page.evaluate((zoom) => {
    window.__atl.fullmap.open();
    window.__atl.fullmap.setLayer("plan");
    window.__atl.fullmap.setView({ x: 350, z: -170, zoom });
  }, zoom);
  await page.waitForFunction(() => window.__atl.fullmap.state.draws > 0);
}

const iconOf = (page, id) => page.evaluate((id) => window.__atl.fullmap.iconsOnScreen().find((i) => i.id === id), id);

test("a click opens the panel of each state; Escape, the close button and a click outside close it", async ({ page }) => {
  test.setTimeout(180000);
  await ready(page);
  await setStates(page);
  await moveSkater(page, 425, -150);
  await openPlanMap(page, 1.1);
  const card = page.locator("#fullmap .fullmap-card");
  for (const [lookName, id] of STATES) {
    const icon = await iconOf(page, id);
    await page.mouse.click(icon.x, icon.y);
    await expectPanel(page, lookName, id);
    await page.screenshot({ path: `${SHOTS}/landmark-panel-${lookName}-desktop.png` });
    // "Travel here" stays, in the panel.
    await expect(card.locator(".fullmap-travel")).toBeVisible();
    // Escape closes the panel and the map stays open.
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(page.locator("#fullmap")).toBeVisible();
    // The close button.
    await page.mouse.click(icon.x, icon.y);
    await expect(card).toBeVisible();
    await card.locator(".fullmap-card-close").click();
    await expect(card).toBeHidden();
    // A click outside: on the map, away from every icon.
    await page.mouse.click(icon.x, icon.y);
    await expect(card).toBeVisible();
    await page.mouse.click(640, 150);
    await expect(card).toBeHidden();
    expect(await page.evaluate(() => window.__atl.fullmap.state.card)).toBeNull();
    // A click outside: on a button of the map (zoom in).
    await page.mouse.click(icon.x, icon.y);
    await expect(card).toBeVisible();
    await page.locator("#fullmap .fullmap-zoom-in").click();
    await expect(card).toBeHidden();
    await page.locator("#fullmap .fullmap-zoom-out").click();
  }
  // With no panel, Escape closes the map.
  await page.keyboard.press("Escape");
  await expect(page.locator("#fullmap")).toBeHidden();
});

test("the keyboard opens the Guide tab and the panel of each state", async ({ page }) => {
  test.setTimeout(300000);
  await ready(page);
  await setStates(page);
  await page.keyboard.press("KeyM");
  await expect(page.locator("#fullmap")).toBeVisible();
  // G opens the Guide tab.
  await page.keyboard.press("KeyG");
  await expect(page.locator("#fullmap-guide")).toBeVisible();
  await expect(page.locator("#fullmap-tab-guide")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#fullmap-tab-guide")).toBeFocused();
  // The groups, in the kind order, for the kinds of the file.
  await expect(page.locator(".fullmap-guide-kind")).toHaveText(["Buildings", "Bridges", "Parks", "Skate spots", "Past the map edge"]);
  await expect(page.locator(".fullmap-guide-claimed")).toHaveText(`2 of ${CLAIM_SPOTS} claimed`);
  await expect(page.locator(".fullmap-guide-found")).toHaveText(`5 of ${SPOTS} found`);
  expect(CLAIM_SPOTS).toBe(13);
  expect(SPOTS).toBe(15);
  // An Unknown row has no name.
  const guideText = await page.locator("#fullmap-guide").innerText();
  for (const s of FILE.spots) {
    if ([FOUND, CLAIMED, EDGE, EAST.found, EAST.claimed].includes(s.id)) expect(guideText).toContain(s.name);
    else expect(guideText).not.toContain(s.name);
  }
  const card = page.locator("#fullmap .fullmap-card");
  // In the order of the list, so Tab goes forward from one row to the next.
  const order = FILE.spots.map((s) => s.id);
  for (const [lookName, id] of [...STATES].sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]))) {
    // Tab to the row of the spot, then Enter or Space.
    const row = page.locator(`.fullmap-guide-row[data-spot="${id}"]`);
    for (let i = 0; i < 30 && !(await row.evaluate((r) => r === document.activeElement)); i += 1) await page.keyboard.press("Tab");
    await expect(row).toBeFocused();
    await page.keyboard.press(lookName === "found" ? "Space" : "Enter");
    await expectPanel(page, lookName, id);
    // The focus is in the panel; Escape closes it and gives the focus back.
    await expect(card.locator(".fullmap-card-close")).toBeFocused();
    if (lookName === "claimed") await page.screenshot({ path: `${SHOTS}/landmark-guide-panel-desktop.png` });
    if (lookName === "edge") {
      // Enter on the close button closes it too.
      await page.keyboard.press("Enter");
    } else await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(page.locator("#fullmap")).toBeVisible();
    await expect(row).toBeFocused();
  }
  // G closes the Guide tab; the map tab is selected again.
  await page.keyboard.press("KeyG");
  await expect(page.locator("#fullmap-guide")).toBeHidden();
  await expect(page.locator("#fullmap-tab-map")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#fullmap")).toBeHidden();
});

test.describe("phone", () => {
  test.use(PHONE);

  test("a tap opens the panel of each state; the close button and a tap outside close it", async ({ page }) => {
    test.setTimeout(180000);
    await ready(page);
    await setStates(page);
    await moveSkater(page, 425, -150);
    await page.locator("#minimap .minimap-expand").tap();
    await expect(page.locator("#fullmap")).toBeVisible();
    await openPlanMap(page, 0.75);
    const card = page.locator("#fullmap .fullmap-card");
    const vp = page.viewportSize();
    for (const [lookName, id] of STATES) {
      const icon = await iconOf(page, id);
      await page.touchscreen.tap(icon.x, icon.y);
      await expectPanel(page, lookName, id);
      // The panel stays on the screen.
      const box = await card.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
      await page.screenshot({ path: `${SHOTS}/landmark-panel-${lookName}-phone.png` });
      const close = await card.locator(".fullmap-card-close").boundingBox();
      expect(close.width).toBeGreaterThanOrEqual(44);
      await card.locator(".fullmap-card-close").tap();
      await expect(card).toBeHidden();
      await page.touchscreen.tap(icon.x, icon.y);
      await expect(card).toBeVisible();
      // A tap outside: on the map above the panel, away from the icons.
      await page.touchscreen.tap(60, 120);
      await expect(card).toBeHidden();
      await expect(page.locator("#fullmap")).toBeVisible();
    }
    // The Guide tab by touch: a row opens its panel over the list.
    await page.locator("#fullmap-tab-guide").tap();
    await expect(page.locator("#fullmap-guide")).toBeVisible();
    const row = page.locator(`.fullmap-guide-row[data-spot="${EAST.claimed}"]`);
    const rowBox = await row.boundingBox();
    expect(rowBox.height).toBeGreaterThanOrEqual(44);
    await row.tap();
    await expectPanel(page, "claimed", EAST.claimed);
    await page.screenshot({ path: `${SHOTS}/landmark-guide-panel-phone.png` });
    await page.locator("#fullmap-tab-map").tap();
    await expect(card).toBeHidden();
    await expect(page.locator("#fullmap-guide")).toBeHidden();
  });
});

test("a free run: a Found spot reads 'Start a timed run to claim it', and an edge marker keeps its facts", async ({ page }) => {
  await ready(page, "&run=free");
  await setStates(page);
  await page.evaluate(() => window.__atl.fullmap.open());
  await page.evaluate((id) => window.__atl.fullmap.openSpot(id), EAST.found);
  const card = page.locator("#fullmap .fullmap-card");
  await expect(card).toBeVisible();
  const text = await cardText(page);
  expect(text).toContain("Start a timed run to claim it");
  expect(text).not.toContain("Claim it to unlock");
  await page.evaluate((id) => window.__atl.fullmap.openSpot(id), EDGE);
  await expectPanel(page, "edge", EDGE);
});

test("?travel=found: travel goes only to a Found or Claimed spot (#271)", async ({ page }) => {
  test.setTimeout(180000);
  await ready(page, "&travel=found");
  await setStates(page);
  await page.evaluate(() => window.__atl.fullmap.open());
  await expect(page.locator("#fullmap .fullmap-hint")).toContainText("click a found spot, then T: travel");
  const card = page.locator("#fullmap .fullmap-card");
  // An Unknown spot: the panel has no "Travel here", and T does nothing.
  await page.evaluate((id) => window.__atl.fullmap.openSpot(id), EAST.unknown);
  await expect(card).toBeVisible();
  await expect(card.locator(".fullmap-travel")).toBeHidden();
  await page.keyboard.press("KeyT");
  await expect(page.locator("#fullmap")).toBeVisible();
  // A place on the map: no target.
  await page.evaluate(() => window.__atl.fullmap.select(null, { x: 300, z: -100 }));
  expect(await page.evaluate(() => window.__atl.fullmap.state.target)).toBe(null);
  // A Found spot: "Travel here" shows, and T moves the skater there.
  await page.evaluate((id) => window.__atl.fullmap.openSpot(id), EAST.found);
  await expect(card.locator(".fullmap-travel")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/fullmap-travel-found.png` });
  const at = FILE.spots.find((s) => s.id === EAST.found).at;
  await page.keyboard.press("KeyT");
  await expect(page.locator("#fullmap")).toBeHidden();
  await expect
    .poll(async () => {
      const p = await page.evaluate(() => window.__atl.skater.position);
      return Math.hypot(p[0] - at[0], p[2] - at[1]);
    })
    .toBeLessThan(60);
});

test("a newly claimed icon pulses once on the minimap and the full map", async ({ page }) => {
  await ready(page);
  await setStates(page);
  await moveSkater(page, -150, -925);
  const before = await page.evaluate(() => window.__atl.minimap.state.pulses);
  await page.evaluate((id) => window.__atl.landmarks.claim(id), FOUND);
  await page.waitForFunction((n) => window.__atl.minimap.state.pulses === n + 1, before);
  // The minimap draws while the pulse runs, with the skater at rest.
  const d0 = await page.evaluate(() => window.__atl.minimap.state.draws);
  await page.waitForFunction((n) => window.__atl.minimap.state.draws > n, d0, { timeout: 5000 });
  // The full map pulses the spot when it opens the next time.
  await page.keyboard.press("KeyM");
  await page.waitForFunction(() => window.__atl.fullmap.state.pulses >= 1);
  // One pulse only: it ends, and no new one starts.
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__atl.minimap.state.pulses)).toBe(before + 1);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("a newly claimed icon does not pulse (R-1)", async ({ page }) => {
    await ready(page);
    await moveSkater(page, -150, -925);
    await page.evaluate((id) => window.__atl.landmarks.find(id), FOUND);
    await page.waitForTimeout(200);
    await page.evaluate((id) => window.__atl.landmarks.claim(id), FOUND);
    await page.waitForFunction((id) => window.__atl.minimap.iconsOnScreen().find((i) => i.id === id)?.look === "claimed", FOUND);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__atl.minimap.state.pulses)).toBe(0);
    await page.keyboard.press("KeyM");
    await page.waitForFunction(() => window.__atl.fullmap.state.draws > 1);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__atl.fullmap.state.pulses)).toBe(0);
  });
});

// M-3 is a manual check: a person must look at these pictures and judge
// that shape and mark tell the 4 states apart with no color.
test("grayscale screenshots of the 4 states, for the M-3 review", async ({ page }) => {
  test.setTimeout(180000);
  await ready(page);
  await setStates(page);
  await page.addStyleTag({ content: "html { filter: grayscale(1); }" });
  await moveSkater(page, -150, -925);
  await page.locator("#minimap").screenshot({ path: `${SHOTS}/landmark-map-grayscale-minimap.png` });
  await moveSkater(page, 425, -150);
  await page.locator("#minimap").screenshot({ path: `${SHOTS}/landmark-map-grayscale-minimap-edge.png` });
  await openPlanMap(page, 1.1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/landmark-map-grayscale.png` });
  await page.evaluate(() => window.__atl.fullmap.setLayer("iso"));
  await page.evaluate(() => window.__atl.fullmap.setTab("guide"));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/landmark-map-grayscale-guide.png` });
});
