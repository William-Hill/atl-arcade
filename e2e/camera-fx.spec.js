import { expect, test } from "@playwright/test";

// Camera effects (#253): the speed FOV, the landing dip, and the
// reduced-motion gate, in a real browser.

const PUSH_JUMP = [
  { frames: 150, input: { push: true } },
  { frames: 1, input: { jump: true } },
  { frames: 90, input: {} },
];

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

async function boot(page, query = "") {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });
}

// Runs a script and samples the camera effects on every frame.
async function sampleScript(page, script) {
  return page.evaluate(async (entries) => {
    const samples = [];
    let on = true;
    const tick = () => {
      if (!on) return;
      const fx = window.__atl.cameraFx;
      samples.push({ fov: window.__atl.fov, base: fx.baseFov, offFov: fx.fov, up: fx.up, right: fx.right, roll: fx.roll, flash: fx.flash });
      requestAnimationFrame(tick);
    };
    const done = window.__atl.runScript(entries);
    requestAnimationFrame(tick);
    const end = await done;
    on = false;
    return { samples, speed: end.speed };
  }, script);
}

test("the speed FOV widens the view and the landing dips the camera", async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);

  // At rest after a reset: no offset, the base FOV.
  await sampleScript(page, [{ frames: 30, input: {} }]);
  const rest = await page.evaluate(() => ({ fov: window.__atl.fov, fx: window.__atl.cameraFx }));
  expect(rest.fx.fov).toBe(0);
  expect(rest.fx.up).toBe(0);
  expect(rest.fx.roll).toBe(0);
  expect(rest.fov).toBe(rest.fx.baseFov);
  expect(rest.fx.reduced).toBe(false);

  const { samples } = await sampleScript(page, PUSH_JUMP);
  const wide = Math.max(...samples.map((s) => s.offFov));
  const low = Math.min(...samples.map((s) => s.up));
  // The camera FOV is the base plus the offset on every frame.
  for (const s of samples) expect(s.fov).toBeCloseTo(s.base + s.offFov, 6);
  expect(wide).toBeGreaterThan(2);
  expect(wide).toBeLessThanOrEqual(7.01);
  // A flat hop lands at about 5 m/s: a small dip, no shake.
  expect(low).toBeLessThan(-0.01);
  expect(low).toBeGreaterThan(-0.22);
  expect(Math.max(...samples.map((s) => Math.abs(s.right)))).toBe(0);

  await page.screenshot({ path: "e2e/.output/camera-fx-speed.png" });

  // A reset puts every offset back to 0.
  await sampleScript(page, [{ frames: 30, input: {} }]);
  const after = await page.evaluate(() => ({ fov: window.__atl.fov, fx: window.__atl.cameraFx }));
  expect(after.fx.fov).toBe(0);
  expect(after.fov).toBe(after.fx.baseFov);
  expect(errors).toEqual([]);
});

test("?camfx=0 keeps only a smaller speed FOV", async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page, "?camfx=0");
  expect(await page.evaluate(() => window.__atl.cameraFx.reduced)).toBe(true);
  const { samples } = await sampleScript(page, PUSH_JUMP);
  for (const s of samples) {
    expect(s.up).toBe(0);
    expect(s.right).toBe(0);
    expect(s.roll).toBe(0);
    expect(s.flash).toBe(0);
  }
  expect(Math.max(...samples.map((s) => s.offFov))).toBeLessThanOrEqual(3.51);
  expect(errors).toEqual([]);
});

test("prefers-reduced-motion turns the effects off", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page);
  expect(await page.evaluate(() => window.__atl.cameraFx.reduced)).toBe(true);
});

test("a gap event punches the view in and shows the flash layer", async ({ page }) => {
  const errors = collectErrors(page);
  await boot(page);
  const shown = await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.__atl.events.push({ type: "gap" });
        let peak = { flash: 0, opacity: 0, fov: 0 };
        let n = 0;
        const tick = () => {
          const fx = window.__atl.cameraFx;
          const opacity = Number(document.querySelector('[data-atl="screen-flash"]').style.opacity);
          peak = { flash: Math.max(peak.flash, fx.flashShown), opacity: Math.max(peak.opacity, opacity), fov: Math.min(peak.fov, fx.fov) };
          n += 1;
          if (n < 20) requestAnimationFrame(tick);
          else resolve(peak);
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(shown.flash).toBeGreaterThan(0.1);
  expect(shown.opacity).toBeGreaterThan(0.1);
  expect(shown.fov).toBeLessThan(-1);
  expect(errors).toEqual([]);
});
