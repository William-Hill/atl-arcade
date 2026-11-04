import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createLevelEnv } from "../src/level/ground.js";
import { chainStrips, followLineScript } from "../src/playtest/trail-script.js";

// #134: NPC skaters on the BeltLine. They ride the same pure controller as
// the player, with the Nia and Marcus models in other outfits, and they do
// tricks. They never change the player's ride or combo.

const LEVEL = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const TRAIL_IDS = new Set(LEVEL.strips.filter((s) => s.kind === "trail").map((s) => s.id));

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
}

async function waitForSkaters(page) {
  await page.waitForFunction(() => window.__atl.skaters && window.__atl.skaters.loaded + window.__atl.skaters.failed === window.__atl.skaters.count, null, { timeout: 90000 });
}

test("NPC skaters ride the trail in other outfits and do tricks, with no fall and no bonk", async ({ page }) => {
  test.setTimeout(240000);
  const errors = collectErrors(page);
  await open(page, "view=fixed");
  await waitForSkaters(page);
  const start = await page.evaluate(() => ({ count: window.__atl.skaters.count, failed: window.__atl.skaters.failed, ticks: window.__atl.ticks, list: window.__atl.skaters.list }));
  expect(start.count).toBeGreaterThanOrEqual(4);
  expect(start.failed).toBe(0);
  // Two models, each in more than one outfit.
  expect(new Set(start.list.map((n) => n.model))).toEqual(new Set(["nia", "marcus"]));
  expect(new Set(start.list.map((n) => n.outfit)).size).toBe(start.count);

  // Let them ride for 15 s of simulation.
  await page.waitForFunction((t) => window.__atl.ticks >= t + 15 * 60, start.ticks, { timeout: 180000 });
  const after = await page.evaluate(() => window.__atl.skaters.list);
  for (const n of after) {
    const before = start.list.find((b) => b.id === n.id);
    expect(n.stats.distance - before.stats.distance, `${n.id} rode`).toBeGreaterThan(40);
    expect(n.stats.falls + n.stats.respawns, `${n.id} falls`).toBe(0);
    expect(n.stats.bonks, `${n.id} wall bonks`).toBe(0);
    // On the trail, on a skater clip.
    if (n.state === "rolling") expect(TRAIL_IDS.has(n.groundId), `${n.id} on ${n.groundId}`).toBe(true);
  }
  const jumps = after.reduce((a, n) => a + n.stats.jumps, 0);
  const dances = after.reduce((a, n) => a + n.stats.dances, 0);
  expect(jumps, "jumps").toBeGreaterThanOrEqual(2);
  expect(dances, "dances").toBeGreaterThanOrEqual(2);

  // A close view of the nearest NPC skater, from 6 m to its side.
  const shot = await page.evaluate(async () => {
    const list = window.__atl.skaters.list;
    const spawn = window.__atl.level.spawn.position;
    const n = list.reduce((a, b) => (Math.hypot(b.position[0] - spawn[0], b.position[2] - spawn[2]) < Math.hypot(a.position[0] - spawn[0], a.position[2] - spawn[2]) ? b : a));
    const [x, y, z] = n.position;
    window.__atl.setFixedCamera(x + 5, y + 2.4, z + 3, x, y + 0.9, z);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const now = window.__atl.skaters.list.find((m) => m.id === n.id);
    return { id: n.id, visible: now.visible, clip: now.clip, drawn: window.__atl.skaters.drawn, drawCalls: window.__atl.skaters.drawCalls };
  });
  expect(shot.visible, `${shot.id} visible`).toBe(true);
  expect(shot.clip, `${shot.id} plays a clip`).toBeTruthy();
  // Two draw calls for each NPC skater near the camera (the skin and the ink hull).
  expect(shot.drawCalls).toBe(shot.drawn * 2);
  await page.screenshot({ path: "e2e/__screenshots__/beltline-npc-skaters.png" });
  // The nearest Marcus NPC, in its outfit.
  const marcus = await page.evaluate(async () => {
    const spawn = window.__atl.level.spawn.position;
    const list = window.__atl.skaters.list.filter((m) => m.model === "marcus");
    const n = list.reduce((a, b) => (Math.hypot(b.position[0] - spawn[0], b.position[2] - spawn[2]) < Math.hypot(a.position[0] - spawn[0], a.position[2] - spawn[2]) ? b : a));
    const [x, y, z] = n.position;
    window.__atl.setFixedCamera(x - 4, y + 2.2, z + 4, x, y + 0.9, z);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__atl.skaters.list.find((m) => m.id === n.id).visible;
  });
  expect(marcus).toBe(true);
  await page.screenshot({ path: "e2e/__screenshots__/beltline-npc-skaters-marcus.png" });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("the NPC skaters never change the player's ride or combo", async ({ page }) => {
  test.setTimeout(240000);
  // Nia rides 15 s north on the trail through the NPC skaters, with dances.
  const env = createLevelEnv(LEVEL);
  const [trail] = chainStrips(LEVEL.strips, "trail");
  const planned = followLineScript(trail, LEVEL.spawn, env, { frames: 900, cruise: 6 });
  const script = planned.script.flatMap((e, i) => (i % 6 === 3 ? [e, { frames: 1, input: { ...e.input, style1: true } }] : [e]));
  const ride = async (query) => {
    await open(page, `view=fixed&skater=capsule&${query}`);
    return page.evaluate(async (s) => {
      const end = await window.__atl.runScript(s);
      return { position: end.position, combo: end.combo, bails: window.__atl.events.filter((e) => e.type === "bail").length };
    }, script);
  };
  const withSkaters = await ride("skaters=1");
  const without = await ride("skaters=0");
  expect(withSkaters.bails).toBe(0);
  for (let i = 0; i < 3; i += 1) expect(withSkaters.position[i]).toBeCloseTo(without.position[i], 6);
  expect(withSkaters.combo).toEqual(without.combo);
});

test("?skaters=0 turns the NPC skaters off", async ({ page }) => {
  await open(page, "view=fixed&skater=capsule&skaters=0");
  expect(await page.evaluate(() => window.__atl.skaters)).toBeNull();
});
