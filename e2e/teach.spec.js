import { expect, test, devices } from "@playwright/test";
import { pinRide } from "./teach-ride.js";

// Teach the moves in the world (#76). A new player (empty storage) follows
// the prompts: push, steer, jump and dance with real keys or real touches,
// then the grind pin with the ride of e2e/teach-ride.js (planned in the pure
// simulation from the spawn to the rail the pin shows), then a 3-link combo.
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
  return r;
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
    expect(t.prompt.count).toBe("1 of 5");
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
    expect(t.prompt.count).toBe("2 of 5");
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
    t = await teach(page);
    expect(t.finished).toBe(true);
    await page.waitForFunction(() => !window.__atl.teach.visible, null, { timeout: 30000 });
    await expect(page.locator("#teach")).toBeHidden();
    await expect(page.locator("#teach-pin")).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("atl.teach.v1"))).toBe("done");

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
    await page.screenshot({ path: `${SHOTS}/teach-phone-3-jump.png` });
    // Jump: a tap on JUMP.
    await finger.start(2, c.jump.x, c.jump.y);
    await finger.end(2);
    await stepIs(page, "dance");
    await page.waitForFunction(() => window.__atl.teach.prompt?.title === "Dance while you roll", null, { timeout: 30000 });
    await expect(page.locator(".touch-style1")).toHaveAttribute("data-teach", "1");
    await expect(page.locator(".touch-jump")).not.toHaveAttribute("data-teach", "1");
    await page.screenshot({ path: `${SHOTS}/teach-phone-4-dance.png` });
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
    await page.screenshot({ path: `${SHOTS}/teach-phone-5-grind.png` });

    await ridePin(page, async () => {
      await page.waitForFunction(() => (window.__atl.teach.target?.distance ?? 99) < 22, null, { timeout: 240000 });
      await page.screenshot({ path: `${SHOTS}/teach-phone-6-pin.png` });
    });
    expect((await teach(page)).finished).toBe(true);
    await page.waitForFunction(() => !window.__atl.teach.visible, null, { timeout: 30000 });
    await expect(page.locator(".touch-btn[data-teach]")).toHaveCount(0);
    await context.close();
  });
});
