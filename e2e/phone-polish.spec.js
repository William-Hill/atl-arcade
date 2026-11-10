import { expect, test, devices } from "@playwright/test";
import { contrast, over } from "../src/ui/layout.js";

// #97: phone polish. MOB-9 the fullscreen button and the "turn your phone"
// hint, MOB-11 the reduced-motion option, MOB-12 the style ready cue with
// no color, MOB-13 the skater switch with no reload. Chromium with phone
// descriptors; WebKit is not installed, so the iPhone profiles run in
// Chromium. A test removes the Fullscreen API to act as iPhone Safari.

function profile(name) {
  const { defaultBrowserType, ...rest } = devices[name]; // eslint-disable-line no-unused-vars
  return rest;
}

const PROFILES = [
  { name: "iPhone 15", file: "iphone15-portrait", portrait: true },
  { name: "iPhone 15 landscape", file: "iphone15-landscape", portrait: false },
  { name: "Pixel 7", file: "pixel7", portrait: true },
];

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

// The game runs (the load screen is gone); the skater may still load.
async function firstFrames(page, query = "") {
  await page.goto(`/?level=beltline-eastside&mute=1&landmarks=0${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 90000 });
}

async function ready(page, query = "") {
  await page.goto(`/?level=beltline-eastside&mute=1&landmarks=0${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5 && window.__atl.skaterModel.loaded, null, { timeout: 90000 });
}

// The boxes of the items a player reads or touches.
function boxes(page) {
  return page.evaluate(() => {
    const sels = {
      score: "#hud-score", timer: "#hud-timer", hint: "#hud-hint", style: ".hud-style", pulse: "#hud-pulse",
      credit: "#attribution .attr-short", nia: '#skater-select button[data-skater="nia"]', marcus: '#skater-select button[data-skater="marcus"]',
      minimap: "#minimap", stick: ".touch-stick-base", jump: ".touch-jump", grind: ".touch-grind", groove: ".touch-style1", spin: ".touch-style2",
      settings: "#settings-toggle", fullscreen: "#fullscreen-toggle", turn: "#turn-hint",
    };
    const out = {};
    for (const [name, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out[name] = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    return { items: out, w: innerWidth, h: innerHeight };
  });
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// The text color and the pill of an element, as the browser computes them.
function colors(page, sel) {
  return page.evaluate((s) => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const el = document.querySelector(s);
    const cs = getComputedStyle(el);
    // The pill is on the element or on the first ancestor with a background.
    let node = el;
    let pill = parse(cs.backgroundColor);
    while (node && (pill.length === 0 || pill[3] === 0)) {
      node = node.parentElement;
      pill = node ? parse(getComputedStyle(node).backgroundColor) : [0, 0, 0];
    }
    return { color: parse(cs.color), pill, size: parseFloat(cs.fontSize) };
  }, sel);
}

function expectContrast({ color, pill }, label) {
  const p = pill.length === 4 ? pill : [...pill, 1];
  for (const scene of [[255, 255, 255], [0, 0, 0]]) {
    const bg = over(p, scene);
    const fg = over([...color.slice(0, 3), color[3] ?? 1], bg);
    expect(contrast(fg, bg), `${label} on ${scene.join(",")}`).toBeGreaterThanOrEqual(4.5);
  }
}

for (const p of PROFILES) {
  test.describe(`phone polish on ${p.name}`, () => {
    test.use(profile(p.name));

    test("MOB-9: the fullscreen button works, and the turn hint shows in portrait only", async ({ page }) => {
      test.setTimeout(180000);
      const errors = collectErrors(page);
      await firstFrames(page);
      const button = page.locator("#fullscreen-toggle");
      await expect(button).toBeVisible();
      await expect(button).toHaveText("FULL SCREEN");
      const hint = page.locator("#turn-hint");
      if (p.portrait) await expect(hint).toBeVisible();
      else await expect(hint).toBeHidden();

      // Targets of 44 px, text of 4.5:1 on any scene, and no overlap. The
      // hint goes after 8 s, so it is measured first.
      const { items, w, h } = await boxes(page);
      const okBox = p.portrait ? await page.locator("#turn-hint button").boundingBox() : null;
      await page.screenshot({ path: `e2e/__screenshots__/phone-polish-${p.file}.png` });
      const mine = ["fullscreen", ...(p.portrait ? ["turn"] : [])];
      for (const name of mine) {
        const a = items[name];
        expect(a, name).toBeTruthy();
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.x + a.w).toBeLessThanOrEqual(w + 0.5);
        expect(a.y + a.h).toBeLessThanOrEqual(h + 0.5);
        for (const [other, b] of Object.entries(items)) if (other !== name && !mine.includes(other)) expect(overlaps(a, b), `${name} x ${other}`).toBe(false);
      }
      expect(Math.min(items.fullscreen.w, items.fullscreen.h)).toBeGreaterThanOrEqual(44);
      // The skater select, PHOTO and SETTINGS do not touch each other (#97).
      const photo = await page.locator("#photo-toggle").boundingBox();
      const tops = { photo: { x: photo.x, y: photo.y, w: photo.width, h: photo.height }, settings: items.settings, nia: items.nia, marcus: items.marcus };
      for (const [a, ra] of Object.entries(tops)) for (const [b, rb] of Object.entries(tops)) if (a < b) expect(overlaps(ra, rb), `${a} x ${b}`).toBe(false);
      if (p.portrait) expect(photo.height).toBeGreaterThanOrEqual(44);
      expectContrast(await colors(page, "#fullscreen-toggle"), "fullscreen button");
      if (p.portrait) {
        expect(Math.min(okBox.width, okBox.height)).toBeGreaterThanOrEqual(44);
        expectContrast(await colors(page, "#turn-hint"), "turn hint");
        expectContrast(await colors(page, "#turn-hint button"), "turn hint button");
        // The hint goes after 8 s; a turn back to portrait shows it again,
        // and OK closes it.
        await expect(hint).toBeHidden({ timeout: 15000 });
        const vp = page.viewportSize();
        await page.setViewportSize({ width: vp.height, height: vp.width });
        await expect(hint).toBeHidden();
        await page.setViewportSize(vp);
        await expect(hint).toBeVisible();
        await page.evaluate(() => (window.__atl.renderPaused = true));
        await page.screenshot({ path: `e2e/__screenshots__/phone-polish-turn-hint-${p.file}.png` });
        await page.evaluate(() => (window.__atl.renderPaused = false));
        await expect(hint).toBeVisible();
        await page.locator("#turn-hint button").tap();
        await expect(hint).toBeHidden();
      }

      // A tap goes fullscreen, and a second tap goes back.
      await button.tap();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
      await expect(button).toHaveText("EXIT FULL");
      await button.tap();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
      await expect(button).toHaveText("FULL SCREEN");
      expect(errors, errors.join(" | ")).toEqual([]);
    });

    test("MOB-12: the style ready cue has a text and a shape, so it reads with no color", async ({ page }) => {
      test.setTimeout(180000);
      await ready(page);
      const meter = page.locator(".hud-style");
      await expect(page.locator("#hud-style-label")).toHaveText("STYLE");
      // Fill the style meter: the run keeps the combo while the skater is idle.
      await page.evaluate(() => {
        const c = window.__atl.run.combo;
        c.style = 1;
        c.signatureReady = true;
      });
      await expect(meter).toHaveAttribute("data-ready", "1");
      await expect(page.locator("#hud-style-label")).toHaveText("★ READY");
      const fill = await page.evaluate(() => getComputedStyle(document.getElementById("hud-style-fill")).backgroundImage);
      expect(fill).toContain("repeating-linear-gradient");
      expectContrast(await colors(page, "#hud-style-label"), "ready label");
      expect((await colors(page, "#hud-style-label")).size).toBeGreaterThanOrEqual(14);
      // With no color vision: a gray screen still shows the text and the stripes.
      await page.evaluate(() => (document.documentElement.style.filter = "grayscale(1)"));
      await page.screenshot({ path: `e2e/__screenshots__/phone-polish-style-ready-gray-${p.file}.png`, clip: await meter.boundingBox() });
      const { items } = await boxes(page);
      for (const [other, b] of Object.entries(items)) if (other !== "style") expect(overlaps(items.style, b), `style x ${other}`).toBe(false);
    });
  });
}

test.describe("MOB-9 on iPhone Safari (no Fullscreen API)", () => {
  test.use(profile("iPhone 15"));

  test("the button does not show, and the turn hint still shows", async ({ page }) => {
    test.setTimeout(180000);
    await page.addInitScript(() => {
      delete Element.prototype.requestFullscreen;
      delete Element.prototype.webkitRequestFullscreen;
    });
    await ready(page);
    expect(await page.evaluate(() => typeof document.documentElement.requestFullscreen)).toBe("undefined");
    await expect(page.locator("#fullscreen-toggle")).toHaveCount(0);
    await expect(page.locator("#turn-hint")).toBeVisible();
  });
});

test("MOB-9: a desktop gets no fullscreen button and no turn hint", async ({ page }) => {
  test.setTimeout(180000);
  await ready(page);
  await expect(page.locator("#fullscreen-toggle")).toHaveCount(0);
  await expect(page.locator("#turn-hint")).toHaveCount(0);
});

// The beat pulse scale over one second of beats.
async function pulseScales(page) {
  await page.locator("#stage").tap();
  await page.waitForFunction(() => getComputedStyle(document.getElementById("hud-pulse")).display !== "none", null, { timeout: 15000 });
  const out = [];
  for (let i = 0; i < 20; i += 1) {
    out.push(await page.evaluate(() => document.getElementById("hud-pulse").style.transform));
    await page.waitForTimeout(50);
  }
  return out.map((t) => Number(/scale\(([\d.]+)\)/.exec(t)?.[1] ?? 1));
}

test.describe("MOB-11: the reduced-motion option", () => {
  test.use(profile("Pixel 7"));

  test("starts from prefers-reduced-motion, and the player can change it at once", async ({ page }) => {
    test.setTimeout(240000);
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // The phone tier has the comic effects, so the policy shows the change.
    await ready(page, "&quality=phone");
    expect(await page.evaluate(() => window.__atl.effects.info.reducedMotion)).toBe(true);
    expect(await page.evaluate(() => window.__atl.effects.info.enabled)).toBe(false);
    const still = await pulseScales(page);
    expect(Math.max(...still)).toBe(1);

    await page.locator("#settings-toggle").tap();
    const menu = page.getByRole("dialog", { name: "SETTINGS" });
    const box = menu.getByRole("checkbox", { name: /Reduce motion/ });
    await expect(box).toBeChecked();
    await expect(page.locator("#settings-reduce-motion-hint")).toContainText("Follows your device (on)");
    await expect(page.locator("#settings-reduce-motion-hint")).toContainText("Sounds stay");
    const row = await page.locator("label:has(#settings-reduce-motion)").boundingBox();
    expect(row.height).toBeGreaterThanOrEqual(44);
    expectContrast(await colors(page, "#settings-reduce-motion-hint"), "reduce motion hint");
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "e2e/__screenshots__/phone-polish-reduce-motion-menu.png" });

    // The player turns the motion back on: it applies at once and saves.
    await box.tap();
    await expect(box).not.toBeChecked();
    expect(await page.evaluate(() => window.__atl.effects.info.reducedMotion)).toBe(false);
    expect(await page.evaluate(() => window.__atl.effects.info.enabled)).toBe(true);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("atl.settings.v1")).reduceMotion)).toBe(false);
    await page.locator("#settings-close").tap();
    const moving = await pulseScales(page);
    expect(Math.max(...moving)).toBeGreaterThan(1.05);

    // After a reload the saved choice wins over the device.
    await page.reload();
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 90000 });
    expect(await page.evaluate(() => window.__atl.effects.info.reducedMotion)).toBe(false);

    // Back to the device value: the setting is "auto" again.
    await page.locator("#settings-toggle").tap();
    await page.getByRole("checkbox", { name: /Reduce motion/ }).tap();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("atl.settings.v1")).reduceMotion)).toBe("auto");
    expect(await page.evaluate(() => window.__atl.effects.info.reducedMotion)).toBe(true);
    expect(errors, errors.join(" | ")).toEqual([]);
  });
});

test.describe("MOB-13: the skater switch", () => {
  test.use(profile("Pixel 7"));

  test("switches the skater in place: no reload, the run stays, the phone keeps the 1024 px model", async ({ page }) => {
    test.setTimeout(240000);
    const errors = collectErrors(page);
    // Record the fetched URLs: the resource timing buffer fills on this level.
    await page.addInitScript(() => {
      window.__fetched = [];
      const f = window.fetch;
      window.fetch = (input, init) => {
        window.__fetched.push(String(input?.url ?? input));
        return f(input, init);
      };
    });
    await ready(page);
    expect(await page.evaluate(() => window.__atl.skaterModel.name)).toBe("nia");
    expect(await page.evaluate(() => window.__atl.skaterModel.small)).toBe(true);
    const before = await page.evaluate(() => {
      window.__noReload = true;
      window.__atl.run.combo.score = 4321;
      return { position: [...window.__atl.skater.position], skate: window.__atl.skaterModel.skate };
    });

    await page.locator('#skater-select button[data-skater="marcus"]').tap();
    await page.waitForFunction(() => window.__atl.skaterModel.swaps === 1, null, { timeout: 60000 });
    const after = await page.evaluate(() => ({
      noReload: window.__noReload,
      name: window.__atl.skaterModel.name,
      score: window.__atl.run.combo.score,
      position: [...window.__atl.skater.position],
      skate: window.__atl.skaterModel.skate,
      url: location.search,
      models: window.__atl.scene.getObjectByName("skater-facing").children.filter((c) => c.name === "skater-model").length,
      textures: window.__fetched.filter((n) => /skaters\/marcus\/skater.*\.glb/.test(n)),
    }));
    expect(after.noReload).toBe(true);
    expect(after.name).toBe("marcus");
    expect(after.score).toBe(4321);
    for (let i = 0; i < 3; i += 1) expect(Math.abs(after.position[i] - before.position[i])).toBeLessThan(0.5);
    expect(after.skate).not.toEqual(before.skate);
    expect(after.url).toContain("skater=marcus");
    expect(after.models).toBe(1);
    // The phone loads the 1024 px Marcus, not the 2048 px one.
    expect(after.textures.length).toBeGreaterThan(0);
    for (const n of after.textures) expect(n).toContain("skater-1024");
    await expect(page.locator('#skater-select button[data-skater="marcus"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('#skater-select button[data-skater="nia"]')).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(500);
    await page.screenshot({ path: "e2e/__screenshots__/phone-polish-switch-marcus.png" });

    // And back to Nia: the first load is reused.
    await page.locator('#skater-select button[data-skater="nia"]').tap();
    await page.waitForFunction(() => window.__atl.skaterModel.swaps === 2, null, { timeout: 60000 });
    expect(await page.evaluate(() => [window.__noReload, window.__atl.skaterModel.name, window.__atl.run.combo.score])).toEqual([true, "nia", 4321]);
    expect(errors, errors.join(" | ")).toEqual([]);
  });
});
