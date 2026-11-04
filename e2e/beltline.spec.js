import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createSkateState, runScript } from "../src/sim/skate/controller.js";
import { createLevelEnv } from "../src/level/ground.js";
import { pointInRings } from "../src/level/geo/geo-ground.js";
import { chainStrips, followLineScript } from "../src/playtest/trail-script.js";
import { buildingSpan, terrainOf } from "../src/level/geo/terrain.js";

// M1-03: the BeltLine Eastside Trail block from OpenStreetMap loads in the
// shell, Nia skates on the trail, and the camera shows the real block.

const LEVEL = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/level.json", import.meta.url), "utf8"));

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

// A point inside a footprint: a vertex moved 1.5 m toward the centroid,
// checked with the same polygon test as the sampler.
function insidePoint(b) {
  const n = b.outer.length;
  const c = b.outer.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n], [0, 0]);
  for (const [x, z] of b.outer) {
    const d = Math.hypot(c[0] - x, c[1] - z) || 1;
    const p = [x + ((c[0] - x) / d) * 1.5, z + ((c[1] - z) / d) * 1.5];
    if (pointInRings(p[0], p[1], [b.outer, ...(b.holes ?? [])])) return p;
  }
  throw new Error(`no inside point for ${b.id}`);
}

async function open(page, query) {
  await page.goto(`/?level=beltline-eastside&mute=1&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
  // The landmark towers load after the level; wait for them unless ?landmarks=0.
  if (!query.includes("landmarks=0")) {
    await page.waitForFunction(() => window.__atl.level.landmarks && window.__atl.level.landmarks.towers >= 2, null, { timeout: 60000 });
  }
  // The street kit loads after the level; wait for it unless ?props=0.
  if (!query.includes("props=0")) {
    await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 60000 });
  }
}

test("the BeltLine block loads with Rapier colliders on every merged mesh", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "view=fixed");
  const info = await page.evaluate(() => ({
    level: { name: window.__atl.level.name, format: window.__atl.level.format, ids: window.__atl.level.ids, stats: window.__atl.level.stats },
    collidersById: window.__atl.physics.collidersById,
    colliderCount: window.__atl.physics.colliderCount,
    renderer: window.__atl.rendererInfo,
  }));
  expect(info.level.name).toBe("beltline-eastside");
  expect(info.level.format).toBe("geo-level/1");
  expect(info.level.stats.buildings).toBeGreaterThan(500);
  expect(info.level.stats.strips.trail).toBeGreaterThan(0);
  for (const id of info.level.ids) expect(info.collidersById[id], `collider for ${id}`).toBeGreaterThan(0);
  expect(info.colliderCount).toBe(info.level.ids.length);
  // M1-08: the street kit props loaded. #89: all props are one batch, with
  // one instance per prop and an LOD for each prop.
  const props = await page.evaluate(() => window.__atl.level.props);
  expect(props.error).toBeNull();
  expect(props.count).toBeGreaterThan(1000);
  expect(props.instances).toBeGreaterThan(1000);
  expect(props.kinds).toBeGreaterThan(10);
  expect(props.drawn).toBeGreaterThan(0);
  expect(props.drawn).toBeLessThan(props.instances);
  // M2-01: the Ponce City Market tower with its rooftop sign, and the Krog
  // Street Market front (both from img2threejs).
  const landmarks = await page.evaluate(() => window.__atl.level.landmarks);
  expect(landmarks).toMatchObject({ towers: 2, signs: 1 });
  expect(landmarks.triangles).toBeGreaterThan(1000);
  // Merged meshes: the draw calls stay far under one per building.
  expect(info.renderer.calls).toBeLessThan(120);
  await page.screenshot({ path: "e2e/__screenshots__/beltline-fixed.png" });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("the ground sampler finds the trail, a street, a sidewalk, and a building wall", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "view=fixed&skater=capsule");
  const mid = (s) => {
    const i = Math.floor((s.points.length - 1) / 2);
    const [a, b] = [s.points[i], s.points[i + 1]];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  const probes = {
    trail: mid(LEVEL.strips.find((s) => s.kind === "trail" && s.points.length > 10)),
    street: mid(LEVEL.strips.find((s) => s.kind === "street" && s.highway === "residential")),
    sidewalk: mid(LEVEL.strips.find((s) => s.kind === "sidewalk")),
  };
  const ponce = LEVEL.buildings.find((b) => b.name === "Ponce City Market");
  const result = await page.evaluate(
    ({ probes, pcm }) => {
      const out = {};
      for (const [k, [x, z]] of Object.entries(probes)) out[k] = window.__atl.level.sample(x, z);
      out.pcm = window.__atl.level.sample(pcm[0], pcm[1]);
      return out;
    },
    { probes, pcm: insidePoint(ponce) },
  );
  // The browser sampler is the same pure sampler as in node, on the terrain.
  const env = createLevelEnv(LEVEL, { props: false });
  const ground = terrainOf(LEVEL);
  expect(result.trail.height).toBeCloseTo(LEVEL.surfaces.trail + ground.height(...probes.trail), 4);
  expect(result.street.height).toBeGreaterThanOrEqual(LEVEL.surfaces.street + ground.height(...probes.street) - 1e-4);
  expect(result.sidewalk.height).toBeGreaterThanOrEqual(LEVEL.surfaces.sidewalk + ground.height(...probes.sidewalk) - 1e-4);
  expect(result.pcm.id).toBe(ponce.id);
  expect(result.pcm.height).toBeCloseTo(buildingSpan(LEVEL, ponce).top, 4);
  expect(result.pcm.height).toBeCloseTo(env.sampleGround(...insidePoint(ponce)).height, 4);
  expect(errors).toEqual([]);
});

// North along the trail from the spawn. The script comes from the pure
// controller with a trail follower; the browser replays it.
test("Nia skates north on the Eastside Trail and the run matches the pure controller", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "view=follow");
  await page.waitForFunction(() => window.__atl.skaterModel.loaded || window.__atl.skaterModel.error, null, { timeout: 60000 });
  expect(await page.evaluate(() => window.__atl.skaterModel.error)).toBeNull();

  const env = createLevelEnv(LEVEL);
  const [trail] = chainStrips(LEVEL.strips, "trail");
  const planned = followLineScript(trail, LEVEL.spawn, env, { frames: 600 });
  const halfWidth = LEVEL.strips.find((s) => s.kind === "trail").width / 2;
  expect(planned.offTrack).toBeLessThan(halfWidth);

  const actual = await page.evaluate((script) => window.__atl.runScript(script), planned.script);
  for (let i = 0; i < 3; i += 1) expect(Math.abs(actual.position[i] - planned.state.position[i])).toBeLessThan(0.01);
  const moved = Math.hypot(actual.position[0] - LEVEL.spawn.position[0], actual.position[2] - LEVEL.spawn.position[2]);
  expect(moved).toBeGreaterThan(50);
  // She went north (-z), she did not respawn, and she ends on the trail.
  expect(actual.position[2]).toBeLessThan(LEVEL.spawn.position[2] - 50);
  expect(actual.stats.respawns).toBe(0);
  const under = await page.evaluate(([x, z, y]) => window.__atl.level.sample(x, z, y), [actual.position[0], actual.position[2], actual.position[1]]);
  expect(LEVEL.strips.find((s) => s.id === under.id)?.kind, `surface under her: ${under.id}`).toBe("trail");
  // On the terrain, her height is the trail top under her.
  expect(actual.position[1]).toBeCloseTo(under.height, 5);

  // Let the follow camera settle, then save the evidence.
  await page.waitForTimeout(800);
  await page.screenshot({ path: "e2e/__screenshots__/beltline-trail.png" });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

// Evidence that the block is the real one: fixed cameras on three real
// places along the trail.
const VIEWS = [
  { name: "ponce-city-market", cam: [-60, 14, -700, -218, 18, -874] },
  { name: "ponce-city-market-tower", cam: [-120, 70, -760, -219, 48, -915] },
  { name: "krog-street-market-front", cam: [-14, 3, 862, -49, 7, 857] },
  { name: "fourth-ward-park", cam: [380, 40, 120, 200, 0, -150], query: "fog=0" },
  { name: "krog-street-market", cam: [-20, 18, 760, -72, 4, 850] },
  { name: "overview", cam: [900, 900, 1100, 0, 0, 0], query: "fog=0" },
  // FORTH Hotel, 800 Rankin St NE: a 16-story tower (issue #88).
  { name: "forth-hotel", cam: [90, 30, -300, -44, 28, -435] },
];

for (const v of VIEWS) {
  test(`screenshot of the real block: ${v.name}`, async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, `view=fixed&skater=capsule&cam=${v.cam.join(",")}${v.query ? `&${v.query}` : ""}`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/__screenshots__/beltline-${v.name}.png` });
    expect(errors).toEqual([]);
  });
}

test("the screen shows the OpenStreetMap attribution (ODbL)", async ({ page }) => {
  await open(page, "view=fixed&skater=capsule");
  await expect(page.locator("#attribution")).toBeVisible();
  await expect(page.locator("#attribution")).toContainText("OpenStreetMap contributors");
});

test("the greybox page shows no map attribution", async ({ page }) => {
  await page.goto("/?view=fixed");
  await page.waitForFunction(() => window.__atl && window.__atl.ready, null, { timeout: 20000 });
  await expect(page.locator("#attribution")).toBeHidden();
});

// She also skates on a real street and a real sidewalk: the longest
// residential street and the longest sidewalk in the block.
function length(points) {
  let n = 0;
  for (let i = 0; i < points.length - 1; i += 1) n += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  return n;
}

for (const { kind, filter } of [
  { kind: "street", filter: (s) => s.kind === "street" && s.highway === "residential" },
  { kind: "sidewalk", filter: (s) => s.kind === "sidewalk" },
]) {
  test(`Nia skates along a real ${kind}`, async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, "view=follow");
    const strip = LEVEL.strips.filter(filter).sort((a, b) => length(b.points) - length(a.points))[0];
    const [a, b] = strip.points;
    const env = createLevelEnv(LEVEL);
    const [mx, mz] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const start = { position: [mx, env.sampleGround(mx, mz).height, mz], yaw: Math.atan2(-(b[1] - a[1]), b[0] - a[0]) };
    const planned = followLineScript(strip.points, start, env, { frames: 180, cruise: 5 });
    const actual = await page.evaluate(({ script, start }) => window.__atl.runScript(script, start), { script: planned.script, start });
    for (let i = 0; i < 3; i += 1) expect(Math.abs(actual.position[i] - planned.state.position[i])).toBeLessThan(0.01);
    expect(Math.hypot(actual.position[0] - start.position[0], actual.position[2] - start.position[2])).toBeGreaterThan(8);
    expect(actual.stats.respawns).toBe(0);
    const under = await page.evaluate(([x, z, y]) => window.__atl.level.sample(x, z, y), [actual.position[0], actual.position[2], actual.position[1]]);
    expect(LEVEL.strips.find((s) => s.id === under.id)?.kind, `surface under her: ${under.id}`).toBe(kind);
    expect(actual.position[1]).toBeCloseTo(under.height, 5);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `e2e/__screenshots__/beltline-${kind}.png` });
    expect(errors).toEqual([]);
  });
}
