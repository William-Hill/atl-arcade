import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { GRIND } from "../src/sim/skate/constants.js";

const BALANCE = GRIND.balanceDrift / GRIND.balanceCorrect;

// Approach the straight rail (x from -20 to -8 at z = -2) from the west,
// hold grind with a balance correction, ride it off the end, land rolling.
const STRAIGHT_RAIL = [
  { frames: 90, input: { push: true } },
  { frames: 150, input: { grind: true, steer: BALANCE } },
  { frames: 60, input: {} },
];

// A free-skate loop from the west end of the straight rail: a grind with no
// balance input (a fall), a U-turn back, a balanced grind, a U-turn, a third
// approach, about 24 seconds. Verified in node: 2 snaps, 1 fall.
const BAL = BALANCE;
const FREE_SKATE = [
  { frames: 90, input: { push: true } },
  { frames: 120, input: { grind: true } },
  { frames: 60, input: {} },
  { frames: 80, input: { steer: 1 } },
  { frames: 60, input: { push: true } },
  { frames: 30, input: {} },
  { frames: 80, input: { steer: 1 } },
  { frames: 30, input: { push: true } },
  { frames: 150, input: { grind: true, steer: BAL } },
  { frames: 60, input: {} },
  { frames: 80, input: { steer: 1 } },
  { frames: 60, input: { push: true } },
  { frames: 30, input: {} },
  { frames: 80, input: { steer: 1 } },
  { frames: 60, input: { push: true, grind: true } },
  { frames: 120, input: { grind: true } },
  { frames: 60, input: {} },
  { frames: 80, input: { steer: 1 } },
  { frames: 60, input: { push: true } },
  { frames: 60, input: {} },
];

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

async function ready(page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });
}

test("a scripted approach grinds the straight rail end to end and lands rolling", async ({ page }) => {
  const errors = collectErrors(page);
  await ready(page);

  const result = await page.evaluate(async (script) => {
    const end = await window.__atl.runScript(script, { position: [-26, 0, -2], yaw: 0 });
    return { end, events: window.__atl.events };
  }, STRAIGHT_RAIL);

  const snap = result.events.find((e) => e.type === "snap");
  expect(snap).toBeTruthy();
  expect(snap.id).toBe("rail-straight");
  expect(snap.s).toBeLessThan(2.5);

  const exit = result.events.find((e) => e.type === "exit");
  expect(exit).toBeTruthy();
  expect(exit.reason).toBe("end");
  expect(exit.position[0]).toBeGreaterThan(-8.2);

  const land = result.events.find((e) => e.type === "land" && e.tick > exit.tick);
  expect(land).toBeTruthy();
  expect(land.groundId).toBe("street");
  expect(result.events.filter((e) => e.type === "fall")).toEqual([]);
  expect(result.end.state).toBe("rolling");
  expect(result.end.stats.falls).toBe(0);
  expect(result.end.stats.exits).toBe(1);

  await page.screenshot({ path: "e2e/__screenshots__/grind-straight-rail-end.png" });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("the capsule rides the rail mid-grind", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    window.__atl.runScript([{ frames: 90, input: { push: true } }, { frames: 60, input: { grind: true, steer: 0.25 } }], { position: [-26, 0, -2], yaw: 0 });
  });
  await page.waitForFunction(() => window.__atl.skater.state === "grind" && window.__atl.skater.grind.s > 2, null, { timeout: 10000 });
  const s = await page.evaluate(() => ({ y: window.__atl.skater.position[1], z: window.__atl.skater.position[2], id: window.__atl.skater.grind.id }));
  expect(s.id).toBe("rail-straight");
  expect(s.y).toBeCloseTo(0.6, 2);
  expect(s.z).toBeCloseTo(-2, 2);
  await page.screenshot({ path: "e2e/__screenshots__/grind-mid-rail.png" });
});

test("falls per minute are logged for a scripted free-skate loop", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async (script) => {
    const end = await window.__atl.runScript(script, { position: [-26, 0, -2], yaw: 0 });
    return { end, events: window.__atl.events };
  }, FREE_SKATE);

  const seconds = result.end.tick / 60;
  const fallsPerMinute = (result.end.stats.falls / seconds) * 60;
  const report = {
    date: new Date().toISOString(),
    script: "e2e/grind.spec.js FREE_SKATE",
    ticks: result.end.tick,
    seconds: Number(seconds.toFixed(2)),
    snaps: result.end.stats.snaps,
    exits: result.end.stats.exits,
    falls: result.end.stats.falls,
    fallsPerMinute: Number(fallsPerMinute.toFixed(2)),
    grindSeconds: Number(result.end.stats.grindTime.toFixed(2)),
    events: result.events.filter((e) => e.type !== "land").map((e) => ({ tick: e.tick, type: e.type, id: e.id, reason: e.reason })),
  };
  mkdirSync("reports", { recursive: true });
  writeFileSync("reports/m0-05-falls.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(`falls per minute: ${report.fallsPerMinute} (${report.falls} falls in ${report.seconds} s, ${report.snaps} snaps)`);

  expect(result.end.stats.snaps).toBeGreaterThanOrEqual(1);
  expect(seconds).toBeGreaterThan(20);
  await page.screenshot({ path: "e2e/__screenshots__/grind-free-skate-end.png" });
});
