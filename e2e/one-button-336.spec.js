import { expect, test } from "@playwright/test";

// One-button mode in the real game (#336, #342, GDD R12.1): the direction
// is not read. SPIN (E) plays its neutral slot, Cross Step, with a direction
// key down; GRIND (F) snaps in the neutral stance; TRICK (Q) snaps take the
// next stance of the one-button grind set ("(edge) Grind", then Soul).
// The greybox straight rail: x -20 to -8, z -2.
//
// The software renderer steps up to 5 sim frames per page frame. The tests
// stop the sim (renderPaused) while the keys go in.

async function ready(page) {
  await page.addInitScript(() => localStorage.setItem("atl.controls.v1", JSON.stringify({ oneButton: true })));
  await page.goto("/?level=greybox&mute=1&intro=0");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__atl.input.tricks)).toEqual({ oneButton: true, relaxed: false });
}

const pause = (page, on = true) => page.evaluate((v) => (window.__atl.renderPaused = v), on);

// Runs the sim until `pred(skater)` is true, then stops it.
async function runUntil(page, pred, timeout = 20000) {
  await pause(page, false);
  await page.waitForFunction(
    (src) => {
      const ok = new Function("s", `return (${src})(s)`)(window.__atl.skater);
      if (ok) window.__atl.renderPaused = true;
      return ok;
    },
    pred.toString(),
    { timeout, polling: "raf" },
  );
}

async function label(page, text) {
  await page.evaluate((t) => {
    const s = window.__atl.skater;
    let el = document.getElementById("e2e-336");
    if (!el) {
      el = document.createElement("pre");
      el.id = "e2e-336";
      el.style.cssText = "position:fixed;left:12px;top:12px;z-index:9999;background:#fff;color:#000;font:16px monospace;padding:8px;border:2px solid #000";
      document.body.appendChild(el);
    }
    el.textContent = `${t}\nstate ${s.state}  trick ${s.trick ? s.trick.name : "none"}`;
  }, text);
}

// To the rail: from x -26 on z -2, push with W until the skater is near the rail start.
async function toRail(page) {
  await page.evaluate(() => window.__atl.resetSkater([-26, 0, -2], 0));
  await page.keyboard.down("KeyW");
  await runUntil(page, (s) => s.position[0] > -20.8);
  await page.keyboard.up("KeyW");
}

test("keyboard: One-button tricks: E with A, W, or D down plays Cross Step", async ({ page }) => {
  await ready(page);
  for (const key of ["KeyA", "KeyW", "KeyD"]) {
    await page.evaluate(() => window.__atl.resetSkater());
    await page.keyboard.down("KeyW");
    await runUntil(page, (s) => s.speed > 4);
    await page.keyboard.up("KeyW");
    await page.keyboard.down(key);
    await page.keyboard.down("KeyE");
    await runUntil(page, (s) => s.style != null, 10000);
    expect(await page.evaluate(() => window.__atl.skater.style.name)).toBe("Cross Step");
    if (key === "KeyA") {
      await label(page, "One-button tricks: A held, then E (SPIN)");
      await page.screenshot({ path: "e2e/__screenshots__/one-button-336-spin.png" });
    }
    await page.keyboard.up("KeyE");
    await page.keyboard.up(key);
    await runUntil(page, (s) => s.style == null, 10000);
  }
  await pause(page, false);
});

test("keyboard: One-button tricks: F with D down snaps in the neutral stance; Q snaps take (edge) Grind, then Soul", async ({ page }) => {
  await ready(page);
  // GRIND with a direction: the neutral stance.
  await toRail(page);
  await page.keyboard.down("KeyD");
  await page.keyboard.down("KeyF");
  await runUntil(page, (s) => s.state === "grind", 15000);
  let s = await page.evaluate(() => window.__atl.skater);
  expect(s.grind.stance).toBe("n");
  expect(s.trick.name).toBe("Rail Grind");
  await page.keyboard.up("KeyF");
  await page.keyboard.up("KeyD");

  // TRICK snaps: the grind set in order.
  const names = [];
  for (let i = 0; i < 2; i += 1) {
    await toRail(page);
    await page.keyboard.down("KeyQ");
    await runUntil(page, (s) => s.state === "grind", 15000);
    s = await page.evaluate(() => window.__atl.skater);
    names.push(s.trick.name);
    if (i === 1) {
      await label(page, "One-button tricks: the second Q snap");
      await page.screenshot({ path: "e2e/__screenshots__/one-button-336-soul.png" });
    }
    await page.keyboard.up("KeyQ");
    await runUntil(page, (s) => s.state !== "grind", 15000);
  }
  expect(names).toEqual(["Rail Grind", "Rail Soul Grind"]);
  await pause(page, false);
});
