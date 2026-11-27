import { expect, test, devices } from "@playwright/test";
import { linkRide, pinRide } from "./teach-ride.js";

// Teach the moves in the world (#76). A new player (empty storage) follows
// the prompts: push, steer, jump and dance with real keys or real touches,
// then the grind pin with the ride of e2e/teach-ride.js (planned in the pure
// simulation from the spawn to the rail the pin shows). Then the 3 trick
// steps of #331: a grab with a direction (real keys, a simulated gamepad, or
// a touch flick), a grind stance, and the manual link (the skatepark ride of
// linkRide, which also gives the 3-link combo of the combo tip).
// Screenshots: e2e/__screenshots__/teach-*.png.

const SHOTS = "e2e/__screenshots__";
const QUERY = "level=beltline-eastside&mute=1&governor=0&weather=clear&time=14&cars=0&npcs=0&peds=0&run=free";

async function open(page, extra = "") {
  await page.goto(`/?${QUERY}${extra}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 240000 });
}

const teach = (page) => page.evaluate(() => ({ step: window.__atl.teach.step, finished: window.__atl.teach.finished, kind: window.__atl.teach.kind, prompt: window.__atl.teach.prompt, target: window.__atl.teach.target, visible: window.__atl.teach.visible }));
const stepIs = (page, step, timeout = 60000) => page.waitForFunction((s) => window.__atl.teach.step === s, step, { timeout });

// The prompt box must sit inside the screen and not cover the HUD column.
async function inside(page) {
  const r = await page.evaluate(() => {
    const b = document.getElementById("teach").getBoundingClientRect();
    return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: innerWidth, h: innerHeight };
  });
  expect(r.left).toBeGreaterThanOrEqual(0);
  expect(r.right).toBeLessThanOrEqual(r.w);
  expect(r.top).toBeGreaterThanOrEqual(0);
  expect(r.bottom).toBeLessThanOrEqual(r.h);
  // The card covered the PHOTO and SETTINGS buttons on a phone in landscape.
  const hits = await page.evaluate(() => {
    const t = document.getElementById("teach").getBoundingClientRect();
    const out = [];
    for (const sel of ["#photo-toggle", "#settings-toggle", "#fullscreen-toggle", "#minimap"]) {
      const el = document.querySelector(sel);
      if (!el || getComputedStyle(el).display === "none" || getComputedStyle(el).visibility === "hidden") continue;
      const b = el.getBoundingClientRect();
      if (b.width && !(t.right <= b.left || b.right <= t.left || t.bottom <= b.top || b.bottom <= t.top)) out.push(sel);
    }
    return out;
  });
  expect(hits).toEqual([]);
  return r;
}

// The title fits on one line and does not cover the step count.
async function readable(page) {
  const r = await page.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const t = box("#teach .teach-title");
    const c = box("#teach .teach-count");
    return { titleH: t.height, overlap: !(t.right <= c.left || c.right <= t.left || t.bottom <= c.top || c.bottom <= t.top) };
  });
  expect(r.titleH).toBeLessThan(30);
  expect(r.overlap).toBe(false);
}

const pause = (page, on = true) => page.evaluate((v) => (window.__atl.renderPaused = v), on);

// Runs the sim until the skater is in the air for `air` s, then stops it, so
// the next key or button goes in on one sample (as in e2e/trick-game.spec.js).
async function inTheAir(page, air = 0.15) {
  await page.waitForFunction(
    (a) => {
      const s = window.__atl.skater;
      const ok = s.state === "air" && s.airTime >= a;
      if (ok) window.__atl.renderPaused = true;
      return ok;
    },
    air,
    { timeout: 60000, polling: "raf" },
  );
}

// Plays the link ride of #331 in the page (the stance, the manual link, and
// the combo tip). Resolves when the script ends.
async function rideLink(page) {
  const ride = linkRide();
  await page.evaluate(({ script, start }) => {
    window.__ride = { done: false };
    window.__atl.runScript(script, start).then(() => (window.__ride.done = true));
  }, ride);
  await page.waitForFunction(() => window.__ride.done, null, { timeout: 900000 });
  return ride;
}

// Plays the pin ride in the page. Resolves with the end skater.
async function ridePin(page, onTarget) {
  // The full ride from the spawn runs in Vitest (src/ui/teach-ride.test.js);
  // the browser rides the last 25 m, as the software renderer is slow.
  const ride = pinRide({ approach: 25 });
  await page.evaluate(({ script, start }) => {
    window.__ride = { done: false };
    window.__atl.runScript(script, start).then(() => (window.__ride.done = true));
  }, ride);
  if (onTarget) await onTarget(ride);
  await page.waitForFunction(() => window.__ride.done, null, { timeout: 900000 });
  return ride;
}

test.describe("teach prompts (#76)", () => {
  test.setTimeout(1500000);

  test("a new player on the keyboard follows the prompts, high tier 1280 x 720", async ({ page }) => {
    await open(page, "&quality=high");
    let t = await teach(page);
    expect(t.visible).toBe(true);
    expect(t.step).toBe("push");
    expect(t.kind).toBe("keyboard");
    expect(t.prompt.title).toBe("Push to roll");
    expect(t.prompt.icons).toEqual([
      { type: "key", label: "W" },
      { type: "key", label: "Shift" },
    ]);
    expect(t.prompt.count).toBe("1 of 8");
    await inside(page);
    await page.screenshot({ path: `${SHOTS}/teach-high-1-push.png` });

    // Push: hold W.
    await page.keyboard.down("KeyW");
    await stepIs(page, "steer");
    t = await teach(page);
    expect(["Good", "Steer"]).toContain(t.prompt.title); // the check mark shows first for 700 ms
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Steer", null, { timeout: 30000 });
    t = await teach(page);
    expect(t.prompt.icons.map((i) => i.label)).toEqual(["A", "D"]);
    expect(t.prompt.count).toBe("2 of 8");
    await page.screenshot({ path: `${SHOTS}/teach-high-2-steer.png` });

    // Steer: hold A with W.
    await page.keyboard.down("KeyA");
    await stepIs(page, "jump");
    await page.keyboard.up("KeyA");
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Jump", null, { timeout: 30000 });
    t = await teach(page);
    expect(t.prompt.icons).toEqual([{ type: "key", label: "Space" }]);
    await page.screenshot({ path: `${SHOTS}/teach-high-3-jump.png` });

    // Jump: Space.
    await page.keyboard.press("Space");
    await stepIs(page, "dance");
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Dance while you roll", null, { timeout: 30000 });
    t = await teach(page);
    expect(t.prompt.icons.map((i) => i.label)).toEqual(["Q", "E"]);
    await page.screenshot({ path: `${SHOTS}/teach-high-4-dance.png` });

    // Dance: Q, while still rolling (W held).
    await page.waitForFunction(() => window.__atl.run.skater.state === "rolling" && window.__atl.run.skater.speed > 2, null, { timeout: 30000 });
    await page.keyboard.down("KeyQ");
    await stepIs(page, "grind");
    await page.keyboard.up("KeyQ");
    await page.keyboard.up("KeyW");
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Grind the rail" && window.__atl.teach.target, null, { timeout: 30000 });
    t = await teach(page);
    expect(t.prompt.icons).toEqual([{ type: "key", label: "F" }]);
    expect(t.target.id).toBe("rail:skatepark:h4w-skatepark:end-rail:top");
    await expect(page.locator("#teach-pin .teach-pin-label")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/teach-high-5-grind.png` });

    // Grind: the ride follows the pin from the spawn. A shot when the rail is near.
    const ride = await ridePin(page, async () => {
      await page.waitForFunction(() => (window.__atl.teach.target?.distance ?? 99) < 22, null, { timeout: 240000 });
      const pin = await page.evaluate(() => ({ edge: document.getElementById("teach-pin").dataset.edge, label: document.querySelector(".teach-pin-label").textContent }));
      expect(pin.edge).toBe("0"); // on the rail, not on the screen edge
      expect(pin.label).toMatch(/^Rail \d+ m$/);
      await page.screenshot({ path: `${SHOTS}/teach-high-6-pin.png` });
    });
    expect(ride.links).toEqual(["Rail Grind", "Hop", "Toe Spin"]);

    // #331 step 6: a grab with a direction. Real keys: Space, then A and Q in the air.
    await stepIs(page, "grab");
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Aim a grab", null, { timeout: 30000 });
    t = await teach(page);
    expect(t.prompt.icons).toEqual([
      { type: "key", label: "WASD" },
      { type: "key", label: "Q" },
    ]);
    expect(t.prompt.hint).toBe("In the air, tap a direction with Q");
    expect(t.prompt.count).toBe("6 of 8");
    expect(t.target).toBeNull(); // no rail pin for the grab
    await inside(page);
    await page.screenshot({ path: `${SHOTS}/teach-high-7-grab.png` });
    await page.keyboard.press("Space");
    await inTheAir(page);
    await page.keyboard.down("KeyA");
    await page.keyboard.down("KeyQ");
    await pause(page, false);
    await stepIs(page, "stance");
    await page.keyboard.up("KeyQ");
    await page.keyboard.up("KeyA");
    expect(await page.evaluate(() => window.__atl.teach.done.grab)).toBe(true);

    // #331 step 7: a grind stance. The rail pin shows again.
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Grind with a stance" && window.__atl.teach.target, null, { timeout: 30000 });
    t = await teach(page);
    expect(t.prompt.icons.map((i) => i.label)).toEqual(["WASD", "F"]);
    expect(t.prompt.hint).toBe("At the rail, tap a direction with F");
    await expect(page.locator("#teach-pin .teach-pin-label")).toBeVisible();
    await inside(page);
    await page.screenshot({ path: `${SHOTS}/teach-high-8-stance.png` });

    // #331 step 8 and the combo tip: the skatepark ride (Soul Grind, GRIND held
    // off the bar into a manual, a jump out of the manual).
    const seen = [];
    const linkRun = rideLink(page);
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Grind, manual, jump", null, { timeout: 900000 });
    t = await teach(page);
    seen.push(t.step);
    expect(t.prompt.icons).toEqual([{ type: "key", label: "F" }]);
    expect(t.prompt.hint).toBe("Hold F off the rail, then jump or hit a kicker");
    await page.screenshot({ path: `${SHOTS}/teach-high-9-link.png` });
    const link = await linkRun;
    expect(link.links.slice(0, 3)).toEqual(["Rail Soul Grind", "Hop", "Manual"]);
    expect(seen).toEqual(["link"]);
    t = await teach(page);
    expect(t.finished).toBe(true);
    await page.waitForFunction(() => !window.__atl.teach.visible, null, { timeout: 30000 });
    await expect(page.locator("#teach")).toBeHidden();
    await expect(page.locator("#teach-pin")).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("atl.teach.v1"))).toBe("done-v2");

    // A second visit shows no prompt; ?teach=1 shows them again.
    await open(page, "&quality=high");
    expect(await page.evaluate(() => window.__atl.teach.enabled)).toBe(false);
    await expect(page.locator("#teach")).toHaveCount(0);
    await open(page, "&quality=high&teach=1");
    expect((await teach(page)).step).toBe("push");
  });

  test("the gamepad prompt names the gamepad buttons", async ({ page }) => {
    // A standard gamepad with no button down: the prompts show the pad before
    // the first input.
    await page.addInitScript(() => {
      const pad = { id: "Test pad (STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      window.__pad = pad;
      navigator.getGamepads = () => [pad];
    });
    await open(page);
    await page.waitForFunction(() => window.__atl.teach.kind === "gamepad", null, { timeout: 30000 });
    let t = await teach(page);
    expect(t.prompt.icons).toEqual([{ type: "pad", label: "X" }]);
    await page.screenshot({ path: `${SHOTS}/teach-gamepad-push.png` });
    // X pushes.
    await page.evaluate(() => (window.__pad.buttons[2] = { pressed: true, value: 1 }));
    await stepIs(page, "steer");
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Steer", null, { timeout: 30000 });
    t = await teach(page);
    expect(t.kind).toBe("gamepad");
    expect(t.prompt.icons[0].type).toBe("stick");
    expect(t.prompt.hint).toBe("Left stick");
  });

  test("gamepad: the trick steps (#331) name the stick and the pad buttons; a stick grab finishes the grab step", async ({ page }) => {
    await page.addInitScript(() => {
      const pad = { id: "Test pad (STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
      window.__pad = pad;
      navigator.getGamepads = () => [pad];
    });
    await open(page, "&teach=grab");
    await page.waitForFunction(() => window.__atl.teach.kind === "gamepad" && window.__atl.teach.prompt?.title === "Aim a grab", null, { timeout: 30000 });
    let t = await teach(page);
    expect(t.prompt.icons).toEqual([
      { type: "stick", label: "L" },
      { type: "pad", label: "Y" },
    ]);
    expect(t.prompt.hint).toBe("In the air, tilt the stick and press Y");
    await page.screenshot({ path: `${SHOTS}/teach-gamepad-grab.png` });
    // A jumps; in the air, the stick left and Y: a Japan Grab.
    await page.evaluate(() => (window.__pad.buttons[0] = { pressed: true, value: 1 }));
    await inTheAir(page);
    await page.evaluate(() => {
      window.__pad.buttons[0] = { pressed: false, value: 0 };
      window.__pad.axes[0] = -1;
      window.__pad.buttons[3] = { pressed: true, value: 1 };
    });
    await pause(page, false);
    await stepIs(page, "stance");
    expect(await page.evaluate(() => window.__atl.skater.grab?.id ?? window.__atl.teach.done.grab)).toBeTruthy();
    await page.evaluate(() => {
      window.__pad.axes[0] = 0;
      window.__pad.buttons[3] = { pressed: false, value: 0 };
    });
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Grind with a stance", null, { timeout: 30000 });
    t = await teach(page);
    expect(t.kind).toBe("gamepad");
    expect(t.prompt.icons).toEqual([
      { type: "stick", label: "L" },
      { type: "pad", label: "RT" },
    ]);
    expect(t.prompt.hint).toBe("At the rail, tilt the stick and press RT");
    await page.screenshot({ path: `${SHOTS}/teach-gamepad-stance.png` });
    // The link step on the gamepad.
    await open(page, "&teach=link");
    await page.waitForFunction(() => window.__atl.teach.kind === "gamepad" && window.__atl.teach.prompt?.title === "Grind, manual, jump", null, { timeout: 30000 });
    t = await teach(page);
    expect(t.prompt.icons).toEqual([{ type: "pad", label: "RT" }]);
    expect(t.prompt.hint).toBe("Hold RT off the rail, then jump or hit a kicker");
    expect(t.prompt.count).toBe("8 of 8");
    await page.screenshot({ path: `${SHOTS}/teach-gamepad-link.png` });
  });

  test("one-button mode: the trick steps (#331) show TRICK only; a plain TRICK grab counts", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("atl.controls.v1", JSON.stringify({ oneButton: true })));
    await open(page, "&teach=grab");
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Grab in the air", null, { timeout: 30000 });
    let t = await teach(page);
    expect(t.prompt.icons).toEqual([{ type: "key", label: "Q" }]);
    expect(t.prompt.hint).toBe("In the air, tap Q for the next grab");
    await page.screenshot({ path: `${SHOTS}/teach-onebutton-grab.png` });
    // Space, then Q in the air with no direction: the Mute Grab of the set counts.
    await page.keyboard.press("Space");
    await inTheAir(page);
    await page.keyboard.down("KeyQ");
    await pause(page, false);
    await stepIs(page, "stance");
    await page.keyboard.up("KeyQ");
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Grind with TRICK", null, { timeout: 30000 });
    t = await teach(page);
    expect(t.prompt.icons).toEqual([{ type: "key", label: "Q" }]);
    expect(t.prompt.hint).toBe("At the rail, tap Q for the next stance");
    await page.screenshot({ path: `${SHOTS}/teach-onebutton-stance.png` });
  });

  test("touch: the trick steps (#331) teach the flick; a flick right on TRICK in the air finishes the grab step", async ({ browser }) => {
    const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars
    const context = await browser.newContext({ ...pixel });
    const page = await context.newPage();
    await open(page, "&touch=1&teach=grab");
    const cdp = await context.newCDPSession(page);
    const down = new Map();
    const send = (type) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [...down.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y })) });
    const finger = {
      start: async (id, x, y) => (down.set(id, { x, y }), send("touchStart")),
      move: async (id, x, y) => (down.set(id, { x, y }), send("touchMove")),
      end: async (id) => {
        down.delete(id);
        if (down.size) await send("touchMove");
        else await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      },
    };
    const c = await page.evaluate(() => {
      const ctr = (sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      return { jump: ctr(".touch-jump"), style1: ctr(".touch-style1") };
    });
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Aim a grab", null, { timeout: 30000 });
    let t = await teach(page);
    expect(t.kind).toBe("touch");
    expect(t.prompt.icons).toEqual([{ type: "touch", label: "TRICK" }]);
    expect(t.prompt.hint).toBe("In the air, flick TRICK up, down, left, or right");
    await expect(page.locator(".touch-style1")).toHaveAttribute("data-teach", "1");
    await inside(page);
    await readable(page);
    await page.screenshot({ path: `${SHOTS}/teach-phone-7-grab.png` });
    // A tap on JUMP, then in the air a 40 px flick right from TRICK: the Side Grab.
    await finger.start(1, c.jump.x, c.jump.y);
    await finger.end(1);
    await inTheAir(page);
    await finger.start(2, c.style1.x, c.style1.y);
    await finger.move(2, c.style1.x + 40, c.style1.y);
    await pause(page, false);
    await stepIs(page, "stance");
    await finger.end(2);
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Grind with a stance" && window.__atl.teach.target, null, { timeout: 30000 });
    t = await teach(page);
    expect(t.prompt.icons).toEqual([{ type: "touch", label: "GRIND" }]);
    expect(t.prompt.hint).toBe("At the rail, flick GRIND up, down, left, or right");
    await expect(page.locator(".touch-grind")).toHaveAttribute("data-teach", "1");
    await expect(page.locator(".touch-style1")).not.toHaveAttribute("data-teach", "1");
    await inside(page);
    await readable(page);
    await page.screenshot({ path: `${SHOTS}/teach-phone-8-stance.png` });
    await context.close();
  });

  test("touch: on a phone in landscape the card keeps clear of the top buttons", async ({ browser }) => {
    const { defaultBrowserType, ...pixel } = devices["Pixel 7 landscape"]; // eslint-disable-line no-unused-vars
    const context = await browser.newContext({ ...pixel });
    const page = await context.newPage();
    await open(page, "&touch=1");
    await page.waitForFunction(() => window.__atl.teach.visible, null, { timeout: 60000 });
    await inside(page);
    await readable(page);
    await page.screenshot({ path: `${SHOTS}/teach-phone-landscape-1-push.png` });
    await context.close();
  });

  test("touch: a new player on a phone in portrait follows the prompts", async ({ browser }) => {
    const { defaultBrowserType, ...pixel } = devices["Pixel 7"]; // eslint-disable-line no-unused-vars
    const context = await browser.newContext({ ...pixel });
    const page = await context.newPage();
    await open(page, "&touch=1");
    const cdp = await context.newCDPSession(page);
    const down = new Map();
    const send = (type) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [...down.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y })) });
    const finger = {
      start: async (id, x, y) => (down.set(id, { x, y }), send("touchStart")),
      move: async (id, x, y) => (down.set(id, { x, y }), send("touchMove")),
      end: async (id) => {
        down.delete(id);
        if (down.size) await send("touchMove");
        else await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      },
    };
    const c = await page.evaluate(() => {
      const ctr = (sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const z = document.querySelector(".touch-stick-zone").getBoundingClientRect();
      return { stick: { x: z.left + z.width * 0.5, y: z.top + z.height * 0.6 }, jump: ctr(".touch-jump"), style2: ctr(".touch-style2"), w: innerWidth, h: innerHeight };
    });
    expect(c.h).toBeGreaterThan(c.w); // portrait

    let t = await teach(page);
    expect(t.kind).toBe("touch");
    expect(t.prompt.title).toBe("Push to roll");
    expect(t.prompt.icons[0].type).toBe("stick");
    expect(t.prompt.hint).toBe("Hold the stick up");
    // The prompt sits above the touch controls.
    const box = await inside(page);
    const pad = await page.evaluate(() => document.querySelector(".touch-buttons").getBoundingClientRect().top);
    expect(box.bottom).toBeLessThanOrEqual(pad);
    const zone = await page.evaluate(() => document.querySelector(".touch-stick-zone").getBoundingClientRect().top);
    expect(box.bottom).toBeLessThanOrEqual(zone);
    // One line of title: the card is wide enough for its text.
    const titleH = await page.evaluate(() => document.querySelector(".teach-title").getBoundingClientRect().height);
    expect(titleH).toBeLessThan(30);
    await page.screenshot({ path: `${SHOTS}/teach-phone-1-push.png` });

    // Push: the stick up.
    await finger.start(1, c.stick.x, c.stick.y);
    await finger.move(1, c.stick.x, c.stick.y - 50);
    await stepIs(page, "steer");
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Steer", null, { timeout: 30000 });
    await readable(page);
    await page.screenshot({ path: `${SHOTS}/teach-phone-2-steer.png` });
    // Steer: the stick up and left.
    await finger.move(1, c.stick.x - 45, c.stick.y - 40);
    await stepIs(page, "jump");
    await finger.move(1, c.stick.x, c.stick.y - 50);
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Jump", null, { timeout: 30000 });
    // The JUMP button glows.
    await expect(page.locator(".touch-jump")).toHaveAttribute("data-teach", "1");
    t = await teach(page);
    expect(t.prompt.icons).toEqual([{ type: "touch", label: "JUMP" }]);
    await readable(page);
    await page.screenshot({ path: `${SHOTS}/teach-phone-3-jump.png` });
    // Jump: a tap on JUMP.
    await finger.start(2, c.jump.x, c.jump.y);
    await finger.end(2);
    await stepIs(page, "dance");
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Dance while you roll", null, { timeout: 30000 });
    await expect(page.locator(".touch-style1")).toHaveAttribute("data-teach", "1");
    await expect(page.locator(".touch-jump")).not.toHaveAttribute("data-teach", "1");
    await readable(page);
    await page.screenshot({ path: `${SHOTS}/teach-phone-4-dance.png` });
    // A 360 px phone (the narrowest common width): the dance card still reads.
    const size = page.viewportSize();
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(300);
    await readable(page);
    await inside(page);
    await page.screenshot({ path: `${SHOTS}/teach-phone-360-dance.png` });
    await page.setViewportSize(size);
    // Dance: a tap on SPIN while rolling.
    await page.waitForFunction(() => window.__atl.run.skater.state === "rolling" && window.__atl.run.skater.speed > 2, null, { timeout: 30000 });
    await finger.start(3, c.style2.x, c.style2.y);
    await stepIs(page, "grind");
    await finger.end(3);
    await finger.end(1);
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Grind the rail" && window.__atl.teach.target, null, { timeout: 30000 });
    await expect(page.locator(".touch-grind")).toHaveAttribute("data-teach", "1");
    t = await teach(page);
    expect(t.prompt.hint).toBe("Ride to the rail, hold GRIND");
    await readable(page);
    await page.screenshot({ path: `${SHOTS}/teach-phone-5-grind.png` });

    await ridePin(page, async () => {
      await page.waitForFunction(() => (window.__atl.teach.target?.distance ?? 99) < 22, null, { timeout: 240000 });
      await page.screenshot({ path: `${SHOTS}/teach-phone-6-pin.png` });
    });
    // The trick steps (#331) come next: the TRICK button glows for the grab.
    await stepIs(page, "grab");
    await expect(page.locator(".touch-style1")).toHaveAttribute("data-teach", "1");
    await expect(page.locator(".touch-grind")).not.toHaveAttribute("data-teach", "1");
    await context.close();
  });
});
