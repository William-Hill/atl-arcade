import { expect, test } from "@playwright/test";

// The Autopilot bridge (src/autopilot/) loads only with ?autopilot=1. These
// tests need no agent service: the bridge points at a closed port, and the
// tests call its ops directly through window.__autopilot.handle().

const CLOSED = "ws://127.0.0.1:9/v1/bridge";

async function ready(page, query) {
  await page.goto(`/?mute=1${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });
}

test("the normal page does not load the bridge", async ({ page }) => {
  const scripts = [];
  page.on("request", (r) => scripts.push(r.url()));
  await ready(page, "");
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__autopilot)).toBeUndefined();
  expect(scripts.filter((u) => u.includes("/src/autopilot/"))).toEqual([]);
});

test("with ?autopilot=1 the bridge loads and answers ops from the live game", async ({ page }) => {
  const scripts = [];
  page.on("request", (r) => scripts.push(r.url()));
  await ready(page, `&autopilot=1&autopilot_url=${encodeURIComponent(CLOSED)}`);
  await page.waitForFunction(() => window.__autopilot, null, { timeout: 10000 });
  expect(scripts.some((u) => u.includes("/src/autopilot/autopilot-bridge.js"))).toBe(true);

  const hello = await page.evaluate(() => window.__autopilot.hello());
  expect(hello.engine).toBe("threejs");
  expect(hello.share).toBe(false);
  expect(hello.project).toBe("atl-arcade");

  const pose = await page.evaluate(() => window.__autopilot.handle("pose", {}));
  expect(pose.path).toBe("/Scene/skater");
  expect(pose.on_ground).toBe(true);

  const rails = await page.evaluate(() => window.__autopilot.handle("find", { class: "rail" }));
  expect(rails.objects.length).toBeGreaterThan(0);

  const view = await page.evaluate(() => window.__autopilot.handle("view", {}));
  expect(view.visible.length).toBeGreaterThan(0);
  expect(view.camera.vfov).toBeCloseTo(60, 1);

  const screen = await page.evaluate(() => window.__autopilot.handle("screen", {}));
  expect(Object.keys(screen.texts).length).toBeGreaterThan(0);
});

test("a held key from the bridge reaches the game as a KeyboardEvent and moves the skater", async ({ page }) => {
  await ready(page, `&autopilot=1&autopilot_url=${encodeURIComponent(CLOSED)}`);
  await page.waitForFunction(() => window.__autopilot, null, { timeout: 10000 });
  const start = await page.evaluate(() => window.__atl.skater.position[0]);
  await page.evaluate(() => window.__autopilot.handle("key", { key: "W", mode: "hold", lease: 10 }));
  try {
    await expect.poll(() => page.evaluate(() => window.__atl.skater.position[0]), { timeout: 10000 }).toBeGreaterThan(start + 1);
  } finally {
    await page.evaluate(() => window.__autopilot.handle("key", { mode: "release_all" }));
  }
  await page.screenshot({ path: "e2e/.output/autopilot-key-hold.png" });
});

test("the bridge's move hook steers the skater toward a direction", async ({ page }) => {
  await ready(page, `&autopilot=1&autopilot_url=${encodeURIComponent(CLOSED)}`);
  await page.waitForFunction(() => window.__autopilot, null, { timeout: 10000 });
  // Kit +Y is the native +x: the spawn heading. Then steer to kit -X (native +z).
  const result = await page.evaluate(() => window.__autopilot.handle("move", { direction: { X: -1, Y: 0, Z: 0 }, seconds: 2 }));
  expect(result.via).toBe("game");
  expect(result.moved).toBeGreaterThan(50);
  const pose = await page.evaluate(() => window.__autopilot.handle("pose", {}));
  // body_yaw turns from the spawn heading toward 180 (kit -X)
  expect(Math.abs(pose.body_yaw)).toBeGreaterThan(120);
});

test("the bridge refuses an agent service on another host", async ({ page }) => {
  await ready(page, `&autopilot=1&autopilot_url=${encodeURIComponent("wss://example.com/v1/bridge")}`);
  await page.waitForFunction(() => window.__autopilot, null, { timeout: 10000 });
  expect(await page.evaluate(() => window.__autopilot.state)).toBe("refused");
});
