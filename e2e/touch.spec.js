import { expect, test, devices } from "@playwright/test";

// Touch controls (#71). Chromium with phone descriptors (viewport, DPR,
// touch, user agent). WebKit is not installed, so the iPhone profile runs in
// Chromium. Real touches go in through CDP Input.dispatchTouchEvent, which
// gives the page real pointer events with pointerType "touch".

function profile(name) {
  const { defaultBrowserType, ...rest } = devices[name]; // eslint-disable-line no-unused-vars
  return rest;
}

// Holds the active touch points, because every CDP touch event must list
// all the fingers that are down.
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
    // CDP compares the list with the last event: a finger that is not in
    // the list lifts. touchEnd must have an empty list, so it lifts the last
    // finger only.
    async end(id) {
      down.delete(id);
      if (down.size > 0) await send("touchMove");
      else await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
  };
}

async function ready(page) {
  await page.goto("/?mute=1");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 30000 });
}

async function centers(page) {
  return page.evaluate(() => {
    const c = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    };
    const zone = document.querySelector(".touch-stick-zone").getBoundingClientRect();
    return {
      stick: { x: zone.left + zone.width * 0.4, y: zone.top + zone.height * 0.6 },
      jump: c(".touch-jump"),
      grind: c(".touch-grind"),
      style1: c(".touch-style1"),
      style2: c(".touch-style2"),
      viewport: { w: innerWidth, h: innerHeight },
    };
  });
}

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

for (const name of ["iPhone 15", "Pixel 7"]) {
  test.describe(`touch on ${name}`, () => {
    test.use(profile(name));

    test("the overlay shows, and every target is 44 px or larger and on screen", async ({ page }) => {
      await ready(page);
      expect(await page.evaluate(() => window.__atl.input.touch)).toBe(true);
      expect(await page.locator("#shell-info").isVisible()).toBe(false);
      const c = await centers(page);
      for (const b of [c.jump, c.grind, c.style1, c.style2]) {
        expect(Math.min(b.w, b.h)).toBeGreaterThanOrEqual(44);
        expect(b.x + b.w / 2).toBeLessThanOrEqual(c.viewport.w);
        expect(b.y + b.h / 2).toBeLessThanOrEqual(c.viewport.h);
      }
    });

    test("touch only: push, steer, grind the straight rail, and jump", async ({ page }) => {
      const errors = collectErrors(page);
      await ready(page);
      const c = await centers(page);
      const f = await fingers(page);
      // The scripted grind test starts here: the straight rail is ahead.
      await page.evaluate(() => window.__atl.resetSkater([-26, 0, -2], 0));

      // Left thumb: stick up pushes.
      await f.start(1, c.stick.x, c.stick.y);
      await f.move(1, c.stick.x, c.stick.y - 50);
      await expect.poll(() => page.evaluate(() => window.__atl.input.source), { timeout: 5000 }).toBe("touch");
      await expect.poll(() => page.evaluate(() => window.__atl.skater.speed), { timeout: 15000 }).toBeGreaterThan(3);

      // Right thumb: hold GRIND near the rail.
      await expect.poll(() => page.evaluate(() => window.__atl.skater.position[0]), { timeout: 15000 }).toBeGreaterThan(-22);
      await f.move(1, c.stick.x, c.stick.y); // stick back to the middle
      await f.start(2, c.grind.x, c.grind.y);
      await expect.poll(() => page.evaluate(() => window.__atl.skater.state), { timeout: 15000 }).toBe("grind");
      await page.screenshot({ path: `e2e/__screenshots__/touch-grind-${name.replace(/\s/g, "")}.png` });
      await f.end(2);

      // Tap JUMP: the skater leaves the ground or the rail.
      await f.start(3, c.jump.x, c.jump.y);
      await expect.poll(() => page.evaluate(() => window.__atl.skater.state), { timeout: 10000 }).toBe("air");
      await f.end(3);

      // Steer: the stick to the left turns the skater left (yaw goes up).
      await page.evaluate(() => window.__atl.resetSkater([-26, 0, -2], 0));
      const yaw0 = await page.evaluate(() => window.__atl.skater.yaw);
      await f.move(1, c.stick.x - 50, c.stick.y - 30);
      await expect.poll(() => page.evaluate(() => window.__atl.skater.yaw), { timeout: 10000 }).toBeGreaterThan(yaw0 + 0.3);
      await f.end(1);

      expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
    });

    test("a drag on the open screen turns the camera, not the skater", async ({ page }) => {
      await ready(page);
      const c = await centers(page);
      const f = await fingers(page);
      await page.evaluate(() => window.__atl.resetSkater([-26, 0, -2], 0));
      const x = c.viewport.w * 0.6;
      const y = c.viewport.h * 0.25;
      await f.start(1, x, y);
      for (let i = 1; i <= 5; i += 1) await f.move(1, x + i * 20, y);
      await f.end(1);
      await page.waitForTimeout(500);
      const s = await page.evaluate(() => ({ speed: window.__atl.skater.speed, yaw: window.__atl.skater.yaw }));
      expect(Math.abs(s.speed)).toBeLessThan(0.5);
      expect(Math.abs(s.yaw)).toBeLessThan(0.01);
    });
  });
}

test("a desktop with no touch screen gets no overlay", async ({ page }) => {
  await ready(page);
  expect(await page.evaluate(() => window.__atl.input.touch)).toBe(false);
  expect(await page.locator("#touch-controls").count()).toBe(0);
});
