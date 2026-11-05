import { describe, expect, it } from "vitest";
import { CAR_SIZE, MAIN_STREETS, TRAFFIC, carBodyDistance, carGroundSampler, createTraffic, oppositeSide, stepTraffic, streetHeightSampler, streetsOnly, trafficLanes } from "./traffic.js";
import { createGeoGroundSampler } from "../../level/geo/geo-ground.js";
import { FLAT_GROUND, createSkateState, runScript } from "../skate/controller.js";
import { SKATE } from "../skate/constants.js";
import { seededRandom } from "../../level/geo/styles.js";
import beltline from "../../../levels/beltline-eastside/level.json" with { type: "json" };

const DT = 1 / 60;

// A small test town: a two-way main street (x axis) with a cross street at
// x = 0, and a divided parkway (two one-way carriageways, 20 m apart).
const TOWN = {
  bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 },
  spawn: { position: [0, 0, 250], yaw: 0 },
  surfaces: { ground: 0, park: 0.02, street: 0.03, path: 0.05, trail: 0.07, sidewalk: 0.15 },
  strips: [
    { id: "a1", kind: "street", name: "Main Street", highway: "secondary", width: 12, points: [[-300, 0], [0, 0]] },
    { id: "a2", kind: "street", name: "Main Street", highway: "secondary", width: 12, points: [[0, 0], [300, 0]] },
    { id: "c1", kind: "street", name: "Cross Street", highway: "residential", width: 8, points: [[0, -300], [0, 0]] },
    { id: "c2", kind: "street", name: "Cross Street", highway: "residential", width: 8, points: [[0, 0], [0, 300]] },
    { id: "d1", kind: "street", name: "Divided Parkway", highway: "trunk", width: 10, points: [[-300, 100], [300, 100]] },
    { id: "d2", kind: "street", name: "Divided Parkway", highway: "trunk", width: 10, points: [[300, 120], [-300, 120]] },
  ],
};
const MAIN = [["Main Street"]];
const GRID = [["Main Street"], ["Cross Street"]];

function snapshot(t) {
  return t.cars.map((c) => [c.lane, c.s.toFixed(6), c.speed.toFixed(6)].join(":")).join("|");
}

describe("lanes", () => {
  it("gives a two-way street one lane in each direction, on the right", () => {
    const { lanes } = trafficLanes(TOWN, { streets: MAIN });
    expect(lanes).toHaveLength(2);
    const [a, b] = lanes;
    expect(a.oneway).toBe(false);
    expect(a.next).toBe(b.id);
    expect(b.next).toBe(a.id);
    // Eastbound (+x) keeps right: south of the center line (+z).
    const east = lanes.find((l) => l.path.points[0][0] < 0);
    const west = lanes.find((l) => l.path.points[0][0] > 0);
    expect(east.offset).toBeGreaterThan(0);
    expect(east.offset).toBe(west.offset);
  });

  it("puts a stop line before the cross street on each lane", () => {
    const { lanes, boxes } = trafficLanes(TOWN, { streets: MAIN });
    expect(boxes).toHaveLength(1);
    for (const lane of lanes) {
      expect(lane.stops).toHaveLength(1);
      const [st] = lane.stops;
      // The cross is at s = 300; half the wider street is 6 m, and 3 m more.
      expect(st.sStop).toBeCloseTo(291, 5);
      expect(st.sExit).toBeCloseTo(309, 5);
    }
  });

  it("makes a divided road one-way, with the far carriageway on the driver's left", () => {
    const [d1, d2] = TOWN.strips.filter((s) => s.name === "Divided Parkway").map((s) => s.points);
    // Seen from d1 (+x), d2 is south (+z), on the right: d1 runs the other way.
    expect(oppositeSide(d1, [d2])).toBe("right");
    expect(oppositeSide(d2, [d1])).toBe("right");
    const { lanes } = trafficLanes(TOWN, { streets: [["Divided Parkway"]] });
    // A 10 m carriageway with no lanes tag has two lanes (lanes.js laneLayout).
    expect(lanes).toHaveLength(4);
    expect(lanes.every((l) => l.oneway && l.laneCount === 2)).toBe(true);
    for (const k of [0, 1]) {
      const north = lanes.find((l) => l.path.points[0][1] === 100 && l.laneIndex === k);
      const south = lanes.find((l) => l.path.points[0][1] === 120 && l.laneIndex === k);
      // The north carriageway goes west, the south one goes east.
      expect(north.path.points[0][0]).toBe(300);
      expect(south.path.points[0][0]).toBe(-300);
      // At the level edge each end links to the same lane of the other carriageway.
      expect(north.next).toBe(south.id);
      expect(south.next).toBe(north.id);
    }
    // The curb lane (k = 0) is on the right of the driver, at a lane center.
    const curb = lanes.find((l) => l.laneIndex === 0);
    const inner = lanes.find((l) => l.path === curb.path && l.laneIndex === 1);
    expect(curb.offset).toBeCloseTo(2.5, 6);
    expect(inner.offset).toBeCloseTo(-2.5, 6);
  });

  it("finds the main streets of the BeltLine level, with Freedom Parkway one-way", () => {
    const { lanes, boxes } = trafficLanes(beltline, { streets: MAIN_STREETS });
    const names = new Set(lanes.map((l) => l.name));
    expect(names).toEqual(new Set(MAIN_STREETS.map((g) => g[0])));
    const parkway = lanes.filter((l) => l.name.startsWith("John Lewis"));
    expect(parkway.length).toBeGreaterThan(0);
    expect(parkway.every((l) => l.oneway)).toBe(true);
    // A two-way lane turns at its end into a lane of the run back.
    for (const l of lanes.filter((x) => !x.oneway)) {
      const back = lanes[l.next];
      expect(back.oneway).toBe(false);
      expect(back.path).not.toBe(l.path);
      expect(back.name).toBe(l.name);
    }
    // The lanes come from the OSM lane tags: Ponce de Leon has five lanes.
    const ponce = lanes.filter((l) => l.name.startsWith("Ponce"));
    expect(ponce.length).toBe(5);
    // Every lane center is inside the curbs, with room for a wide car.
    for (const l of lanes) expect(Math.abs(l.offset)).toBeLessThanOrEqual(7 - 0.3 - 1.3 + 1e-9);
    expect(boxes.length).toBeGreaterThan(5);
    // Every lane end goes somewhere: no car is lost.
    for (const l of lanes) expect(lanes[l.next]).toBeDefined();
  });
});

describe("traffic", () => {
  it("is deterministic: the same seed and the same skater give the same cars", () => {
    const run = () => {
      const t = createTraffic(TOWN, { streets: GRID, perKm: 12, seed: 7 });
      const rand = seededRandom(3);
      const skater = [0, 0, 0];
      for (let i = 0; i < 1200; i += 1) {
        if (i % 60 === 0) {
          skater[0] = (rand() - 0.5) * 80;
          skater[2] = (rand() - 0.5) * 80;
        }
        stepTraffic(t, DT, skater);
      }
      return snapshot(t);
    };
    expect(run()).toBe(run());
    const other = createTraffic(TOWN, { streets: GRID, perKm: 12, seed: 8 });
    expect(snapshot(other)).not.toBe(snapshot(createTraffic(TOWN, { streets: GRID, perKm: 12, seed: 7 })));
  });

  it("drives at a calm speed, never over the cruise speed of the street", () => {
    const t = createTraffic(beltline, { seed: 1 });
    let top = 0;
    for (let i = 0; i < 1800; i += 1) {
      stepTraffic(t, DT, null);
      for (const c of t.cars) top = Math.max(top, c.speed);
    }
    expect(top).toBeLessThanOrEqual(TRAFFIC.cruise.trunk + 1e-9);
  });

  it("stops at the stop line, waits, and then crosses", () => {
    const t = createTraffic(TOWN, { streets: MAIN, perKm: 1 });
    const car = t.cars[0];
    const lane = t.lanes[car.lane];
    const st = lane.stops[0];
    let stoppedAt = null;
    let stoppedFor = 0;
    for (let i = 0; i < 60 * 90 && car.s < st.sExit + 5 && car.lane === lane.id; i += 1) {
      stepTraffic(t, DT, null);
      if (car.speed === 0 && car.s < st.sStop) {
        stoppedAt ??= car.s + CAR_SIZE[car.kind].length / 2;
        stoppedFor += DT;
      }
    }
    expect(stoppedAt).not.toBeNull();
    expect(stoppedAt).toBeLessThanOrEqual(st.sStop + 0.01);
    expect(stoppedAt).toBeGreaterThan(st.sStop - 1);
    expect(stoppedFor).toBeGreaterThanOrEqual(TRAFFIC.stopWait - 1e-9);
    expect(car.s).toBeGreaterThan(st.sExit);
  });

  it("lets one car at a time into an intersection, so cars never overlap", () => {
    const t = createTraffic(TOWN, { streets: GRID, perKm: 14, seed: 2 });
    let closest = Infinity;
    for (let i = 0; i < 60 * 120; i += 1) {
      stepTraffic(t, DT, null);
      for (let a = 0; a < t.cars.length; a += 1) {
        for (let b = a + 1; b < t.cars.length; b += 1) {
          const p = t.cars[a];
          const q = t.cars[b];
          // The corners of q against the body of p.
          const size = CAR_SIZE[q.kind];
          const fx = Math.cos(q.yaw);
          const fz = -Math.sin(q.yaw);
          for (const [u, v] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const x = q.x + (fx * u * size.length) / 2 - (fz * v * size.width) / 2;
            const z = q.z + (fz * u * size.length) / 2 + (fx * v * size.width) / 2;
            closest = Math.min(closest, carBodyDistance(p, x, z));
          }
        }
      }
    }
    expect(closest).toBeGreaterThan(0);
    // The cars kept moving: no gridlock.
    expect(t.cars.filter((c) => c.speed > 0).length).toBeGreaterThan(0);
  });
});

describe("a lane that links to its own start", () => {
  // A divided road with ends far from the level edge: each one-way lane has
  // no link, so a car goes on at the start of the same lane. A cross street
  // at x = 0 gives each lane one stop line.
  const LOOP = {
    ...TOWN,
    strips: [
      { id: "d1a", kind: "street", name: "Divided Parkway", highway: "trunk", width: 10, points: [[-150, 100], [0, 100]] },
      { id: "d1b", kind: "street", name: "Divided Parkway", highway: "trunk", width: 10, points: [[0, 100], [150, 100]] },
      { id: "d2a", kind: "street", name: "Divided Parkway", highway: "trunk", width: 10, points: [[150, 120], [0, 120]] },
      { id: "d2b", kind: "street", name: "Divided Parkway", highway: "trunk", width: 10, points: [[0, 120], [-150, 120]] },
      { id: "x1", kind: "street", name: "Cross Street", highway: "residential", width: 8, points: [[0, 80], [0, 100], [0, 120], [0, 140]] },
    ],
  };

  it("stops at the stop line again on each lap", () => {
    const t = createTraffic(LOOP, { streets: [["Divided Parkway"]], perKm: 1 });
    const lane = t.lanes[0];
    expect(lane.oneway).toBe(true);
    expect(lane.next).toBe(lane.id);
    expect(lane.stops).toHaveLength(1);
    const car = t.cars.find((c) => c.lane === lane.id);
    const st = lane.stops[0];
    let laps = 0;
    let last = car.s;
    const stopsPerLap = new Map();
    for (let i = 0; i < 60 * 240 && laps < 3; i += 1) {
      stepTraffic(t, DT, null);
      if (car.s < last - 1) laps += 1;
      last = car.s;
      if (car.speed === 0 && Math.abs(car.s + CAR_SIZE[car.kind].length / 2 - st.sStop) < 1) stopsPerLap.set(laps, true);
    }
    expect(laps).toBeGreaterThanOrEqual(2);
    expect(stopsPerLap.get(1)).toBe(true);
    expect(stopsPerLap.get(2)).toBe(true);
  });
});

describe("car height", () => {
  it("eases over a step in the street, never more than maxClimb in one step", () => {
    // A 0.8 m step at x = 0 (a bridge joint).
    const t = createTraffic(TOWN, { streets: MAIN, perKm: 1, heightAt: (x) => (x > 0 ? 0.8 : 0) });
    const car = t.cars[0];
    let last = car.y;
    let lane = car.lane;
    for (let i = 0; i < 60 * 60; i += 1) {
      stepTraffic(t, DT, null);
      if (car.lane === lane) expect(Math.abs(car.y - last)).toBeLessThanOrEqual(TRAFFIC.maxClimb + 1e-9);
      last = car.y;
      lane = car.lane;
    }
  });

  it("takes the height from the streets only: never from a building over the street", () => {
    const town = { ...TOWN, buildings: [{ id: "b1", outer: [[40, -3], [60, -3], [60, 3], [40, 3]], height: 12 }], areas: [{ id: "p1", kind: "park", outer: [[70, -3], [80, -3], [80, 3], [70, 3]] }] };
    const streets = streetsOnly(town);
    expect(streets.buildings).toEqual([]);
    expect(streets.areas).toEqual([]);
    expect(streets.strips.every((s) => s.kind === "street")).toBe(true);
    const h = streetHeightSampler(createGeoGroundSampler(streets));
    expect(h(50, 0, 0.03)).toBeCloseTo(town.surfaces.street, 6);
    expect(h(50, 0, -Infinity)).toBeCloseTo(town.surfaces.street, 6);
  });
});

describe("yield to the skater", () => {
  it("slows, stops short of a skater in its lane, waits, and then goes on", () => {
    const t = createTraffic(TOWN, { streets: MAIN, perKm: 1 });
    const car = t.cars[0];
    const lane = t.lanes[car.lane];
    // The skater stands in the lane 60 m ahead of the car.
    const ahead = lane.path.points[0][0] < 0 ? 1 : -1;
    const skater = [car.x + ahead * 60, 0, car.z];
    for (let i = 0; i < 60 * 30; i += 1) stepTraffic(t, DT, skater);
    expect(car.speed).toBe(0);
    expect(car.yielding).toBe(true);
    const gap = carBodyDistance(car, skater[0], skater[2]);
    expect(gap).toBeGreaterThanOrEqual(TRAFFIC.safeRadius);
    expect(gap).toBeLessThan(TRAFFIC.safeRadius + TRAFFIC.yieldMargin + 1);
    expect(t.yields).toBeGreaterThan(0);
    // The skater leaves: the car waits yieldWait, then goes on.
    const s0 = car.s;
    let waited = 0;
    for (let i = 0; i < 60 * 5 && car.s === s0; i += 1) {
      stepTraffic(t, DT, null);
      if (car.s === s0) waited += DT;
    }
    expect(waited).toBeGreaterThanOrEqual(TRAFFIC.yieldWait - 2 * DT);
    for (let i = 0; i < 60 * 5; i += 1) stepTraffic(t, DT, null);
    expect(car.speed).toBeGreaterThan(1);
  });

  it("does not stop for a skater on a bridge over the street", () => {
    const t = createTraffic(TOWN, { streets: MAIN, perKm: 1 });
    const free = createTraffic(TOWN, { streets: MAIN, perKm: 1 });
    const car = t.cars[0];
    const ahead = t.lanes[car.lane].path.points[0][0] < 0 ? 1 : -1;
    const skater = [car.x + ahead * 40, 6, car.z];
    for (let i = 0; i < 60 * 10; i += 1) {
      stepTraffic(t, DT, skater);
      stepTraffic(free, DT, null);
    }
    expect(t.yields).toBe(0);
    expect(snapshot(t)).toBe(snapshot(free));
  });

  it("never brings a car into the 2 m circle around a skater who stands still", () => {
    const rand = seededRandom(11);
    for (let trial = 0; trial < 40; trial += 1) {
      const t = createTraffic(TOWN, { streets: GRID, perKm: 14, seed: trial + 1 });
      // A spot on a street or near one: in a lane, at a curb, in the box.
      const skater = rand() < 0.5 ? [(rand() - 0.5) * 400, 0, (rand() - 0.5) * 14] : [(rand() - 0.5) * 12, 0, (rand() - 0.5) * 400];
      const start = Math.min(...t.cars.map((c) => carBodyDistance(c, skater[0], skater[2])));
      if (start < TRAFFIC.safeRadius) continue;
      for (let i = 0; i < 60 * 40; i += 1) {
        stepTraffic(t, DT, skater);
        expect(t.minSkaterGap).toBeGreaterThanOrEqual(TRAFFIC.safeRadius);
      }
    }
    // 40 trials of 40 s: over the 5 s default on a loaded machine.
  }, 30000);

  it("never moves a car into the 2 m circle around a skater who skates around", () => {
    const rand = seededRandom(5);
    const t = createTraffic(TOWN, { streets: GRID, perKm: 14, seed: 4 });
    const skater = [10, 0, 2];
    let heading = 0;
    let moves = 0;
    for (let i = 0; i < 60 * 180; i += 1) {
      // A random walk at skate speed over the streets and the intersection.
      if (i % 30 === 0) heading += (rand() - 0.5) * 2;
      skater[0] = Math.max(-150, Math.min(150, skater[0] + Math.cos(heading) * 6 * DT));
      skater[2] = Math.max(-150, Math.min(150, skater[2] - Math.sin(heading) * 6 * DT));
      const before = t.cars.map((c) => ({ x: c.x, z: c.z, gap: carBodyDistance(c, skater[0], skater[2]) }));
      stepTraffic(t, DT, skater);
      t.cars.forEach((c, k) => {
        if (c.x === before[k].x && c.z === before[k].z) return;
        moves += 1;
        const after = carBodyDistance(c, skater[0], skater[2]);
        // A move ends outside the circle, or it takes the car away.
        expect(after >= TRAFFIC.safeRadius || after >= before[k].gap - 1e-9).toBe(true);
      });
    }
    expect(moves).toBeGreaterThan(1000);
  });
});

describe("cars as obstacles", () => {
  const parked = [{ kind: "sedan", x: 10, z: 0, yaw: 0, y: 0 }];
  const sampler = carGroundSampler(FLAT_GROUND.sampleGround, parked);

  it("gives the car top inside the car body, and the ground outside", () => {
    expect(sampler(10, 0)).toEqual({ height: CAR_SIZE.sedan.height, normal: [0, 1, 0], id: "car:sedan" });
    expect(sampler(10 + CAR_SIZE.sedan.length / 2 + 0.1, 0).id).toBe("flat");
    expect(sampler(10, CAR_SIZE.sedan.width / 2 + 0.1).id).toBe("flat");
  });

  it("leaves out a car high over the skater (on a bridge)", () => {
    const high = carGroundSampler(FLAT_GROUND.sampleGround, [{ kind: "van", x: 0, z: 0, yaw: 0, y: 6 }]);
    expect(high(0, 0, 0).id).toBe("flat");
    expect(high(0, 0, 5).id).toBe("car:van");
  });

  it("reads the moving cars each time", () => {
    const cars = [];
    const s = carGroundSampler(FLAT_GROUND.sampleGround, [], () => cars);
    expect(s(0, 0).id).toBe("flat");
    cars.push({ kind: "bus", x: 0, z: 0, yaw: 1, y: 0 });
    expect(s(0, 0).height).toBe(CAR_SIZE.bus.height);
  });

  it("stops the skater at a car as at a wall: the body stays out of it", () => {
    // The skater rolls east (+x) at 6 m/s into the side of the parked car.
    const s = createSkateState({ position: [0, 0, 0], yaw: 0 });
    s.speed = 6;
    s.velocity = [6, 0, 0];
    const { state, states } = runScript(s, [{ frames: 90, input: { push: true } }], { env: { sampleGround: sampler }, trace: true });
    const rear = 10 - CAR_SIZE.sedan.length / 2;
    for (const st of states) expect(st.position[0]).toBeLessThanOrEqual(rear - SKATE.bodyRadius + 1e-6);
    expect(states.some((st) => st.bonked)).toBe(true);
    expect(state.position[0]).toBeGreaterThan(rear - 1);
  });
});

describe("lights, signals, and crosswalks", () => {
  it("lights the brakes while it slows for a stop line, and not while it cruises", () => {
    const t = createTraffic(TOWN, { streets: MAIN, perKm: 1 });
    const car = t.cars[0];
    t.cars = [car];
    const st = t.lanes[car.lane].stops[0];
    car.s = st.sStop - 150;
    car.speed = 5;
    car.next = 0;
    let braked = false;
    let cruisedDark = false;
    for (let i = 0; i < 60 * 60 && car.s < st.sStop; i += 1) {
      stepTraffic(t, DT, null);
      if (car.accel < -0.5) {
        braked = true;
        expect(car.brake).toBeGreaterThan(0.4);
      }
      if (Math.abs(car.accel) < 0.05 && car.speed > 3) {
        cruisedDark = true;
        expect(car.brake).toBe(0);
      }
      if (car.speed === 0) expect(car.brake).toBeGreaterThan(0);
    }
    expect(braked).toBe(true);
    expect(cruisedDark).toBe(true);
  });

  it("signals left before the U-turn at the end of a two-way street", () => {
    const t = createTraffic(TOWN, { streets: MAIN, perKm: 1 });
    const car = t.cars[0];
    const lane = t.lanes[car.lane];
    let signalled = false;
    let early = false;
    for (let i = 0; i < 60 * 240 && car.lane === lane.id; i += 1) {
      stepTraffic(t, DT, null);
      if (car.lane !== lane.id) break;
      const toEnd = lane.length - car.s;
      if (toEnd < TRAFFIC.signalAhead - 5) signalled ||= car.signal === 1;
      if (toEnd > TRAFFIC.signalAhead + 5 && car.signal !== 0) early = true;
    }
    expect(signalled).toBe(true);
    expect(early).toBe(false);
    // The U-turn is slow.
    expect(car.speed).toBeLessThanOrEqual(TRAFFIC.turnSpeed + 0.5);
    // After the turn the signal goes off.
    for (let i = 0; i < 60 * 8; i += 1) stepTraffic(t, DT, null);
    expect(car.signal).toBe(0);
  });

  it("stops before a crosswalk with the skater on it, even out of its lane, then goes on", () => {
    const t = createTraffic(TOWN, { streets: MAIN, perKm: 1 });
    const car = t.cars.find((c) => t.lanes[c.lane].path.points[0][0] < 0);
    t.cars = [car];
    const lane = t.lanes[car.lane];
    car.s = 150;
    car.next = 0;
    const cw = lane.crossings.find((c) => c.s > car.s + 30);
    expect(cw).toBeDefined();
    // The skater is on the far half of the crosswalk: not in the car lane.
    const skater = [cw.x, 0, cw.z - lane.offset - 1];
    for (let i = 0; i < 60 * 40; i += 1) stepTraffic(t, DT, skater);
    const front = car.s + CAR_SIZE[car.kind].length / 2;
    expect(car.speed).toBe(0);
    expect(car.crossing).toBe(true);
    expect(t.crossingYields).toBeGreaterThan(0);
    expect(front).toBeLessThanOrEqual(cw.s - cw.depth / 2 - TRAFFIC.crossingStop + 0.01);
    expect(front).toBeGreaterThan(cw.s - cw.depth / 2 - TRAFFIC.crossingStop - 1.5);
    // The skater leaves the crosswalk: the car drives on over it.
    for (let i = 0; i < 60 * 30; i += 1) stepTraffic(t, DT, null);
    expect(car.s + CAR_SIZE[car.kind].length / 2 > cw.s || car.lane !== lane.id).toBe(true);
    expect(car.crossing).toBe(false);
  });
});
