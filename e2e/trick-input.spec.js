import { expect, test } from "@playwright/test";

// Trick input, #341: the direction fields of the input frame (dir, lastDir,
// lastDirAt, dirHist) on the keyboard and a simulated gamepad, and the R3 and
// R3a rule (src/input/direction.js) applied to the frame in the browser.

async function ready(page) {
  await page.goto("/?level=greybox&mute=1&intro=0");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 30000 });
}

// The R3 rule on the newest frame, with the module from the dev server.
// SwiftShader steps several sim frames per page call, so a press "now" can
// be late. With `afterLast` (frames) the press is that many frames after the
// newest start event, on the times the browser gave.
async function resolveNow(page, afterLast = null) {
  return page.evaluate(async (n) => {
    const d = await import("/src/input/direction.js");
    const c = await import("/src/input/trick-constants.js");
    const f = window.__atl.input.frame;
    const at = n == null ? f.t : f.lastDirAt + n / 60;
    const r = d.resolvePress(at, f.dirHist, c.trickKnobs());
    return r.dir ?? "pending";
  }, afterLast);
}

// Waits until the sim samples the input again, `n` times.
async function frames(page, n = 2) {
  const t0 = await page.evaluate(() => window.__atl.input.frame?.t ?? 0);
  await page.waitForFunction(([t, k]) => (window.__atl.input.frame?.t ?? 0) >= t + k / 60 - 1e-6, [t0, n], { timeout: 10000 });
}

// A text box with the frame fields, for the screenshot.
async function showFrame(page, label) {
  await page.evaluate((l) => {
    const f = window.__atl.input.frame;
    let el = document.getElementById("e2e-dir");
    if (!el) {
      el = document.createElement("pre");
      el.id = "e2e-dir";
      el.style.cssText = "position:fixed;left:12px;top:12px;z-index:9999;background:#fff;color:#000;font:16px monospace;padding:8px;border:2px solid #000";
      document.body.appendChild(el);
    }
    el.textContent = `${l}\ndir ${f.dir}  lastDir ${f.lastDir}  lastDirAt ${f.lastDirAt.toFixed(3)} s  held ${f.lastDirHeld}\nt ${f.t.toFixed(3)} s  balance ${f.balance.toFixed(2)}\ndirHist ${f.dirHist.map((e) => `${e.dir}@${e.at.toFixed(2)}${e.up == null ? "" : "-" + e.up.toFixed(2)}`).join(" ")}`;
  }, label);
}

test("keyboard: dir, lastDir, lastDirAt and the fresh rule", async ({ page }) => {
  await ready(page);
  expect(await page.evaluate(() => window.__atl.input.frame.dir)).toBe("n");

  // W held to push for 1 s: dir is up, but a press now is neutral.
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1000);
  await frames(page);
  let f = await page.evaluate(() => window.__atl.input.frame);
  expect(f).toMatchObject({ dir: "u", lastDir: "u", lastDirHeld: true, push: true });
  expect(f.t - f.lastDirAt).toBeGreaterThan(0.3);
  expect(await resolveNow(page)).toBe("pending");

  // A goes down with W still held: Left at the press (AC "W held then A").
  await page.keyboard.down("KeyA");
  await frames(page, 1);
  expect(await resolveNow(page, 3)).toBe("l");
  expect(await page.evaluate(() => window.__atl.input.frame.dir)).toBe("l");
  await showFrame(page, "W held 1 s, then A: the press gives l");
  await page.screenshot({ path: "e2e/__screenshots__/trick-input-keyboard.png" });
  await page.keyboard.up("KeyA");
  await page.keyboard.up("KeyW");

  // A D tap: lastDir stays after the key is let go.
  await page.keyboard.press("KeyD");
  await frames(page, 1);
  f = await page.evaluate(() => window.__atl.input.frame);
  expect(f).toMatchObject({ dir: "n", lastDir: "r", lastDirHeld: false });
  expect(f.dirHist.at(-1)).toMatchObject({ dir: "r" });
  expect(f.dirHist.at(-1).up).not.toBeNull();

  // Shift pushes and gives no direction.
  await page.waitForTimeout(400);
  await page.keyboard.down("ShiftLeft");
  await frames(page, 3);
  f = await page.evaluate(() => window.__atl.input.frame);
  expect(f).toMatchObject({ push: true, dir: "n", lastDir: "r" });
  expect(await resolveNow(page)).toBe("pending");
  await page.keyboard.up("ShiftLeft");
});

test("keyboard: the axis rule counts an up held 250 ms; toggle 7 does not", async ({ page }) => {
  await ready(page);
  await page.keyboard.down("KeyW");
  // Wait 250 ms of sim time with W still held.
  await page.waitForFunction(() => window.__atl.input.frame.t - window.__atl.input.frame.lastDirAt >= 0.25, null, { timeout: 10000 });
  const res = await page.evaluate(async () => {
    const d = await import("/src/input/direction.js");
    const c = await import("/src/input/trick-constants.js");
    const f = window.__atl.input.frame;
    const press = f.lastDirAt + 0.25;
    return { axis: d.freshDir(f.dirHist, press, c.trickKnobs()), r3: d.freshDir(f.dirHist, press, c.trickKnobs({ r3Only: true })) };
  });
  expect(res).toEqual({ axis: "u", r3: "n" });
  await page.keyboard.up("KeyW");
});

test("simulated gamepad: the stick gives the direction at 0.5 travel, main axis wins", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = { id: "Fake Standard Pad", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    window.__fakePad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
  });
  await ready(page);
  const setStick = (x, y) => page.evaluate(([a, b]) => ((window.__fakePad.axes[0] = a), (window.__fakePad.axes[1] = b)), [x, y]);

  await setStick(0.49, 0);
  await frames(page);
  expect(await page.evaluate(() => window.__atl.input.frame.dir)).toBe("n");

  await setStick(0.5, 0);
  await frames(page, 1);
  expect(await page.evaluate(() => window.__atl.input.frame.dir)).toBe("r");
  expect(await resolveNow(page, 3)).toBe("r");

  await setStick(0, 0);
  await frames(page);
  // x 0.6, y 0.7 (the browser gives up as negative): up wins.
  await setStick(0.6, -0.7);
  await frames(page, 1);
  const f = await page.evaluate(() => window.__atl.input.frame);
  expect(f).toMatchObject({ dir: "u", lastDir: "u", lastDirHeld: true });
  expect(f.balance).toBeCloseTo((0.7 - 0.15) / 0.85, 3);
  expect(await resolveNow(page, 3)).toBe("u");
  expect(await page.evaluate(() => window.__atl.input.source)).toBe("gamepad");
  await showFrame(page, "gamepad stick x 0.6 y up 0.7: up wins");
  await page.screenshot({ path: "e2e/__screenshots__/trick-input-gamepad.png" });
  await setStick(0, 0);
});
