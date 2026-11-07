import { expect, test } from "@playwright/test";
import { CAR_SIZE, TRAFFIC, carBodyDistance } from "../src/sim/traffic/traffic.js";

// Issue #132: parked cars and calm traffic on the streets. A car never hits,
// chases, or threatens the skater: it stops and waits. The skater treats a
// car as a wall.

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

// Aims the fixed camera along a row of parked cars: 20 m behind the car
// with the most parked cars ahead of it on its street, 3.5 m up. Then it
// waits two frames.
async function aimAtParkedRow(page) {
  return page.evaluate(async () => {
    const cars = window.__atl.cars;
    const parked = cars.parkedList;
    const row = (c) => {
      const fx = Math.cos(c.yaw);
      const fz = -Math.sin(c.yaw);
      return parked.filter((p) => {
        const along = (p.x - c.x) * fx + (p.z - c.z) * fz;
        const across = Math.abs(-(p.x - c.x) * fz + (p.z - c.z) * fx);
        return along > 0 && along < 45 && across < 6;
      }).length;
    };
    const car = parked.reduce((best, c) => (row(c) > row(best) ? c : best), parked[0]);
    const fx = Math.cos(car.yaw);
    const fz = -Math.sin(car.yaw);
    window.__atl.setFixedCamera(car.x - fx * 20, car.y + 3.5, car.z - fz * 20, car.x + fx * 15, car.y + 0.6, car.z + fz * 15);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { row: row(car) + 1, drawn: cars.drawn, lod0: cars.lod0, triangles: cars.triangles, calls: window.__atl.rendererInfo.calls, frameTriangles: window.__atl.rendererInfo.triangles };
  });
}

// Aims the fixed camera at a moving car (not a bus) from 16 m behind it and
// 6 m up, and waits two frames.
async function aimAtTraffic(page) {
  return page.evaluate(async () => {
    const cars = window.__atl.cars;
    const car = cars.list.find((c) => c.kind !== "bus" && c.lane >= 5) ?? cars.list[0];
    const fx = Math.cos(car.yaw);
    const fz = -Math.sin(car.yaw);
    const x = car.x - fx * 16 - fz * 4;
    const z = car.z - fz * 16 + fx * 4;
    window.__atl.setFixedCamera(x, car.y + 6, z, car.x + fx * 6, car.y + 0.5, car.z + fz * 6);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { kind: car.kind, speed: car.speed, lod0: cars.lod0 };
  });
}

// The kit car bodies are one draw call. The lamp layer (#173: lamp quads and
// headlight pools) adds at most 2, and the GLB cars of the pbr look add
// their own.
test("parked cars and calm traffic show on a street, the bodies in one draw call", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "view=fixed&skater=capsule&quality=low");
  const info = await page.evaluate(() => {
    const c = window.__atl.cars;
    return { parked: c.parked, moving: c.moving, lanes: c.lanes, drawCalls: c.drawCalls, lampCalls: c.lampCalls, modelCalls: c.modelCalls };
  });
  expect(info.parked).toBeGreaterThan(200);
  expect(info.moving).toBeGreaterThan(30);
  expect(info.lanes).toBeGreaterThanOrEqual(8);
  expect(info.lampCalls).toBeLessThanOrEqual(2);
  expect(info.drawCalls - info.lampCalls - info.modelCalls).toBe(1);
  // The cars drive: after 2 s each car has moved or waits at a stop.
  const speeds = await page.evaluate(() => window.__atl.cars.list.map((c) => c.speed));
  expect(Math.max(...speeds)).toBeLessThanOrEqual(TRAFFIC.cruise.trunk + 1e-6);
  const shot = await aimAtParkedRow(page);
  console.log(`desktop street view: ${JSON.stringify(shot)}`);
  expect(shot.row).toBeGreaterThanOrEqual(3);
  expect(shot.lod0).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: "e2e/__screenshots__/cars-street.png" });
  const moving = await aimAtTraffic(page);
  expect(moving.lod0).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: "e2e/__screenshots__/cars-traffic.png" });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  test("the phone tier shows the cars on a street", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, "view=fixed&skater=capsule&quality=phone");
    const shot = await aimAtParkedRow(page);
    console.log(`phone street view: ${JSON.stringify(shot)}`);
    expect(shot.lod0).toBeGreaterThanOrEqual(3);
    // The cars add a small part of the phone frame.
    expect(shot.triangles).toBeLessThan(15000);
    await page.screenshot({ path: "e2e/__screenshots__/cars-street-phone.png" });
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});

test("?cars=0 turns the cars off", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "view=fixed&skater=capsule&quality=low&cars=0");
  expect(await page.evaluate(() => window.__atl.cars)).toBeNull();
  expect(errors).toEqual([]);
});

test("a car stops short of the skater in its lane, waits, and never comes within 2 m", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "view=follow&skater=capsule&quality=low");
  // A reset puts the traffic back at its start: read the start, then stand
  // the skater in the lane 45 m ahead of a car on a two-way street.
  const spot = await page.evaluate(async () => {
    await window.__atl.runScript([]);
    const lanes = window.__atl.cars.list;
    const car = lanes.find((c) => c.kind === "sedan" && c.lane >= 5) ?? lanes[0];
    const fx = Math.cos(car.yaw);
    const fz = -Math.sin(car.yaw);
    const x = car.x + fx * 45;
    const z = car.z + fz * 45;
    const g = window.__atl.cars.sample(x, z);
    return { id: car.id, position: [x, g.height, z], yaw: car.yaw + Math.PI };
  });
  const end = await page.evaluate(async (s) => {
    await window.__atl.runScript([{ frames: 900, input: {} }], { position: s.position, yaw: s.yaw });
    const car = window.__atl.cars.list.find((c) => c.id === s.id);
    return { closest: window.__atl.cars.closest, yields: window.__atl.cars.yields, car, skater: window.__atl.skater.position };
  }, spot);
  console.log(`yield: ${JSON.stringify({ closest: end.closest, yields: end.yields, speed: end.car.speed })}`);
  expect(end.yields).toBeGreaterThan(0);
  expect(end.closest).toBeGreaterThanOrEqual(TRAFFIC.safeRadius);
  expect(end.car.speed).toBe(0);
  expect(carBodyDistance(end.car, end.skater[0], end.skater[2])).toBeGreaterThanOrEqual(TRAFFIC.safeRadius);
  expect(errors).toEqual([]);
});

test("the skater bonks on a parked car as on a wall", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "view=follow&skater=capsule&quality=low&traffic=0");
  // A parked car with no other car within 14 m. The skater starts 8 m from
  // it on the street and pushes toward it. From a stop the skater rolls back
  // down any small rise, so the approach must never rise toward the car.
  const spot = await page.evaluate(() => {
    const parked = window.__atl.cars.parkedList;
    const h = (x, z) => window.__atl.cars.sample(x, z).height;
    for (const car of parked) {
      if (!parked.every((o) => o === car || Math.hypot(o.x - car.x, o.z - car.z) > 14)) continue;
      const fx = Math.cos(car.yaw);
      const fz = -Math.sin(car.yaw);
      for (const k of [-1, 1]) {
        let ok = true;
        for (let d = 8; d > 3.5 && ok; d -= 0.25) ok = h(car.x + fx * (d - 0.25) * k, car.z + fz * (d - 0.25) * k) <= h(car.x + fx * d * k, car.z + fz * d * k) + 1e-4;
        if (!ok) continue;
        const x = car.x + fx * 8 * k;
        const z = car.z + fz * 8 * k;
        return { car, position: [x, h(x, z), z], yaw: k < 0 ? car.yaw : car.yaw + Math.PI };
      }
    }
    return null;
  });
  expect(spot).not.toBeNull();
  const end = await page.evaluate((s) => window.__atl.runScript([{ frames: 150, input: { push: true } }], { position: s.position, yaw: s.yaw }), spot);
  const gap = carBodyDistance(spot.car, end.position[0], end.position[2]);
  console.log(`bonk: gap ${gap.toFixed(3)} m, speed ${end.speed}`);
  // The skater stops at the car rear: out of the body, and near it.
  expect(gap).toBeGreaterThan(0.2);
  expect(gap).toBeLessThan(1.5);
  const toCar = Math.hypot(spot.car.x - end.position[0], spot.car.z - end.position[2]);
  expect(toCar).toBeLessThan(CAR_SIZE[spot.car.kind].length / 2 + 1.5);
  expect(errors).toEqual([]);
});
