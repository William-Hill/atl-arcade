import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createLevelEnv } from "../src/level/ground.js";
import { chainStrips, followLineScript } from "../src/playtest/trail-script.js";
import { CROWD } from "../src/sim/npc/crowd.js";

// M1-09: NPCs on the BeltLine. Skaters, joggers, cyclists, dog walkers, and
// families ride the trail; walkers and joggers use the park paths.

const LEVEL = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/level.json", import.meta.url), "utf8"));

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

async function open(page, query) {
  await page.goto(`/?level=beltline-eastside&mute=1&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 60000 });
}

test("NPCs ride the trail in view of Nia, apart, and a bump never knocks one down", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "view=follow");
  await page.waitForFunction(() => window.__atl.skaterModel.loaded || window.__atl.skaterModel.error, null, { timeout: 60000 });
  const before = await page.evaluate(() => ({ count: window.__atl.npcs.count, onTrail: window.__atl.npcs.onTrail, drawCalls: window.__atl.npcs.drawCalls }));
  expect(before.onTrail).toBeGreaterThanOrEqual(20);
  expect(before.drawCalls).toBeLessThanOrEqual(6);

  // Nia rides 10 s north on the trail, through the crowd.
  const env = createLevelEnv(LEVEL);
  const [trail] = chainStrips(LEVEL.strips, "trail");
  const planned = followLineScript(trail, LEVEL.spawn, env, { frames: 600 });
  const actual = await page.evaluate((script) => window.__atl.runScript(script), planned.script);
  // The crowd does not change her ride: it still matches the pure controller.
  for (let i = 0; i < 3; i += 1) expect(Math.abs(actual.position[i] - planned.state.position[i])).toBeLessThan(0.01);

  const after = await page.evaluate(() => ({
    minGap: window.__atl.npcs.minGap,
    inView: window.__atl.npcs.inView(),
    maxLean: Math.max(...window.__atl.npcs.list.map((n) => n.lean)),
    rendererCalls: window.__atl.rendererInfo.calls,
  }));
  expect(after.minGap).toBeGreaterThanOrEqual(0);
  expect(after.maxLean).toBeLessThanOrEqual(CROWD.maxLean);
  expect(after.inView.length, `NPCs in view: ${after.inView.join(",")}`).toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "e2e/__screenshots__/beltline-npcs.png" });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("a close fixed view shows a group of NPCs on the trail", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "view=fixed&skater=capsule");
  // Aim at the trail NPC with the most trail NPCs within 25 m, from 8 m to
  // the side of the trail, and take the shot on the next frame.
  const shot = await page.evaluate(async () => {
    const trail = window.__atl.npcs.list.filter((n) => n.kind === "trail");
    const near = (a) => trail.filter((b) => Math.hypot(a.x - b.x, a.z - b.z) < 25).length;
    const t = trail.reduce((best, n) => (near(n) > near(best) ? n : best), trail[0]);
    const group = trail.filter((b) => Math.hypot(t.x - b.x, t.z - b.z) < 25);
    const cx = group.reduce((a, n) => a + n.x, 0) / group.length;
    const cz = group.reduce((a, n) => a + n.z, 0) / group.length;
    // The trail direction near the group, from its two farthest members.
    const [a, b] = [group[0], group[group.length - 1]];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const side = [-(b.z - a.z) / len, (b.x - a.x) / len];
    window.__atl.setFixedCamera(cx + side[0] * 14, 4, cz + side[1] * 14, cx, 0.8, cz);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { group: group.length, types: [...new Set(group.map((n) => n.type))], inView: window.__atl.npcs.inView().length };
  });
  expect(shot.inView).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: "e2e/__screenshots__/beltline-npcs-close.png" });
  expect(errors).toEqual([]);
});

test("?npcs=0 leaves the crowd out", async ({ page }) => {
  await open(page, "view=fixed&skater=capsule&npcs=0");
  expect(await page.evaluate(() => window.__atl.npcs)).toBeNull();
});
