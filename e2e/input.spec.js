import { expect, test } from "@playwright/test";

async function ready(page) {
  await page.goto("/?mute=1");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });
}

test("the keyboard works with no gamepad and the source says keyboard", async ({ page }) => {
  await ready(page);
  expect(await page.evaluate(() => window.__atl.input.source)).toBe("keyboard");
  const start = await page.evaluate(() => window.__atl.skater.position[0]);
  await page.keyboard.down("ShiftLeft");
  await page.waitForTimeout(700);
  await page.keyboard.up("ShiftLeft");
  const end = await page.evaluate(() => window.__atl.skater.position[0]);
  expect(end - start).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.__atl.input.gamepadId)).toBeNull();
});

test("a connected gamepad is detected and drives the skater", async ({ page }) => {
  // Headless Chromium has no real pad: inject a fake standard gamepad.
  await page.addInitScript(() => {
    const pad = {
      id: "Fake Standard Pad",
      index: 0,
      connected: true,
      mapping: "standard",
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    window.__fakePad = pad;
    navigator.getGamepads = () => [pad, null, null, null];
  });
  await ready(page);

  const start = await page.evaluate(() => ({ x: window.__atl.skater.position[0], id: window.__atl.input.gamepadId }));
  expect(start.id).toBe("Fake Standard Pad");

  // Hold X (push) and push the stick left for a moment.
  await page.evaluate(() => {
    window.__fakePad.buttons[2] = { pressed: true, touched: true, value: 1 };
    window.__fakePad.axes[0] = -0.6;
  });
  await page.waitForTimeout(700);
  const mid = await page.evaluate(() => ({ x: window.__atl.skater.position[0], z: window.__atl.skater.position[2], yaw: window.__atl.skater.yaw, source: window.__atl.input.source }));
  await page.evaluate(() => {
    window.__fakePad.buttons[2] = { pressed: false, touched: false, value: 0 };
    window.__fakePad.axes[0] = 0;
  });

  expect(mid.source).toBe("gamepad");
  expect(mid.x - start.x).toBeGreaterThan(1);
  expect(mid.yaw).toBeGreaterThan(0.1); // stick left turns left

  // A (jump) on the pad.
  await page.evaluate(() => {
    window.__fakePad.buttons[0] = { pressed: true, touched: true, value: 1 };
  });
  await page.waitForFunction(() => window.__atl.skater.state === "air", null, { timeout: 2000 });
  await page.evaluate(() => {
    window.__fakePad.buttons[0] = { pressed: false, touched: false, value: 0 };
  });
  await page.screenshot({ path: "e2e/__screenshots__/input-gamepad.png" });
});
