import { expect, test, devices } from "@playwright/test";

// Trick input, #328 and #340: the touch flick on TRICK, SPIN, and GRIND
// (Pixel 7), the Controls screen (remap, One-button tricks, Relaxed timing)
// on the keyboard and a simulated gamepad. Real touches go in through CDP
// Input.dispatchTouchEvent, as in e2e/touch.spec.js. The input frame log
// (window.__atl.input.log / frames) shows each sim frame.

function profile(name) {
  const { defaultBrowserType, ...rest } = devices[name]; // eslint-disable-line no-unused-vars
  return rest;
}

async function fingers(page) {
  const cdp = await page.context().newCDPSession(page);
  const down = new Map();
  const send = (type) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [...down.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y })) });
  return {
    async start(id, x, y) {
      down.set(id, { x, y });
      await send("touchStart");
    },
    async move(id, x, y) {
      down.set(id, { x, y });
      await send("touchMove");
    },
    async end(id) {
      down.delete(id);
      if (down.size > 0) await send("touchMove");
      else await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
  };
}

async function ready(page, query = "") {
  await page.goto(`/?level=greybox&mute=1&intro=0${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 30000 });
}

const center = (page, sel) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);

// The frames of the log with a flick resolve of `button`.
const resolves = (frames, button) => frames.filter((f) => f.flick && f.flick[button] != null);

test.describe("touch flick on Pixel 7", () => {
  test.use(profile("Pixel 7"));

  test("the layout has 5 buttons with TRICK, and a ring on TRICK, SPIN, and GRIND", async ({ page }) => {
    await ready(page);
    const info = await page.evaluate(() => ({
      labels: [...document.querySelectorAll(".touch-btn")].map((el) => el.textContent),
      rings: [...document.querySelectorAll(".flick-ring")].map((el) => el.className),
      ticks: document.querySelectorAll(".flick-ring .flick-arrow").length,
    }));
    expect(info.labels).toEqual(["JUMP", "GRIND", "TRICK", "SPIN", "SWITCH"]);
    expect(info.rings).toEqual(["flick-ring flick-ring-grind", "flick-ring flick-ring-style1", "flick-ring flick-ring-style2"]);
    expect(info.ticks).toBe(12);
  });

  test("TRICK: a 24 px flick right resolves r in that frame; the ring shows the arrow", async ({ page }) => {
    await ready(page);
    const f = await fingers(page);
    const c = await center(page, ".touch-style1");
    await page.evaluate(() => window.__atl.input.log(true));
    // The software renderer gives a touch move about 1 s after the
    // touch-down, more than flickMaxMs of sim time. The sim pauses
    // (renderPaused) while the gesture goes in; the events wait for the next
    // sample, as on a phone between 2 frames.
    await page.evaluate(() => (window.__atl.renderPaused = true));
    await f.start(1, c.x, c.y);
    await f.move(1, c.x + 30, c.y + 2);
    await page.evaluate(() => (window.__atl.renderPaused = false));
    // The ring is active with 4 arrows at a radius of 40 px or less.
    await expect.poll(() => page.evaluate(() => document.querySelector(".flick-ring-style1").dataset.active)).toBe("1");
    await expect.poll(async () => resolves(await page.evaluate(() => window.__atl.input.frames), "style1").length, { timeout: 10000 }).toBe(1);
    const ring = await page.evaluate(() => {
      const ring = document.querySelector(".flick-ring-style1");
      const rr = ring.getBoundingClientRect();
      return {
        dir: ring.dataset.dir,
        radius: Math.max(...[...ring.querySelectorAll(".flick-arrow")].map((a) => {
          const r = a.getBoundingClientRect();
          return Math.hypot(r.left + r.width / 2 - rr.left, r.top + r.height / 2 - rr.top);
        })),
      };
    });
    expect(ring.dir).toBe("r");
    expect(ring.radius).toBeLessThanOrEqual(40);
    await page.screenshot({ path: "e2e/__screenshots__/trick-touch-flick-ring.png" });
    await f.end(1);
    const frames = await page.evaluate(() => window.__atl.input.frames);
    const i = frames.findIndex((fr) => fr.flick.style1 != null);
    expect(frames[i]).toMatchObject({ style1: true, flick: { style1: "r" }, lastDir: "r" });
    // No press before the resolve frame (the press comes at the resolve).
    expect(frames.slice(0, i).some((fr) => fr.style1)).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__atl.input.frame.style1)).toBe(false);
  });

  test("TRICK: a tap gives neutral for one frame; a hold with no drag gives neutral and holds", async ({ page }) => {
    await ready(page);
    const f = await fingers(page);
    const c = await center(page, ".touch-style1");
    // The tap goes in while the sim is paused (see the flick test), so the
    // touch-down and the lift reach the same sample.
    await page.evaluate(() => window.__atl.input.log(true));
    await page.evaluate(() => (window.__atl.renderPaused = true));
    await f.start(1, c.x, c.y);
    await f.end(1);
    await page.evaluate(() => (window.__atl.renderPaused = false));
    await expect.poll(async () => resolves(await page.evaluate(() => window.__atl.input.frames), "style1").length, { timeout: 10000 }).toBe(1);
    await expect.poll(async () => (await page.evaluate(() => window.__atl.input.frames)).length, { timeout: 10000 }).toBeGreaterThan(3);
    let frames = await page.evaluate(() => window.__atl.input.frames);
    const ri = frames.findIndex((fr) => fr.flick.style1 != null);
    expect(frames[ri]).toMatchObject({ style1: true, flick: { style1: "n" } });
    // Exactly one pressed frame, then a released frame.
    expect(frames.filter((fr) => fr.style1)).toHaveLength(1);
    expect(frames[ri + 1].style1).toBe(false);

    // A hold with no drag: neutral at flickMaxMs, and the press holds.
    await page.evaluate(() => window.__atl.input.log(true));
    await f.start(2, c.x, c.y);
    await expect.poll(async () => resolves(await page.evaluate(() => window.__atl.input.frames), "style1").length, { timeout: 10000 }).toBe(1);
    await page.waitForTimeout(300);
    frames = await page.evaluate(() => window.__atl.input.frames);
    const at = frames.findIndex((fr) => fr.flick.style1 != null);
    expect(frames[at].flick.style1).toBe("n");
    expect(frames.slice(at).every((fr) => fr.style1)).toBe(true);
    await f.end(2);
  });

  test("GRIND: the press is at the touch-down; a flick up resolves u once; the skater snaps on the touch press", async ({ page }) => {
    await ready(page);
    const f = await fingers(page);
    const grind = await center(page, ".touch-grind");
    const zone = await page.evaluate(() => {
      const r = document.querySelector(".touch-stick-zone").getBoundingClientRect();
      return { x: r.left + r.width * 0.4, y: r.top + r.height * 0.6 };
    });
    await page.evaluate(() => window.__atl.resetSkater([-26, 0, -2], 0));
    await f.start(1, zone.x, zone.y);
    await f.move(1, zone.x, zone.y - 50);
    // Stop the sim in snap range of the straight rail (x -20 to -8, z -2).
    await page.waitForFunction(
      () => {
        const ok = window.__atl.skater.position[0] > -20.8;
        if (ok) window.__atl.renderPaused = true;
        return ok;
      },
      null,
      { timeout: 30000, polling: "raf" },
    );
    await f.move(1, zone.x, zone.y);

    // Touch-down on GRIND. The sim runs until the snap and stops again.
    await page.evaluate(() => window.__atl.input.log(true));
    await f.start(2, grind.x, grind.y);
    await page.evaluate(() => (window.__atl.renderPaused = false));
    await page.waitForFunction(
      () => {
        const ok = window.__atl.skater.state === "grind";
        if (ok) window.__atl.renderPaused = true;
        return ok;
      },
      null,
      { timeout: 15000, polling: "raf" },
    );
    let frames = await page.evaluate(() => window.__atl.input.frames);
    const down = frames.findIndex((fr) => fr.grind);
    // The GRIND press is in the frame of the touch-down; the stance waits.
    expect(down).toBe(0);
    expect(frames[0]).toMatchObject({ grind: true, grindFlick: true, flick: { grind: null } });
    expect(resolves(frames, "grind")).toHaveLength(0);
    const snapFrames = frames.length;

    // After the snap: a flick up of 30 px.
    await f.move(2, grind.x, grind.y - 30);
    await page.evaluate(() => (window.__atl.renderPaused = false));
    await expect.poll(async () => resolves(await page.evaluate(() => window.__atl.input.frames), "grind").length, { timeout: 10000 }).toBe(1);
    await page.waitForTimeout(300);
    frames = await page.evaluate(() => window.__atl.input.frames);
    const res = resolves(frames, "grind");
    expect(res).toHaveLength(1);
    expect(res[0].flick.grind).toBe("u");
    const i = frames.indexOf(res[0]);
    expect(i).toBeGreaterThanOrEqual(snapFrames);
    expect(res[0].t - frames[0].t).toBeLessThanOrEqual(0.12 + 1e-6);
    expect(frames.slice(0, i).every((fr) => fr.grind && fr.grindFlick)).toBe(true);
    expect(frames.slice(i + 1).every((fr) => fr.grind && fr.flick.grind === null)).toBe(true);
    expect(await page.evaluate(() => window.__atl.skater.state)).toBe("grind");
    test.info().annotations.push({ type: "grind flick", description: `snap by frame ${snapFrames - 1}, resolve u at frame ${i}, ${((res[0].t - frames[0].t) * 1000).toFixed(0)} ms after the touch-down` });
    await page.screenshot({ path: "e2e/__screenshots__/trick-touch-grind.png" });
    await f.end(2);
    await f.end(1);
  });
});

test.describe("Controls screen on the keyboard and a simulated gamepad", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const pad = { id: "Fake Standard Pad", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      window.__fakePad = pad;
      navigator.getGamepads = () => [pad, null, null, null];
    });
  });

  test("remap: G to grind; G to jump is refused; a pad button; switches; reset", async ({ page }) => {
    await ready(page);
    await page.keyboard.press("KeyO");
    await page.click("#settings-controls-open");
    await expect(page.locator("#controls-menu")).toBeVisible();
    expect(await page.evaluate(() => window.__atl.input.controls.open)).toBe(true);
    expect(await page.evaluate(() => window.__atl.settings.isOpen ?? true)).toBe(true);

    // G to grind.
    await page.click("#controls-key-grind");
    await expect(page.locator("#controls-key-grind")).toHaveText("Press a key");
    await page.keyboard.press("KeyG");
    await expect(page.locator("#controls-key-grind")).toHaveText("G");
    // G to jump: refused, and G still grinds.
    await page.click("#controls-key-jump");
    await page.keyboard.press("KeyG");
    await expect(page.locator("#controls-status")).toHaveText("G is on Grind. Jump did not change.");
    await expect(page.locator("#controls-key-jump")).toHaveText("Space");
    await page.screenshot({ path: "e2e/__screenshots__/trick-controls-refused.png" });
    // W can also be a direction (another group), but not a second direction.
    await page.click("#controls-key-dirDown");
    await page.keyboard.press("KeyW");
    await expect(page.locator("#controls-status")).toContainText("W is on Trick up");

    // The gamepad: Jump to RB (button 5).
    await page.click("#controls-pad-jump");
    await expect(page.locator("#controls-pad-jump")).toHaveText("Press a button");
    await page.evaluate(() => (window.__fakePad.buttons[5] = { pressed: true, touched: true, value: 1 }));
    await expect(page.locator("#controls-pad-jump")).toHaveText("RB");
    // Escape cancels a gamepad wait; a later pad press changes nothing.
    await page.click("#controls-pad-grind");
    await expect(page.locator("#controls-pad-grind")).toHaveText("Press a button");
    await page.keyboard.press("Escape");
    await expect(page.locator("#controls-pad-grind")).toHaveText("RT");
    await expect(page.locator("#controls-menu")).toBeVisible();
    await page.evaluate(() => (window.__fakePad.buttons[4] = { pressed: true, touched: true, value: 1 }));
    await page.waitForTimeout(200);
    await expect(page.locator("#controls-pad-grind")).toHaveText("RT");
    await page.evaluate(() => (window.__fakePad.buttons[4] = { pressed: false, touched: false, value: 0 }));
    await page.evaluate(() => (window.__fakePad.buttons[5] = { pressed: false, touched: false, value: 0 }));

    // The 2 switches reach the input frame.
    await page.check("#controls-one-button");
    await page.check("#controls-relaxed");
    expect(await page.evaluate(() => window.__atl.input.mode)).toMatchObject({ oneButton: true, relaxed: true });
    await page.screenshot({ path: "e2e/__screenshots__/trick-controls.png", fullPage: false });
    await page.click("#controls-done");
    await expect(page.locator("#controls-menu")).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__atl.input.frame.oneButton)).toBe(true);

    // In the game: G grinds, F does not, and RB jumps.
    await page.keyboard.down("KeyG");
    await expect.poll(() => page.evaluate(() => window.__atl.input.frame.grind)).toBe(true);
    await page.keyboard.up("KeyG");
    await page.keyboard.down("KeyF");
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__atl.input.frame.grind)).toBe(false);
    await page.keyboard.up("KeyF");

    // The choice stays after a reload.
    await ready(page);
    const saved = await page.evaluate(() => ({ grind: window.__atl.input.bindings.keyboard.grind, jump: window.__atl.input.bindings.gamepad.buttons.jump, mode: window.__atl.input.mode }));
    expect(saved).toMatchObject({ grind: ["KeyG"], jump: [5], mode: { oneButton: true, relaxed: true } });

    // Reset to the defaults.
    await page.evaluate(() => window.__atl.input.openControls());
    await page.click("#controls-reset");
    await expect(page.locator("#controls-key-grind")).toHaveText("F");
    expect(await page.evaluate(() => window.__atl.input.bindings.gamepad.buttons.jump)).toEqual([0]);
    await page.keyboard.press("Escape");
    await expect(page.locator("#controls-menu")).toBeHidden();
  });
});
