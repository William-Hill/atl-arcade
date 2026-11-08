import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Issue #113: the comic effects (src/render/effects/). The tests:
// - a picture of each effect in each look (?look=toon and ?look=pbr) on the
//   high tier, at 14:00 in clear weather. The hooks hold the effect still,
//   so the picture catches it;
// - the draw calls of the effects on each tier (reports/fx/draw-calls.json);
// - a ride into the edge fence at full push: the bonk starts an impact
//   frame from the controller flags;
// - prefers-reduced-motion turns the effects off, at the load and live.
// The walkers, the NPC skaters, and the moving cars are off, so the pictures
// are stable.

const BASE = "/?level=beltline-eastside&mute=1&time=14&weather=clear&governor=0&run=free&peds=0&skaters=0&traffic=0&minimap=0";
const EFFECTS = ["speed", "impact", "grind", "beat"];

async function ready(page) {
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 200000 });
}

async function nextFrames(page, n) {
  const f = await page.evaluate(() => window.__atl.frames);
  await page.waitForFunction(([f0, k]) => window.__atl.frames >= f0 + k, [f, n], { timeout: 400000 });
}

// Show one effect, held still. Returns the effect info.
async function show(page, kind) {
  await page.evaluate((k) => {
    const fx = window.__atl.effects;
    fx.clear();
    fx.hold(true);
    if (k === "all") for (const e of ["speed", "impact", "grind", "beat"]) fx.trigger(e);
    else fx.trigger(k);
  }, kind);
  await nextFrames(page, 2);
  return page.evaluate(() => window.__atl.effects.info);
}

async function off(page) {
  await page.evaluate(() => {
    window.__atl.effects.hold(false);
    window.__atl.effects.clear();
  });
  await nextFrames(page, 2);
}

// The draw calls of a frame, read 2 times (the frame loop resets the count).
async function calls(page) {
  const out = [];
  for (let i = 0; i < 2; i += 1) {
    await nextFrames(page, 1);
    out.push(await page.evaluate(() => window.__atl.rendererInfo.calls));
  }
  return Math.min(...out);
}

for (const look of ["toon", "pbr"]) {
  test(`a picture of each effect on the high tier (${look})`, async ({ page }) => {
    test.setTimeout(1800000);
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.goto(`${BASE}&quality=high&look=${look}`);
    await ready(page);
    expect(await page.evaluate(() => window.__atl.render.quality)).toBe("high");
    // Let the follow camera settle behind the skater. The high tier draws
    // about 1 frame in 3 to 10 s on the software GPU.
    await nextFrames(page, 6);
    const idle = await page.evaluate(() => window.__atl.effects.info);
    expect(idle.enabled).toBe(true);
    expect(idle.visible).toEqual({ screen: false, bursts: false });
    for (const kind of EFFECTS) {
      const info = await show(page, kind);
      if (kind === "speed") expect(info.lines).toBeGreaterThan(8);
      if (kind === "impact") {
        expect(info.spikes).toBe(16);
        // Held: frame 1 of 3 shows.
        expect(info.impactFrames).toBe(3);
      }
      if (kind === "grind" || kind === "beat") expect(info.bursts).toBe(2);
      await page.screenshot({ path: `e2e/__screenshots__/fx-${kind}-${look}.png`, timeout: 300000 });
      await off(page);
    }
    // An impact without the hold lasts 3 rendered frames, then stops.
    await page.evaluate(() => window.__atl.effects.trigger("impact"));
    await nextFrames(page, 5);
    expect(await page.evaluate(() => window.__atl.effects.info.impactFrames)).toBe(0);
    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });
}

test("the draw calls of the effects on each tier", async ({ page }) => {
  test.setTimeout(2400000);
  const budget = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync("docs/perf/budget.json", "utf8")));
  const rows = [];
  for (const [quality, look] of [["low", "toon"], ["phone", "toon"], ["phone", "pbr"], ["high", "toon"], ["high", "pbr"]]) {
    await page.goto(`${BASE}&quality=${quality}&look=${look}`);
    await ready(page);
    await nextFrames(page, 4);
    const idle = await calls(page);
    const info = await show(page, "all");
    const active = await calls(page);
    await off(page);
    const after = await calls(page);
    const key = look === "pbr" ? `${quality}/pbr` : quality;
    const cap = budget.tiers[key]?.calls ?? budget.tiers[quality].calls;
    rows.push({ quality, look, idle, active, added: active - idle, after, cap, policy: info.policy, lines: info.lines, spikes: info.spikes, bursts: info.bursts });
    if (quality === "low") {
      // Off on the low tier: no meshes draw.
      expect(info.enabled).toBe(false);
      expect(active - idle).toBe(0);
    } else {
      // At most 2 draw calls (the screen mesh and the burst mesh), and none
      // when no effect runs.
      expect(active - idle).toBeGreaterThan(0);
      expect(active - idle).toBeLessThanOrEqual(2);
      expect(after).toBe(idle);
    }
  }
  mkdirSync("reports/fx", { recursive: true });
  writeFileSync("reports/fx/draw-calls.json", `${JSON.stringify({ date: new Date().toISOString(), rows }, null, 2)}\n`);
});

test("a full-push ride into the edge fence starts an impact frame from the bonk flag", async ({ page }) => {
  test.setTimeout(300000);
  await page.goto(`${BASE}&quality=phone&look=toon`);
  await ready(page);
  const result = await page.evaluate(async () => {
    const { bounds } = window.__atl.level;
    const x = bounds.maxX - 45;
    const z = 176;
    const y = window.__atl.level.sample(x, z)?.height ?? 0;
    await window.__atl.runScript([{ frames: 420, input: { push: true } }], { position: [x, y, z], yaw: 0 });
    return window.__atl.effects.info;
  });
  expect(result.triggers.bonk).toBeGreaterThanOrEqual(1);
  expect(result.impacts).toBeGreaterThanOrEqual(1);
});

test("prefers-reduced-motion turns the effects off (at the load and live)", async ({ page }) => {
  test.setTimeout(1200000);
  // At the load: the policy is off, and the hooks draw nothing.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${BASE}&quality=high&look=pbr`);
  await ready(page);
  await nextFrames(page, 10);
  const idle = await calls(page);
  const info = await show(page, "all");
  expect(info.reducedMotion).toBe(true);
  expect(info.enabled).toBe(false);
  expect(info.policy).toMatchObject({ lines: 0, impact: 0, spikes: 0, burst: null });
  expect(info.visible).toEqual({ screen: false, bursts: false });
  expect(info.lines + info.spikes + info.bursts).toBe(0);
  expect(await calls(page)).toBe(idle);
  await page.screenshot({ path: "e2e/__screenshots__/fx-reduced-motion-pbr.png", timeout: 300000 });
  await off(page);

  // Live: the setting goes on while the effects run, and they stop.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await nextFrames(page, 2);
  const on = await show(page, "all");
  expect(on.enabled).toBe(true);
  expect(on.visible).toEqual({ screen: true, bursts: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await nextFrames(page, 3);
  const after = await page.evaluate(() => window.__atl.effects.info);
  expect(after.enabled).toBe(false);
  expect(after.visible).toEqual({ screen: false, bursts: false });
});
