import { expect, test } from "@playwright/test";
import { LANDMARKS, comboLine, park, rampRides, simulate, startAt, uv } from "./skatepark-ride.js";

// #222: the Historic Fourth Ward Skatepark (Thomas Taylor Memorial
// Skatepark) is a skate spot in the BeltLine level. The skater rides its
// ramps and grinds its rails and ledge with no fall through the ground, in
// both looks, and the combo line lands 2000 points or more in the zone of
// the landmark spot. The rides are planned in the pure simulation
// (skatepark-ride.js) and the page replays them tick for tick.

const SPOT = LANDMARKS.spots.find((s) => s.id === "historic-fourth-ward-skatepark");
const ID = "skatepark:h4w-skatepark";
// The pictures are JPEG files (about 0.3 MB each; a PNG is 1.4 MB).
const JPEG = 85;

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

// A clear afternoon, so the pictures do not depend on the clock.
async function open(page, query) {
  await page.goto(`/?level=beltline-eastside&mute=1&governor=0&weather=clear&time=14&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 180000 });
  await page.waitForFunction(() => window.__atl.level.skatepark?.view && (window.__atl.level.skatepark.view.loaded || window.__atl.level.skatepark.view.error), null, { timeout: 180000 });
  await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 180000 });
}

// Starts a script in the page. While it runs, the page keeps the lowest gap
// between the feet and the ground (sampled each animation frame). At the
// first frame with the skater on each id of `stops` (a ground id or a grind
// id), in order, the page freezes (`renderPaused`: no step, no render), so a
// picture of that frame does not depend on the frame rate.
async function start(page, { script, start: from }, stops = []) {
  await page.evaluate(
    ({ script, from, stops }) => {
      const atl = window.__atl;
      const ride = { minGap: Infinity, running: true, stopped: null, stops: [...stops] };
      const watch = () => {
        const s = atl.skater;
        if (s.state !== "grind") {
          const g = atl.level.sample(s.position[0], s.position[2], s.position[1]);
          ride.minGap = Math.min(ride.minGap, g ? s.position[1] - g.height : -Infinity);
        }
        if (!ride.stopped && ride.stops.length && (s.groundId === ride.stops[0] || s.grind?.id === ride.stops[0])) {
          ride.stopped = ride.stops.shift();
          atl.renderPaused = true;
        }
        if (ride.running) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
      ride.done = atl.runScript(script, from).then((end) => {
        ride.running = false;
        return { end: { state: end.state, position: end.position, stats: end.stats }, events: atl.events.map((e) => ({ ...e })), minGap: ride.minGap, missed: ride.stops };
      });
      window.__ride = ride;
    },
    { script, from, stops },
  );
}
const finish = (page) => page.evaluate(() => window.__ride.done);
async function replay(page, ride) {
  await start(page, ride);
  return finish(page);
}

// A picture of the frozen frame with the skater on `id`; then the ride goes on.
async function shotOn(page, id, path) {
  await page.waitForFunction((want) => window.__ride.stopped === want, id, { timeout: 600000 });
  await page.screenshot({ path, quality: JPEG });
  await page.evaluate(() => {
    window.__ride.stopped = null;
    window.__atl.renderPaused = false;
  });
}

const near = (a, b, tol = 0.01) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tol;

for (const look of ["toon", "pbr"]) {
  test(`the skatepark is a skate spot in the ${look} look: ramps, grinds, and the 2000 point combo`, async ({ page }) => {
    // Headless Chromium renders on the CPU: about 2 ticks per second on the
    // high tier in a small container, so the rides get a small view and a
    // long time limit.
    test.setTimeout(1800000);
    await page.setViewportSize({ width: 960, height: 540 });
    const errors = collectErrors(page);
    await open(page, `quality=high&look=${look}`);
    const shot = (name) => `e2e/__screenshots__/skatepark-${look}-${name}.jpg`;

    // The models: every feature in one draw call, on the pad of the level.
    const info = await page.evaluate(() => ({ park: window.__atl.level.skatepark, grindables: window.__atl.level.grindables }));
    const { level } = park();
    expect(info.park.view.error).toBeNull();
    expect(info.park.view.loaded).toBe(true);
    expect(info.park.view.drawCalls).toBe(1);
    expect(info.park.placements.length).toBe(level.skatepark.placements.length);
    expect(info.park.top).toBeCloseTo(level.skatepark.top, 5);
    expect(info.grindables["rail:skatepark"]).toBe(3);
    expect(info.grindables["ledge:skatepark"]).toBeGreaterThanOrEqual(10);

    // The ramps: the page ends where the pure simulation ends, the skater
    // rolls on the ramp surfaces, and the feet never go under the ground.
    const rides = rampRides();
    const pictures = { pyramidAndQuarter: [`${ID}:pyramid:top`, `${ID}:quarter:face`], kicker: [`${ID}:kicker:face`], bank: [`${ID}:bank:face`] };
    for (const [name, ride] of Object.entries(rides)) {
      const want = simulate(ride.script, ride.start);
      await start(page, ride, pictures[name]);
      for (const id of pictures[name]) await shotOn(page, id, shot(id.split(":")[2]));
      const got = await finish(page);
      expect(got.missed, name).toEqual([]);
      expect(near(got.end.position, want.end.position), `${name}: page ${got.end.position} vs sim ${want.end.position}`).toBe(true);
      expect(got.minGap, `${name}: under the ground`).toBeGreaterThan(-0.01);
      expect(want.minGap, name).toBeGreaterThan(-1e-6);
      expect(got.events.filter((e) => e.type === "respawn" || e.type === "bail"), name).toEqual([]);
      expect(got.end.stats.respawns, name).toBe(0);
      expect(want.bonks, name).toBe(0);
    }
    const quarter = simulate(rides.pyramidAndQuarter.script, rides.pyramidAndQuarter.start);
    expect(quarter.grounds).toEqual(expect.arrayContaining([`${ID}:pyramid:top`, `${ID}:manual-pad:body`, `${ID}:quarter:face`]));
    expect(quarter.top).toBeGreaterThan(1.1);
    expect(simulate(rides.kicker.script, rides.kicker.start).grounds).toContain(`${ID}:kicker:face`);
    const bank = simulate(rides.bank.script, rides.bank.start);
    expect(bank.grounds).toContain(`${ID}:bank:face`);
    expect(bank.top).toBeGreaterThan(0.8);

    // The combo line: 3 grinds and a hop, with the last link in the zone of
    // the landmark spot.
    const line = comboLine();
    const want = simulate(line.script, line.start);
    expect(want.snaps).toEqual(["rail:skatepark:h4w-skatepark:long-rail:top", "ledge:skatepark:h4w-skatepark:line-ledge:front", "rail:skatepark:h4w-skatepark:end-rail:top"]);
    expect(want.banks.length).toBe(1);
    expect(want.banks[0].points).toBeGreaterThanOrEqual(SPOT.challenge.points);
    const zone = SPOT.challenge.zone;
    const last = want.banks[0].lastLink;
    expect(Math.hypot(last[0] - zone.x, last[1] - zone.z)).toBeLessThanOrEqual(zone.r);
    // The last link is on the rail lane (v = -3.5 in pad meters).
    expect(Math.abs(uv(...last)[1] + 3.5)).toBeLessThan(0.1);

    await start(page, line, [want.snaps[0], want.snaps[1]]);
    await shotOn(page, want.snaps[0], shot("rail-grind"));
    await shotOn(page, want.snaps[1], shot("ledge-grind"));
    const got = await finish(page);
    expect(got.events.filter((e) => e.type === "snap").map((e) => e.id)).toEqual(want.snaps);
    expect(got.events.filter((e) => e.type === "move").map((e) => `${e.name}:${e.points}`)).toEqual(want.moves.map((m) => `${m.name}:${m.points}`));
    const banked = got.events.filter((e) => e.type === "bank");
    expect(banked.length).toBe(1);
    expect(banked[0].points).toBe(want.banks[0].points);
    expect(banked[0].points).toBeGreaterThanOrEqual(2000);
    expect(got.events.filter((e) => e.type === "fall" || e.type === "bail" || e.type === "respawn")).toEqual([]);
    expect(near(got.end.position, want.end.position), `page ${got.end.position} vs sim ${want.end.position}`).toBe(true);
    expect(got.minGap).toBeGreaterThan(-0.01);
    await page.screenshot({ path: shot("combo-banked"), quality: JPEG });

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
}

// The park from its west end (on the pad: the ground west of it slopes, and
// a skater at rest there rolls away) and from the grass east of it.
for (const quality of ["high", "phone"]) {
  for (const look of ["toon", "pbr"]) {
    test(`the skatepark draws on the ${quality} tier in the ${look} look`, async ({ page }) => {
      test.setTimeout(600000);
      const errors = collectErrors(page);
      await open(page, `quality=${quality}&look=${look}`);
      const view = await page.evaluate(() => window.__atl.level.skatepark.view);
      expect(view.error).toBeNull();
      expect(view.loaded).toBe(true);
      expect(view.drawCalls).toBe(1);
      const name = quality === "high" ? look : `${quality}-${look}`;
      await replay(page, { script: [{ frames: 20, input: {} }], start: startAt(-14.6, -1.2, 1, 0) });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `e2e/__screenshots__/skatepark-${name}-overview.jpg`, quality: JPEG });
      await replay(page, { script: [{ frames: 20, input: {} }], start: startAt(22, 1, -1, 0) });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `e2e/__screenshots__/skatepark-${name}-overview-east.jpg`, quality: JPEG });
      expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
    });
  }
}
