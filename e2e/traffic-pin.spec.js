import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TRAFFIC, carBodyDistance } from "../src/sim/traffic/traffic.js";

// Issue #285: stopped traffic cars pinned the skater for more than 60 s at
// the north end of the trail, by Freedom Parkway near (454, -262).
//
// Here the skater stands at that spot (brake held) until a van stops for
// her, 4.5 m up the slope. At rest on the slope she faces downhill, so she
// turns while she pushes (1 s), and then pushes into the van, as the
// scripted steering of the Autopilot run did. In a Node run of the same
// sim before the fix, this script held her for 4.8 s (the rest of the
// run). The car must back off or drive on: she is never held for more
// than 2 s.

const SPOT = [454, -262];
const WAIT = 60 * 31; // fixed ticks that she stands: the van stops for her at 28.6 s.
const TURN = 60; // fixed ticks that she turns (steer right) while she pushes.
const PUSH = 60 * 6; // fixed ticks from the turn start to the end.
const SHOTS = "reports/traffic-pin-285";

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

// The script: stand with the brake held; then turn and push, then push.
const script = (push) => [
  { frames: WAIT, input: { brake: true } },
  ...(push
    ? [
        { frames: TURN, input: { push: true, steer: 1 } },
        { frames: PUSH - TURN, input: { push: true } },
      ]
    : []),
];

test("a stopped car never pins the skater at (454, -262) for more than 2 s (#285)", async ({ page }) => {
  test.setTimeout(900000);
  mkdirSync(SHOTS, { recursive: true });
  const errors = collectErrors(page);
  // A fixed camera in clear daylight, 16 m east of the spot and 10 m up, so
  // the screenshots show the skater and the car. The camera stays the same
  // in both runs (the far-step of the traffic uses it).
  await page.goto("/?level=beltline-eastside&mute=1&view=fixed&skater=capsule&quality=low&time=13&weather=clear");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
  await page.evaluate((spot) => {
    const y = window.__atl.cars.sample(spot[0], spot[1]).height;
    window.__atl.setFixedCamera(spot[0] + 16, y + 10, spot[1] + 4, spot[0] - 4, y, spot[1]);
  }, SPOT);

  // Run 1, the stand. Find the car that stops for her.
  const first = await page.evaluate(
    async ({ spot, frames }) => {
      const g = window.__atl.cars.sample(spot[0], spot[1]);
      const position = [spot[0], g.height, spot[1]];
      await window.__atl.runScript(frames, { position, yaw: 0 });
      return { position, skater: [...window.__atl.skater.position], cars: window.__atl.cars.list };
    },
    { spot: SPOT, frames: script(false) },
  );
  const gapTo = (c, p) => carBodyDistance(c, p[0], p[2]);
  const stopped = first.cars.filter((c) => c.speed === 0 && Math.abs(c.y - first.skater[1]) < TRAFFIC.skaterHeight).sort((a, b) => gapTo(a, first.skater) - gapTo(b, first.skater))[0];
  expect(stopped, "a car stops for the skater").toBeTruthy();
  const stopGap = gapTo(stopped, first.skater);
  console.log(`stopped car ${stopped.id} (${stopped.kind}) gap ${stopGap.toFixed(2)} m`);
  expect(stopGap).toBeGreaterThanOrEqual(TRAFFIC.safeRadius);
  expect(stopGap).toBeLessThan(8);

  // Run 2: the same stand (the traffic is seeded), then the turn and the
  // push. The page records her position and the car pose on each tick it
  // sees (a frame can step up to 5 fixed ticks).
  await page.evaluate(
    ({ position, frames, id }) => {
      const rec = (window.__pin = { samples: [], done: false });
      let last = -1;
      const t0 = window.__atl.ticks;
      const tick = () => {
        if (rec.done) return;
        if (window.__atl.ticks !== last) {
          last = window.__atl.ticks;
          const car = window.__atl.cars.list.find((c) => c.id === id);
          rec.samples.push({ tick: last - t0, skater: [...window.__atl.skater.position], car });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__atl.runScript(frames, { position, yaw: 0 }).then(() => {
        rec.done = true;
      });
    },
    { position: first.position, frames: script(true), id: stopped.id },
  );

  // Screenshots: the contact (inside 1 m), 1.5 s later, and the end.
  await page.waitForFunction(() => window.__pin.done || (window.__pin.samples.length > 0 && window.__atl.cars.minSkaterGap < 1), null, { timeout: 600000 });
  await page.screenshot({ path: `${SHOTS}/1-contact.png` });
  const contactTick = await page.evaluate(() => window.__atl.ticks);
  await page.waitForFunction((t) => window.__atl.ticks > t + 90 || window.__pin.done, contactTick, { timeout: 60000 });
  await page.screenshot({ path: `${SHOTS}/2-after-1.5s.png` });
  await page.waitForFunction(() => window.__pin.done, null, { timeout: 600000 });
  await page.screenshot({ path: `${SHOTS}/3-end.png` });
  const samples = await page.evaluate(() => window.__pin.samples);

  // The stand was the same as in run 1.
  const atPush = samples.filter((s) => s.tick <= WAIT).at(-1);
  expect(Math.hypot(atPush.skater[0] - first.skater[0], atPush.skater[2] - first.skater[2])).toBeLessThan(0.05);

  // A pin: she touches the car (body gap under 0.5 m) and moves less than
  // 0.3 m. The longest pin, in seconds of game time (60 ticks a second).
  const push = samples.filter((s) => s.tick > WAIT);
  const nearest = Math.min(...push.map((s) => gapTo(s.car, s.skater)));
  let touched = 0;
  let longest = 0;
  let from = null;
  for (const s of push) {
    const touching = gapTo(s.car, s.skater) < 0.5;
    if (touching) touched += 1;
    if (!touching) {
      from = null;
      continue;
    }
    if (!from || Math.hypot(s.skater[0] - from.skater[0], s.skater[2] - from.skater[2]) > 0.3) {
      from = s;
      continue;
    }
    longest = Math.max(longest, (s.tick - from.tick) / 60);
  }
  const moved = Math.hypot(push.at(-1).skater[0] - atPush.skater[0], push.at(-1).skater[2] - atPush.skater[2]);
  console.log(`push: ${push.length} samples, nearest ${nearest.toFixed(2)} m, touching ${touched}, longest pin ${longest.toFixed(2)} s, moved ${moved.toFixed(1)} m`);
  // She comes inside the 2 m circle of the car, so the car must react.
  expect(nearest, "she reaches the car").toBeLessThan(TRAFFIC.safeRadius);
  expect(longest).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});
