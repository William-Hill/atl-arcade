import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { TRAFFIC, carBodyDistance } from "../src/sim/traffic/traffic.js";

// Issue #261, owner decision 2026-11-23: calm traffic with no collision.
// Cars still move, but they slow and stop for the skater, and a contact
// with a moving car never knocks her down and never stops her.
//
// The skater rides into a street with cars on the BeltLine level: she
// starts in a lane, 45 m ahead of a car, and pushes toward it the whole
// time. The car must stop for her. She then comes to the stopped car and
// glances off its front: no bail, and no bonk on the car. (Past the car
// she may still bonk on a level wall: walls are not part of this rule.)

const SHOTS = "reports/traffic-calm-261";
const RIDE = 60 * 14; // fixed ticks of the ride.

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test("a skater rides into a street with cars: the cars stop, and a contact gives no bail and no bonk (#261)", async ({ page }) => {
  test.setTimeout(600000);
  mkdirSync(SHOTS, { recursive: true });
  const errors = collectErrors(page);
  await page.goto("/?level=beltline-eastside&mute=1&view=follow&skater=capsule&quality=low&time=13&weather=clear");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
  await page.addStyleTag({ content: "dialog, dialog::backdrop { visibility: hidden !important; }" });

  // A reset puts the traffic back at its start: read the start, and find a
  // sedan on a two-way street with a level lane 45 m ahead of it.
  const spot = await page.evaluate(async () => {
    await window.__atl.runScript([]);
    const list = window.__atl.cars.list;
    const h = (x, z) => window.__atl.cars.sample(x, z).height;
    for (const car of list.filter((c) => c.kind === "sedan" && c.lane >= 5)) {
      const fx = Math.cos(car.yaw);
      const fz = -Math.sin(car.yaw);
      // The lane ahead must be level within 0.6 m, so she can push up it.
      let ok = true;
      for (let d = 5; d <= 45 && ok; d += 2.5) ok = Math.abs(h(car.x + fx * d, car.z + fz * d) - car.y) < 0.6;
      if (!ok) continue;
      const x = car.x + fx * 45;
      const z = car.z + fz * 45;
      return { id: car.id, position: [x, h(x, z), z], yaw: car.yaw + Math.PI, car: [car.x, car.y, car.z], fx, fz };
    }
    return null;
  });
  expect(spot, "a sedan with a level lane ahead").not.toBeNull();

  // The ride, with a record of each tick the page sees.
  await page.evaluate(
    ({ s, frames }) => {
      const rec = (window.__calm = { samples: [], done: false, end: null, paused: false });
      let last = -1;
      const t0 = window.__atl.ticks;
      const tick = () => {
        if (rec.done) return;
        if (window.__atl.ticks !== last) {
          last = window.__atl.ticks;
          const sk = window.__atl.skater;
          const car = window.__atl.cars.list.find((c) => c.id === s.id);
          // Pause the game on the first contact tick (the settings
          // dialog stops the sim; a test style hides it), for a screenshot.
          if (sk.stats.slides > 0 && !rec.paused) {
            rec.paused = true;
            window.__atl.settings.open();
          }
          rec.samples.push({ tick: last - t0, skater: [...sk.position], speed: sk.speed, state: sk.state, bonks: sk.stats.bonks, slides: sk.stats.slides, falls: sk.stats.falls, car, yields: window.__atl.cars.yields });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__atl.runScript([{ frames, input: { push: true } }], { position: s.position, yaw: s.yaw }).then((end) => {
        rec.end = { stats: end.stats, bails: end.combo.bails, speed: end.speed, state: end.state, position: end.position };
        rec.done = true;
      });
    },
    { s: spot, frames: RIDE },
  );

  // Screenshots: the car stopped for her, the contact, and 0.5 s later.
  await page.waitForFunction(
    (id) => window.__calm.done || (window.__calm.samples.length > 30 && window.__atl.cars.list.find((c) => c.id === id).speed === 0),
    spot.id,
    { timeout: 300000 },
  );
  await page.screenshot({ path: `${SHOTS}/1-car-stops.png` });
  await page.waitForFunction(() => window.__calm.done || window.__atl.settings.isOpen, null, { timeout: 300000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/2-contact.png` });
  const contactTick = await page.evaluate(() => {
    window.__atl.settings.close();
    return window.__atl.ticks;
  });
  await page.waitForFunction((t) => window.__calm.done || window.__atl.ticks > t + 30, contactTick, { timeout: 300000 });
  await page.screenshot({ path: `${SHOTS}/3-after-contact.png` });
  await page.waitForFunction(() => window.__calm.done, null, { timeout: 300000 });
  const { samples, end } = await page.evaluate(() => window.__calm);

  const gapOf = (p) => carBodyDistance(p.car, p.skater[0], p.skater[2]);
  const contact = samples.findIndex((p) => p.slides > 0);
  // The car stops while she rides at it, before she comes to it.
  const stopped = samples.find((p, i) => p.car.speed === 0 && (contact < 0 || i <= contact));
  // The contact: from the first slide on the car until she is out of the
  // 2 m circle around it again.
  const away = contact >= 0 ? samples.findIndex((p, i) => i > contact && gapOf(p) >= TRAFFIC.safeRadius) : -1;
  const during = contact >= 0 ? samples.slice(contact, away >= 0 ? away + 1 : undefined) : [];
  const report = {
    car: spot.id,
    yields: samples.at(-1).yields,
    stoppedAtTick: stopped ? stopped.tick : null,
    gapAtStop: stopped ? gapOf(stopped) : null,
    contactTick: contact >= 0 ? samples[contact].tick : null,
    awayTick: away >= 0 ? samples[away].tick : null,
    nearest: Math.min(...samples.map(gapOf)),
    speedBeforeContact: contact > 0 ? samples[contact - 1].speed : null,
    minSpeedInContact: during.length ? Math.min(...during.map((p) => p.speed)) : null,
    bonksInContact: during.length ? during.at(-1).bonks - (contact > 0 ? samples[contact - 1].bonks : 0) : null,
    end,
  };
  console.log(`calm traffic: ${JSON.stringify(report)}`);

  // The car slows and stops for her.
  expect(report.yields).toBeGreaterThan(0);
  expect(stopped, "the car stops for the skater").toBeTruthy();
  // She rides into the car: a contact, then she is clear of it again.
  expect(contact, "she comes to the car").toBeGreaterThanOrEqual(0);
  expect(report.nearest).toBeLessThan(0.6);
  expect(away, "she leaves the car").toBeGreaterThan(contact);
  // The contact never stops her and never knocks her down.
  expect(samples[contact - 1].bonks).toBe(0);
  expect(report.bonksInContact).toBe(0);
  expect(report.minSpeedInContact).toBeGreaterThan(1);
  expect(during.every((p) => p.state === "rolling")).toBe(true);
  // No bail in the whole ride.
  expect(end.stats.falls).toBe(0);
  expect(end.stats.respawns).toBe(0);
  expect(end.bails).toBe(0);
  expect(errors).toEqual([]);
});
