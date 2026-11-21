import { expect, test } from "@playwright/test";

// The text callouts (#305): 3, 2, 1, SKATE!, SPOT CLAIMED, the combo name,
// ROUND OVER and the medal. Screenshots of each on the high tier (1280 x 720)
// and on a phone in portrait (390 x 844, touch), the reduced motion fade,
// and the real round start and round end.

const SHOTS = "e2e/__screenshots__";
const JPEG = 80;

const LAYOUTS = [
  { name: "high", query: "quality=high", context: { viewport: { width: 1280, height: 720 } } },
  { name: "phone-portrait", query: "quality=phone", context: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
];

// Each callout: how to start it, and the cards to photograph.
const CALLOUTS = [
  { name: "count-3", push: "start", text: "3" },
  { name: "skate", push: "start", text: "SKATE!" },
  { name: "spot-claimed", push: "claim", text: "SPOT CLAIMED", sub: "+200" },
  { name: "combo", push: "combo", text: "HUGE COMBO", sub: "x6  12,400" },
  { name: "round-over", push: "end", text: "ROUND OVER" },
  { name: "medal-gold", push: "end", text: "GOLD", sub: "9,850" },
];

// The items the callout must not cover.
const KEEP_CLEAR = ["#hud-score", "#hud-combo", "#hud-pending", "#hud-goal", "#minimap", ".touch-stick-base", ".touch-jump", ".touch-grind", ".touch-style1", ".touch-style2", ".touch-switch", "#landmark-banner"];

async function ready(page, query) {
  await page.goto(`/?level=beltline-eastside&mute=1&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 120000 });
}

function push(page, kind) {
  return page.evaluate((k) => {
    const c = window.__atl.callouts;
    if (k === "start") c.start();
    else if (k === "claim") c.claim(200);
    else if (k === "combo") c.combo(12400, 6, 6);
    else c.end({ medal: "gold", medalScore: 9850, score: 9650 });
  }, kind);
}

// Stops the callout clock on `text` when it holds still at full size, and waits for it.
async function holdOn(page, text) {
  await page.waitForFunction((t) => window.__atl.callouts.state.stopped && window.__atl.callouts.state.text === t, text, { timeout: 300000 });
  const l = await page.evaluate(() => window.__atl.callouts.state.look);
  expect(l).toEqual({ opacity: 1, scale: 1, scaleY: 1, x: 0, y: 0 });
}

function clearOf(page) {
  return page.evaluate((sels) => {
    const r = document.querySelector("#callout .co-card").getBoundingClientRect();
    const box = { x: r.x, y: r.y, w: r.width, h: r.height };
    const hits = [];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el || el.hidden || getComputedStyle(el).display === "none" || getComputedStyle(el).visibility === "hidden") continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (box.x < b.x + b.width && b.x < box.x + box.w && box.y < b.y + b.height && b.y < box.y + box.h) hits.push(sel);
    }
    return { box, hits, vw: innerWidth, vh: innerHeight };
  }, KEEP_CLEAR);
}

for (const layout of LAYOUTS) {
  test(`each callout on ${layout.name}: screenshot, in the screen, clear of the HUD and the controls`, async ({ browser }) => {
    // SwiftShader draws the high tier at about 0.3 fps in the cloud container.
    test.setTimeout(1800000);
    const context = await browser.newContext(layout.context);
    const page = await context.newPage();
    await ready(page, layout.query);
    for (const c of CALLOUTS) {
      await page.evaluate((t) => window.__atl.callouts.stopOn(t), c.text);
      // A new callout for each picture, except the medal: it follows ROUND OVER.
      if (c.name !== "skate" && c.name !== "medal-gold") await push(page, c.push);
      await holdOn(page, c.text);
      const s = await page.evaluate(() => window.__atl.callouts.state);
      expect(s.sub ?? undefined, c.name).toBe(c.sub);
      expect(s.motion).toBe("full");
      const room = await clearOf(page);
      expect(room.hits, `${c.name} covers`).toEqual([]);
      expect(room.box.x, c.name).toBeGreaterThanOrEqual(0);
      expect(room.box.y, c.name).toBeGreaterThanOrEqual(0);
      expect(room.box.x + room.box.w, c.name).toBeLessThanOrEqual(room.vw);
      expect(room.box.y + room.box.h, c.name).toBeLessThanOrEqual(room.vh);
      await page.screenshot({ path: `${SHOTS}/callout-${layout.name}-${c.name}.jpg`, type: "jpeg", quality: JPEG });
    }
    await context.close();
  });
}

test("with prefers-reduced-motion a callout only fades: no scale, no move", async ({ browser }) => {
  test.setTimeout(240000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await ready(page, "quality=low");
  const frames = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = [];
        // Small steps, so a slow test browser shows the fades.
        window.__atl.callouts.maxStep(0.05);
        window.__atl.callouts.claim(200);
        const t0 = performance.now();
        const tick = () => {
          const s = window.__atl.callouts.state;
          if (s.visible) out.push({ ...s.look, motion: s.motion });
          if (performance.now() - t0 < 90000 && (s.kind || out.length === 0)) requestAnimationFrame(tick);
          else resolve(out);
        };
        tick();
      }),
  );
  expect(frames.length).toBeGreaterThan(3);
  for (const f of frames) {
    expect(f.motion).toBe("reduced");
    expect([f.scale, f.scaleY, f.x, f.y]).toEqual([1, 1, 0, 0]);
  }
  // It fades: some frames are part way.
  expect(frames.some((f) => f.opacity > 0 && f.opacity < 1)).toBe(true);
  expect(frames.some((f) => f.opacity === 1)).toBe(true);
  await context.close();
});

test("the first key of a timed run plays the count-in; the round end plays ROUND OVER, the medal, then the results card", async ({ browser }) => {
  test.setTimeout(480000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await ready(page, "quality=low");
  expect(await page.evaluate(() => window.__atl.callouts.state.shown)).toBe(0);
  await page.keyboard.press("KeyX");
  await page.waitForFunction(() => window.__atl.callouts.state.seen.includes("SKATE!"), null, { timeout: 120000 });
  const seen = await page.evaluate(() => window.__atl.callouts.state.seen);
  expect(seen.slice(0, 4)).toEqual(["3", "2", "1", "SKATE!"]);
  // A second key does not start it again.
  await page.keyboard.press("KeyX");
  await page.waitForFunction(() => window.__atl.callouts.state.kind === null, null, { timeout: 120000 });
  expect(await page.evaluate(() => window.__atl.callouts.state.shown)).toBe(1);

  await page.evaluate(() => window.__atl.goals.setTimeLeft(0));
  await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 60000 });
  const during = await page.evaluate(() => ({ state: window.__atl.callouts.state, card: getComputedStyle(document.querySelector(".results-card")).opacity, medal: window.__atl.goals.results.medal }));
  expect(during.state.kind).toBe("end");
  expect(during.card).toBe("0");
  await page.waitForFunction(() => window.__atl.callouts.state.kind === null, null, { timeout: 120000 });
  const seenEnd = await page.evaluate(() => window.__atl.callouts.state.seen);
  expect(seenEnd).toContain("ROUND OVER");
  if (during.medal) expect(seenEnd).toContain(during.medal.toUpperCase());
  // The results card fades in after the callout.
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".results-card")).opacity === "1", null, { timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/callout-high-results-after.jpg`, type: "jpeg", quality: 80 });

  // Replay: the count-in plays again.
  await page.evaluate(() => window.__atl.goals.replay());
  await page.waitForFunction(() => window.__atl.callouts.state.seen.filter((t) => t === "SKATE!").length === 2, null, { timeout: 120000 });
  await context.close();
});

test("?callouts=0 turns the callouts off", async ({ page }) => {
  await ready(page, "callouts=0");
  expect(await page.evaluate(() => window.__atl.callouts)).toBeNull();
  expect(await page.locator("#callout").count()).toBe(0);
});
