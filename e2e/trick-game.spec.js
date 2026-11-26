import { expect, test, devices } from "@playwright/test";

// The trick rules in the real game (#328, #340, docs/gdd/trick-input.md):
// src/main.js turns on skaterEnv.tricks, and the sim reads the direction
// fields of the input frame. A real trick press gives the trick from the
// direction on the keyboard, a simulated gamepad, and touch (Pixel 7).
//
// The software renderer steps up to 5 sim frames per page frame. The tests
// stop the sim (renderPaused) while the keys go in; the key events wait for
// the next sample, as on a fast computer between 2 frames.

function profile(name) {
  const { defaultBrowserType, ...rest } = devices[name]; // eslint-disable-line no-unused-vars
  return rest;
}

async function ready(page, query = "") {
  await page.goto(`/?level=greybox&mute=1&intro=0${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 30000 });
}

const pause = (page, on = true) => page.evaluate((v) => (window.__atl.renderPaused = v), on);

// Runs the sim until `pred(skater, frame)` is true, then stops it.
async function runUntil(page, pred, timeout = 20000) {
  await pause(page, false);
  await page.waitForFunction(
    (src) => {
      const ok = new Function("s", "f", `return (${src})(s, f)`)(window.__atl.skater, window.__atl.input.frame);
      if (ok) window.__atl.renderPaused = true;
      return ok;
    },
    pred.toString(),
    { timeout, polling: "raf" },
  );
}

// Runs the sim for at least one more input sample, then stops it.
async function oneSample(page) {
  const t0 = await page.evaluate(() => window.__atl.input.frame?.t ?? 0);
  await pause(page, false);
  await page.waitForFunction(
    (t) => {
      const ok = (window.__atl.input.frame?.t ?? 0) > t + 1e-6;
      if (ok) window.__atl.renderPaused = true;
      return ok;
    },
    t0,
    { timeout: 10000, polling: "raf" },
  );
}

// A text box with the trick of the skater, for the screenshot.
async function showTrick(page, label) {
  await page.evaluate((l) => {
    const s = window.__atl.skater;
    let el = document.getElementById("e2e-trick");
    if (!el) {
      el = document.createElement("pre");
      el.id = "e2e-trick";
      el.style.cssText = "position:fixed;left:12px;top:12px;z-index:9999;background:#fff;color:#000;font:16px monospace;padding:8px;border:2px solid #000";
      document.body.appendChild(el);
    }
    el.textContent = `${l}\nstate ${s.state}  trick ${s.trick ? `${s.trick.name} (${s.trick.id}, clip ${s.trick.clip})` : "none"}`;
  }, label);
}

// Jump from the spawn and stop the sim in the air, past grabMinAir (0.1 s).
async function jumpAndHold(page, press, release) {
  await page.evaluate(() => window.__atl.resetSkater());
  await pause(page);
  await press();
  await runUntil(page, (s) => s.state === "air" && s.airTime >= 0.12);
  await release();
}

test("the game turns on the trick rules with the axis rule; ?gddRule plays the R3 rule only", async ({ page }) => {
  await ready(page);
  expect(await page.evaluate(() => window.__atl.input.tricks)).toEqual({ oneButton: false, relaxed: false });
  await ready(page, "&gddRule");
  expect(await page.evaluate(() => window.__atl.input.tricks)).toEqual({ oneButton: false, relaxed: false, k: { axisRule: false, udFirst: false } });
  expect(await page.evaluate(() => window.__atl.input.mode.r3Only)).toBe(true);
});

test("keyboard: W held, then Q in the air gives the Rocket Grab; Q with no direction gives the Mute Grab", async ({ page }) => {
  await ready(page);
  await jumpAndHold(page, () => page.keyboard.down("Space"), () => page.keyboard.up("Space"));
  await page.keyboard.down("KeyW");
  await oneSample(page);
  await page.keyboard.down("KeyQ");
  await oneSample(page);
  // A press with a fresh direction starts the grab in its frame.
  let s = await page.evaluate(() => window.__atl.skater);
  expect(s.state).toBe("air");
  expect(s.trick).toMatchObject({ kind: "grab", id: "rocket", name: "Rocket Grab", clip: "air_rocket" });
  await showTrick(page, "keyboard: W held, then Q in the air");
  await page.screenshot({ path: "e2e/__screenshots__/trick-game-keyboard-rocket.png" });
  await page.keyboard.up("KeyQ");
  await page.keyboard.up("KeyW");
  await runUntil(page, (s) => s.state === "rolling");

  // No direction: the press waits dirAfter (60 ms), then the Mute Grab.
  await page.waitForTimeout(300);
  await jumpAndHold(page, () => page.keyboard.down("Space"), () => page.keyboard.up("Space"));
  await page.keyboard.down("KeyQ");
  await runUntil(page, (s) => s.grab != null || s.state !== "air");
  s = await page.evaluate(() => window.__atl.skater);
  expect(s.trick).toMatchObject({ kind: "grab", id: "mute" });
  await page.keyboard.up("KeyQ");
  await pause(page, false);
});

test("simulated gamepad: the stick up, then Y in the air gives the Rocket Grab; the stick left gives the Japan Grab", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = { id: "Fake Standard Pad", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    window.__fakePad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
  });
  await ready(page);
  const button = (i, on) => page.evaluate(([b, v]) => (window.__fakePad.buttons[b] = { pressed: v, touched: v, value: v ? 1 : 0 }), [i, on]);
  const stick = (x, y) => page.evaluate(([a, b]) => ((window.__fakePad.axes[0] = a), (window.__fakePad.axes[1] = b)), [x, y]);

  for (const [x, y, id] of [[0, -0.9, "rocket"], [-0.9, 0, "japan"]]) {
    await jumpAndHold(page, () => button(0, true), () => button(0, false));
    await stick(x, y);
    await oneSample(page);
    await button(3, true);
    await oneSample(page);
    const s = await page.evaluate(() => window.__atl.skater);
    expect(s.trick).toMatchObject({ kind: "grab", id });
    expect(await page.evaluate(() => window.__atl.input.source)).toBe("gamepad");
    if (id === "rocket") {
      await showTrick(page, "gamepad: stick up, then Y in the air");
      await page.screenshot({ path: "e2e/__screenshots__/trick-game-gamepad-rocket.png" });
    }
    await button(3, false);
    await stick(0, 0);
    await runUntil(page, (s) => s.state === "rolling");
    await page.waitForTimeout(300);
  }
  await pause(page, false);
});

test("keyboard: One-button tricks: Q near the rail snaps; Q taps in the air give the set (Mute, then Japan)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("atl.controls.v1", JSON.stringify({ oneButton: true })));
  await ready(page);
  expect(await page.evaluate(() => window.__atl.input.tricks)).toEqual({ oneButton: true, relaxed: false });
  // Air: the next grab of the set, with no direction read.
  for (const id of ["mute", "japan"]) {
    await jumpAndHold(page, () => page.keyboard.down("Space"), () => page.keyboard.up("Space"));
    await page.keyboard.down("KeyW");
    await page.keyboard.down("KeyQ");
    await oneSample(page);
    expect(await page.evaluate(() => window.__atl.skater.trick)).toMatchObject({ kind: "grab", id });
    await page.keyboard.up("KeyQ");
    await page.keyboard.up("KeyW");
    await runUntil(page, (s) => s.state === "rolling");
    await page.waitForTimeout(300);
  }
  // A rail in snap range: TRICK snaps the skater (the straight rail x -20 to -8, z -2).
  await page.evaluate(() => window.__atl.resetSkater([-26, 0, -2], 0));
  await page.keyboard.down("KeyW");
  await runUntil(page, (s) => s.position[0] > -20.8);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("KeyQ");
  await runUntil(page, (s) => s.state === "grind", 15000);
  expect(await page.evaluate(() => window.__atl.input.oneButton.mode)).toBe("rail");
  await showTrick(page, "One-button tricks: Q near the rail");
  await page.screenshot({ path: "e2e/__screenshots__/trick-game-one-button-rail.png" });
  await page.keyboard.up("KeyQ");
  await pause(page, false);
});

test.describe("touch on Pixel 7", () => {
  test.use(profile("Pixel 7"));

  test("TRICK: a flick up in the air gives the Rocket Grab", async ({ page }) => {
    await ready(page);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    const center = (sel) =>
      page.evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, sel);
    const jump = await center(".touch-jump");
    const trick = await center(".touch-style1");
    await jumpAndHold(
      page,
      () => touch("touchStart", [{ id: 1, x: jump.x, y: jump.y }]),
      () => touch("touchEnd", []),
    );
    // The flick goes in while the sim is stopped (see e2e/trick-touch.spec.js).
    await touch("touchStart", [{ id: 2, x: trick.x, y: trick.y }]);
    await touch("touchMove", [{ id: 2, x: trick.x, y: trick.y - 30 }]);
    await runUntil(page, (s, f) => s.grab != null || s.state !== "air");
    const s = await page.evaluate(() => window.__atl.skater);
    expect(s.trick).toMatchObject({ kind: "grab", id: "rocket", name: "Rocket Grab" });
    await showTrick(page, "touch: TRICK flick up in the air");
    await page.screenshot({ path: "e2e/__screenshots__/trick-game-touch-rocket.png" });
    await touch("touchEnd", []);
    await pause(page, false);
  });
});
