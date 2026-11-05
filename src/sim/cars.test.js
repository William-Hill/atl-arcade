import { describe, expect, it } from "vitest";
import { IDM, angleDelta, brakeLevel, idmAccel, idmStopAccel, laneCenters, onCrosswalk, runLaneOffsets, turnSignal } from "./cars.js";
import { laneLayout } from "../level/geo/lanes.js";

const DT = 1 / 60;

// A platoon on one straight lane: cars[0] is the front car. Each car has
// { s, v, len }. lead(t) gives the front car speed target (or null: free).
function simulate(cars, steps, { v0 = 8, frontV0 = () => v0 } = {}) {
  let minGap = Infinity;
  let minAcc = Infinity;
  for (let i = 0; i < steps; i += 1) {
    const acc = cars.map((c, k) => {
      if (k === 0) {
        // A front car told to stop brakes at the comfortable rate.
        const want = frontV0(i * DT);
        return want === 0 ? (c.v > 0 ? -IDM.b : 0) : idmAccel(c.v, want);
      }
      const l = cars[k - 1];
      return idmAccel(c.v, v0, l.s - l.len / 2 - (c.s + c.len / 2), c.v - l.v);
    });
    cars.forEach((c, k) => {
      c.v = Math.max(0, c.v + acc[k] * DT);
      c.s += c.v * DT;
      minAcc = Math.min(minAcc, acc[k]);
    });
    for (let k = 1; k < cars.length; k += 1) minGap = Math.min(minGap, cars[k - 1].s - cars[k - 1].len / 2 - (cars[k].s + cars[k].len / 2));
  }
  return { minGap, minAcc };
}

describe("IDM", () => {
  it("accelerates on a free road toward the desired speed, never past it", () => {
    let v = 0;
    let top = 0;
    for (let i = 0; i < 60 * 60; i += 1) {
      const a = idmAccel(v, 8);
      expect(a).toBeLessThanOrEqual(IDM.a + 1e-12);
      v += a * DT;
      top = Math.max(top, v);
    }
    expect(v).toBeGreaterThan(7.9);
    expect(top).toBeLessThanOrEqual(8 + 1e-9);
  });

  it("holds the standstill gap s0 behind a stopped car and never touches it", () => {
    const cars = [{ s: 100, v: 0, len: 4.6 }, { s: 0, v: 8, len: 4.6 }];
    const { minGap } = simulate(cars, 60 * 60, { frontV0: () => 0 });
    expect(minGap).toBeGreaterThan(IDM.s0 - 0.2);
    expect(cars[1].v).toBeLessThan(0.05);
    expect(cars[0].s - cars[0].len / 2 - (cars[1].s + cars[1].len / 2)).toBeCloseTo(IDM.s0, 0);
  });

  it("keeps about s0 + v T at a steady speed", () => {
    const cars = [{ s: 200, v: 6, len: 4.6 }, { s: 150, v: 6, len: 4.6 }];
    simulate(cars, 60 * 120, { v0: 8, frontV0: () => 6 });
    const gap = cars[0].s - cars[0].len / 2 - (cars[1].s + cars[1].len / 2);
    expect(cars[1].v).toBeCloseTo(6, 1);
    // The IDM equilibrium: s = (s0 + v T) / sqrt(1 - (v / v0)^4).
    const want = (IDM.s0 + 6 * IDM.T) / Math.sqrt(1 - (6 / 8) ** 4);
    expect(gap).toBeCloseTo(want, 0);
  });

  it("stops a platoon of six behind a car that brakes, with no collision", () => {
    const cars = Array.from({ length: 6 }, (_, k) => ({ s: 200 - k * 20, v: 7, len: k === 3 ? 12 : 4.6 }));
    // The front car brakes to a stop at 10 s, waits, and drives on.
    const { minGap, minAcc } = simulate(cars, 60 * 60, { v0: 7.5, frontV0: (t) => (t > 10 && t < 20 ? 0 : 7.5) });
    expect(minGap).toBeGreaterThan(1);
    expect(minAcc).toBeGreaterThanOrEqual(-IDM.maxBrake);
    // All moving again at the end.
    for (const c of cars) expect(c.v).toBeGreaterThan(5);
  });

  it("comes to rest just short of a stop point, without passing it", () => {
    let v = 8;
    let front = 0;
    const line = 80;
    for (let i = 0; i < 60 * 40; i += 1) {
      v = Math.max(0, v + idmStopAccel(v, 8, line - front) * DT);
      front += v * DT;
      expect(front).toBeLessThan(line);
    }
    expect(line - front).toBeGreaterThan(0.1);
    expect(line - front).toBeLessThan(0.6);
  });

  it("stops at the point in a few seconds, not by an endless crawl", () => {
    for (const [v0, line] of [[8, 80], [8, 20], [1, 4], [0, 6]]) {
      let v = v0;
      let front = 0;
      let t = 0;
      while (t < 30 && !(v < 0.05 && line - front < 0.6)) {
        v = Math.max(0, v + idmStopAccel(v, 8, line - front) * DT);
        front += v * DT;
        t += DT;
        expect(front).toBeLessThan(line);
      }
      expect(t).toBeLessThan(line / 3 + 8);
      expect(line - front).toBeGreaterThan(0.1);
    }
  });

  it("brakes harder the closer a stopped leader is, up to the hard limit", () => {
    const far = idmAccel(8, 8, 60, 8);
    const near = idmAccel(8, 8, 15, 8);
    expect(near).toBeLessThan(far);
    expect(idmAccel(8, 8, 1, 8)).toBe(-IDM.maxBrake);
    expect(idmAccel(8, 8, 0, 0)).toBe(-IDM.maxBrake);
  });
});

describe("lane centers", () => {
  it("puts one lane each way on an untagged 12 m street, right of the center line", () => {
    const L = laneLayout({ width: 12 }, false);
    expect(laneCenters(L)).toEqual({ forward: [3], backward: [-3] });
    expect(runLaneOffsets(L, 1)).toEqual([3]);
    expect(runLaneOffsets(L, -1)).toEqual([3]);
  });

  it("follows the lanes tags: three lanes forward and two back, curb lane first", () => {
    const s = { width: 16.5, lanes: 5, lanesForward: 3, lanesBackward: 2 };
    const L = laneLayout(s, false);
    const fwd = runLaneOffsets(L, 1);
    const back = runLaneOffsets(L, -1);
    expect(fwd).toHaveLength(3);
    expect(back).toHaveLength(2);
    // Curb lane first: the largest offset (to the right of the driver).
    expect(fwd[0]).toBeGreaterThan(fwd[1]);
    expect(back[0]).toBeGreaterThan(back[1]);
    // The lane centers sit midway between the lane lines of lanes.js.
    const lines = [...L.lines, L.center].sort((a, b) => a - b);
    for (const o of fwd) expect(lines.some((x) => Math.abs(Math.abs(o - x) - L.lane / 2) < 1e-9)).toBe(true);
    // The two directions never share a lane: forward right of the center.
    for (const o of fwd) expect(o).toBeGreaterThan(L.center);
    for (const o of back) expect(-o).toBeLessThan(L.center);
  });

  it("fills a one-way carriageway between its edge lines", () => {
    const L = laneLayout({ width: 14, oneway: true, lanes: 2 }, true);
    const fwd = runLaneOffsets(L, 1);
    expect(fwd).toHaveLength(2);
    expect(fwd[0]).toBeCloseTo(L.lane / 2, 9);
    expect(fwd[1]).toBeCloseTo(-L.lane / 2, 9);
  });
});

describe("signals and brake lights", () => {
  it("signals left for a left turn, right for a right turn, with hysteresis", () => {
    expect(turnSignal(1)).toBe(1);
    expect(turnSignal(-1)).toBe(-1);
    expect(turnSignal(0.1)).toBe(0);
    expect(turnSignal(0.4, 1)).toBe(1);
    expect(turnSignal(0.4, 0)).toBe(0);
    expect(turnSignal(0.2, 1)).toBe(0);
    expect(turnSignal(-0.4, 1)).toBe(0);
  });

  it("wraps heading changes into (-PI, PI]", () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 9);
    expect(angleDelta(0, Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(angleDelta(1, 1)).toBe(0);
  });

  it("lights the brakes on deceleration and at rest, not when cruising", () => {
    expect(brakeLevel(0, 7)).toBe(0);
    expect(brakeLevel(-0.2, 7)).toBe(0);
    expect(brakeLevel(-1, 7)).toBeGreaterThan(0.4);
    expect(brakeLevel(-IDM.b, 7)).toBe(1);
    expect(brakeLevel(-6, 7)).toBe(1);
    expect(brakeLevel(0, 0)).toBe(0.8);
    expect(brakeLevel(-1, 7)).toBeLessThan(brakeLevel(-2, 7));
  });
});

describe("crosswalk", () => {
  const cw = { x: 10, z: 0, dx: 1, dz: 0, depth: 2.4, w: 12 };
  it("finds the skater on the crosswalk and at its curb ends", () => {
    expect(onCrosswalk(cw, 10, 0)).toBe(true);
    expect(onCrosswalk(cw, 11, 5)).toBe(true);
    expect(onCrosswalk(cw, 10, 7)).toBe(true);
    expect(onCrosswalk(cw, 10, 8)).toBe(false);
    expect(onCrosswalk(cw, 14, 0)).toBe(false);
  });
});
