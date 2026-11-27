import { expect, test, devices } from "@playwright/test";
import { hudShortName } from "../src/ui/trick-names.js";

// #335: the HUD combo line shows the short form of a stance grind. A real
// touch ride on Pixel 7 (as in e2e/trick-touch.spec.js): a GRIND flick up on
// the greybox rail gives a Makio Grind; after a JUMP off the rail the combo
// line shows
// "Rail Makio" (or "Long Rail Makio"), not "... Makio Grind".

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

const center = (page, sel) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);

test.describe("the HUD short form of a stance grind (#335)", () => {
  test.use(profile("Pixel 7"));

  test("a Makio Grind shows as Rail Makio on the combo line", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.goto("/?level=greybox&mute=1&intro=0");
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 30000 });

    const f = await fingers(page);
    const grind = await center(page, ".touch-grind");
    const zone = await page.evaluate(() => {
      const r = document.querySelector(".touch-stick-zone").getBoundingClientRect();
      return { x: r.left + r.width * 0.4, y: r.top + r.height * 0.6 };
    });
    // Push toward the straight rail (x -20 to -8, z -2), and stop the sim in
    // snap range (the order of e2e/trick-touch.spec.js).
    await page.evaluate(() => window.__atl.resetSkater([-26, 0, -2], 0));
    await f.start(1, zone.x, zone.y);
    await f.move(1, zone.x, zone.y - 50);
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

    // GRIND touch-down: the sim runs to the snap and stops again.
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
    // A flick up after the snap: the stance changes to Makio once (R6, #340).
    await f.move(2, grind.x, grind.y - 30);
    await page.evaluate(() => (window.__atl.renderPaused = false));
    await expect.poll(() => page.evaluate(() => window.__atl.skater.trick?.id ?? null), { timeout: 10000 }).toBe("makio");
    // JUMP off the rail at once: a clean exit adds the link with the stance.
    // (A ride to the rail end with no steer can tip the balance over first.)
    const jump = await center(page, ".touch-jump");
    await f.start(3, jump.x, jump.y);
    await f.end(3);
    await page.waitForFunction(() => window.__atl.combo.links.some((l) => / Grind$/.test(l.name)), null, { timeout: 10000, polling: "raf" });
    const link = await page.evaluate(() => window.__atl.combo.links.find((l) => / Grind$/.test(l.name)).name);
    expect(link).toMatch(/^(Long )?Rail Makio Grind$/);

    // The HUD combo line shows the short form while the combo is open.
    const short = hudShortName(link);
    await page.waitForFunction((t) => document.getElementById("hud-combo").textContent.includes(t), short, { timeout: 5000, polling: "raf" });
    const text = await page.evaluate(() => document.getElementById("hud-combo").textContent);
    expect(text).not.toContain("Makio Grind");
    await page.screenshot({ path: "e2e/__screenshots__/trick-names-makio.png" });
    await f.end(2);
    await f.end(1);
    test.info().annotations.push({ type: "combo line", description: `${link} -> "${text}"` });
    expect(errors).toEqual([]);
  });
});
