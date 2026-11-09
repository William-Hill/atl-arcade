import { expect, test, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

// #133: what the walkers do besides a walk. Each test sends the fixed
// camera to a place (the walker pool scatters around the camera), finds a
// walker in the activity, and takes a picture of it at 14:00 in clear
// weather. The screenshots are in e2e/__screenshots__/peds-*.png.

const LEVEL = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const BUDGET = JSON.parse(readFileSync(new URL("../docs/perf/budget.json", import.meta.url), "utf8"));
const centroid = (name) => {
  const o = LEVEL.buildings.find((b) => b.name === name).outer;
  return [o.reduce((a, p) => a + p[0], 0) / o.length, o.reduce((a, p) => a + p[1], 0) / o.length];
};
const KROG = centroid("Krog Street Market");
const PCM = centroid("Ponce City Market");
const SPAWN = [LEVEL.spawn.position[0], LEVEL.spawn.position[2]];

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

async function open(page, query) {
  await page.goto(`/?level=beltline-eastside&mute=1&time=14&weather=clear&governor=0&view=fixed&minimap=0&skater=capsule&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 90000 });
  // The GLB people of the pbr look, when the look has them.
  await page.waitForFunction(() => !window.__atl.pedModels || window.__atl.pedModels.loaded || window.__atl.pedModels.error, null, { timeout: 120000 });
}

async function frames(page, n) {
  const start = await page.evaluate(() => window.__atl.frames);
  await page.waitForFunction((f) => window.__atl.frames >= f, start + n, { timeout: 120000 });
}

// Sends the camera high over (x, z): the pool scatters around it.
async function visit(page, [x, z]) {
  await page.evaluate(([x, z]) => window.__atl.setFixedCamera(x + 0.01, 30, z + 20, x, 0, z), [x, z]);
  await frames(page, 10);
}

// The tests of each activity, on a walker of window.__atl.peds.list.
const ACTIVITY = {
  sit: (w) => w.goal === "bench" && w.leg === "stay",
  bench: (w) => w.goal === "bench" && w.leg === "stay",
  bus: (w) => w.goal === "bus" && w.leg === "stay",
  shop: (w) => w.goal === "shop" && w.leg === "stay",
  talk: (w) => w.pose === 3,
  group: (w) => w.role === "member" && w.speed > 0.3,
  jog: (w) => w.pose === 4 && w.speed > 1.5,
  cheer: (w) => w.pose === 2,
};

// The live walker `id` if it is still in the activity `what`, else null.
async function walker(page, what, id) {
  const w = await page.evaluate((id) => window.__atl.peds.list.find((w) => w.id === id) ?? null, id);
  return w && ACTIVITY[what](w) ? w : null;
}

// Finds a live walker in the activity `what` anywhere in the pool, nearest
// to `at`, moves the camera to it in hops of under 60 m (a longer move
// scatters the pool again, PEDS.jump), and puts the camera `dist` m in front
// of it. Returns the walker or null.
// With `toward` ([x, z], a building), the camera is on the far side of the
// walker from it, so the building is behind the walker.
async function aimAt(page, what, at, { dist = 5.5, height = 1.7, side = 1.5, toward = null } = {}) {
  const list = await page.evaluate(() => window.__atl.peds.list);
  const pick = list.filter(ACTIVITY[what]).sort((a, b) => Math.hypot(a.x - at[0], a.z - at[1]) - Math.hypot(b.x - at[0], b.z - at[1]))[0];
  if (!pick) return null;
  let w = pick;
  for (let hop = 0; hop < 8; hop += 1) {
    const [ex, , ez] = await page.evaluate(() => window.__atl.cameraPosition);
    const d = Math.hypot(w.x - ex, w.z - ez);
    if (d < 40) break;
    const k = Math.min(1, 50 / d);
    const cx = ex + (w.x - ex) * k;
    const cz = ez + (w.z - ez) * k;
    await page.evaluate(([cx, cz, x, z]) => window.__atl.setFixedCamera(cx, 25, cz, x, 0, z), [cx, cz, w.x, w.z]);
    await frames(page, 1);
    w = await walker(page, what, pick.id);
    if (!w) return null;
  }
  // In front of the walker (fx, fz is the way it faces), a little to the side.
  let [fx, fz] = [w.fx, w.fz];
  if (toward) {
    const d = Math.hypot(w.x - toward[0], w.z - toward[1]) || 1;
    [fx, fz] = [(w.x - toward[0]) / d, (w.z - toward[1]) / d];
  }
  const cx = w.x + fx * dist - fz * side;
  const cz = w.z + fz * dist + fx * side;
  const look = toward ? [w.x - fx * 6, w.y + 2, w.z - fz * 6] : [w.x, w.y + 0.9, w.z];
  await page.evaluate((a) => window.__atl.setFixedCamera(...a), [cx, w.y + height, cz, ...look]);
  return w;
}

// Waits until a walker in the activity shows up, up to `tries` checks.
async function find(page, what, at, opts, tries = 8) {
  for (let i = 0; i < tries; i += 1) {
    const w = await aimAt(page, what, at, opts);
    if (w) return w;
    await frames(page, 10);
  }
  return null;
}

// A walker at a place of `kind`: first in the pool; else visit the places
// of `kind` nearest to `at`, in turn. Returns the walker or null.
async function findAtPlace(page, kind, at, opts, places = 4) {
  const now = await find(page, kind, at, opts, 2);
  if (now) return now;
  const list = await page.evaluate((k) => window.__atl.peds.places.filter((p) => p.kind === k), kind);
  list.sort((a, b) => Math.hypot(a.x - at[0], a.z - at[1]) - Math.hypot(b.x - at[0], b.z - at[1]));
  // One visit per 20 m: the slots of one stop or one door are close.
  const spots = [];
  for (const p of list) if (spots.length < places && spots.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 20)) spots.push(p);
  for (const p of spots) {
    await visit(page, [p.x, p.z]);
    const w = await find(page, kind, [p.x, p.z], opts, 2);
    if (w) return w;
  }
  return null;
}

async function shoot(page, name) {
  await frames(page, 3);
  await page.screenshot({ path: `e2e/__screenshots__/peds-${name}.png` });
}

test.describe("walker activities, desktop (#133)", () => {
  // The pbr look on SwiftShader is slow: a screenshot can take a minute.
  test.setTimeout(900000);

  for (const look of ["pbr", "toon"]) {
    test(`talk and stop at a shop door at Krog Street Market (${look})`, async ({ page }) => {
      const errors = collectErrors(page);
      await open(page, `quality=high&look=${look}`);
      // Three kinds of activity besides a walk, in one pool, after a short time.
      await visit(page, KROG);
      const seen = new Set();
      for (let i = 0; i < 20 && seen.size < 3; i += 1) {
        const a = await page.evaluate(() => window.__atl.peds.activities);
        for (const k of ["jog", "group", "talk", "sit", "shop", "bus"]) if (a[k] > 0) seen.add(k);
        await frames(page, 10);
      }
      expect([...seen].length, [...seen].join(",")).toBeGreaterThanOrEqual(3);

      expect(await find(page, "talk", KROG, { dist: 4.5, side: 2.5 }), "a talk at Krog Street Market").not.toBeNull();
      await shoot(page, `talk-krog-${look}`);
      expect(await findAtPlace(page, "shop", KROG, { dist: -4, side: 3 }), "a stop at a shop door near Krog Street Market").not.toBeNull();
      await shoot(page, `shop-krog-${look}`);
      expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
    });

    test(`sit on a bench by the trail (${look})`, async ({ page }) => {
      const errors = collectErrors(page);
      await open(page, `quality=high&look=${look}`);
      await visit(page, SPAWN);
      const sit = (await find(page, "sit", SPAWN, { dist: 3.5, height: 1.4, side: 1 })) ?? (await findAtPlace(page, "bench", SPAWN, { dist: 3.5, height: 1.4, side: 1 }));
      expect(sit, "a walker on a bench by the trail").not.toBeNull();
      await shoot(page, `sit-trail-${look}`);
      // Seated (POSE.sit).
      expect(sit.pose).toBe(1);
      expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
    });

    test(`wait at a bus stop (${look})`, async ({ page }) => {
      const errors = collectErrors(page);
      await open(page, `quality=high&look=${look}`);
      expect(await findAtPlace(page, "bus", PCM, { dist: 4.5, side: 2 }), "a walker at a bus stop").not.toBeNull();
      await shoot(page, `bus-${look}`);
      expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
    });
  }

  test("a group and a jogger on the trail, and a cheer for a big combo", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, "quality=high&look=pbr");
    await visit(page, SPAWN);
    expect(await find(page, "group", SPAWN, { dist: 6, side: 2.5 }), "a group on the trail").not.toBeNull();
    await shoot(page, "group-trail-pbr");
    expect(await find(page, "jog", SPAWN, { dist: 7, side: 2 }), "a jogger on the trail").not.toBeNull();
    await shoot(page, "jog-trail-pbr");

    // Nia stands at the spawn on the trail. A big combo: the walkers within
    // 22 m stop, turn to her, and cheer. A small one: no cheer.
    await page.evaluate(([x, z]) => window.__atl.setFixedCamera(x + 9, 5, z + 9, x, 1, z), SPAWN);
    await frames(page, 30);
    const before = await page.evaluate(() => window.__atl.peds.cheers);
    await page.evaluate(() => window.__atl.peds.cheer(300));
    await frames(page, 3);
    expect(await page.evaluate(() => window.__atl.peds.cheers)).toBe(before);
    await page.evaluate(() => window.__atl.peds.cheer(5000));
    await frames(page, 3);
    const cheer = await page.evaluate(() => ({ cheers: window.__atl.peds.cheers, now: window.__atl.peds.activities.cheer }));
    expect(cheer.cheers).toBeGreaterThan(before);
    expect(cheer.now).toBeGreaterThan(0);
    expect(await aimAt(page, "cheer", SPAWN, { dist: 6, side: 3, height: 2.2 })).not.toBeNull();
    await shoot(page, "cheer-trail-pbr");
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});

// The toon figures pose in the vertex shader: the same activities with the
// instanced figures only (no GLB people).
test("the toon figures sit and cheer (#133)", async ({ page }) => {
  test.setTimeout(300000);
  const errors = collectErrors(page);
  await open(page, "quality=high&look=toon&pedglb=0");
  await visit(page, SPAWN);
  expect(await find(page, "sit", SPAWN, { dist: 3.5, height: 1.4, side: 1 })).not.toBeNull();
  await shoot(page, "sit-trail-figure");
  await page.evaluate(([x, z]) => window.__atl.setFixedCamera(x + 9, 5, z + 9, x, 1, z), SPAWN);
  await frames(page, 30);
  await page.evaluate(() => window.__atl.peds.cheer(5000));
  await frames(page, 3);
  expect(await aimAt(page, "cheer", SPAWN, { dist: 6, side: 3, height: 2.2 })).not.toBeNull();
  await shoot(page, "cheer-trail-figure");
  expect(errors).toEqual([]);
});

const { defaultBrowserType, ...iphone } = devices["iPhone 15"]; // eslint-disable-line no-unused-vars

test.describe("walker activities, phone (#133)", () => {
  test.use(iphone);
  test.setTimeout(300000);

  test("the trail and a market on a phone, inside the phone budget", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, "quality=phone");
    const peds = await page.evaluate(() => ({ count: window.__atl.peds.count, drawCalls: window.__atl.peds.drawCalls }));
    // The phone walker count does not change (src/sim/peds.js PED_COUNT).
    expect(peds.count).toBeLessThanOrEqual(45);
    expect(peds.drawCalls).toBe(1);

    await visit(page, SPAWN);
    expect(await find(page, "group", SPAWN, { dist: 9, side: 3, height: 3 })).not.toBeNull();
    await shoot(page, "trail-phone");
    await visit(page, KROG);
    expect(await find(page, "talk", KROG, { dist: 8, side: 2, height: 2.5, toward: KROG })).not.toBeNull();
    await shoot(page, "market-phone");

    // The phone draw call and triangle caps of the perf budget (#185).
    const r = await page.evaluate(() => window.__atl.rendererInfo);
    expect(r.calls).toBeLessThanOrEqual(BUDGET.tiers.phone.calls);
    expect(r.triangles).toBeLessThanOrEqual(BUDGET.tiers.phone.triangles);
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});

