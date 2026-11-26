// #344 (GDD Q5): the air turn rate lets a spin pay. The sim measures the air
// times of the Eastside skatepark here, and the turn that a full steer gives
// in each air. The decision is in docs/decisions.md (2026-11-26).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SKATE } from "./constants.js";
import { FLAT_GROUND, createSkateState, stepSkate, yawFromHeading } from "./controller.js";
import { createRun, stepRun } from "./run.js";
import { createSkaterEnv } from "./skater.js";
import { createLevelEnv } from "../../level/ground.js";
import { padPoint, withSkatepark } from "../../level/skatepark.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const PARK = read("../../../levels/beltline-eastside/skatepark.json");
const LEVEL = withSkatepark(read("../../../levels/beltline-eastside/level.json"), PARK, read("../../../assets/skate-features/features.json"));
const ENV = createLevelEnv(LEVEL, { props: false });
const SKATER_ENV = createSkaterEnv(LEVEL, ENV.grindables);
const DT = 1 / 60;
const HALF_TURN = Math.PI;

const at = (u, v) => padPoint(PARK, u, v);
function yawOf(du, dv) {
  const a = at(0, 0);
  const b = at(du, dv);
  return yawFromHeading(b[0] - a[0], b[1] - a[1]);
}
function runAt(u, v, du, dv, speed) {
  const [x, z] = at(u, v);
  const r = createRun(LEVEL, { position: [x, ENV.sampleGround(x, z).height, z], yaw: yawOf(du, dv) });
  r.skater.speed = speed;
  return r;
}

// The first air of a ride with full steer in the air: its time and its turn.
// The turn is the steer of each air tick (the landing tick sets the yaw to
// the travel, so the sum stops there).
function firstAir(run, ticks, jumpAt = -1) {
  let r = run;
  let turn = 0;
  for (let t = 0; t < ticks; t += 1) {
    const airBefore = r.skater.state === "air";
    const prev = r.skater;
    r = stepRun(r, { jump: t === jumpAt, steer: airBefore ? 1 : 0 }, DT, ENV, SKATER_ENV);
    if (airBefore) turn += SKATE.airTurnRate * DT;
    if (r.skater.justLanded) return { from: prev.airFrom, time: prev.airTime + DT, turn };
  }
  return null;
}

describe("#344: the air turn rate (Q5)", () => {
  it("is 6 rad/s, the knob maximum: a half turn takes about 0.52 s of air", () => {
    expect(SKATE.airTurnRate).toBe(6);
    expect(HALF_TURN / SKATE.airTurnRate).toBeCloseTo(0.524, 3);
  });

  it("a kicker air at 11 m/s with full steer turns one half turn or more", () => {
    const air = firstAir(runAt(-13, 0, 1, 0, 11), 200);
    expect(air.from).toBe("launch");
    expect(air.time).toBeGreaterThan(0.53);
    expect(air.turn).toBeGreaterThanOrEqual(HALF_TURN);
    // At the old 3 rad/s the same air turns about 97 degrees: no spin pays.
    expect((air.turn * 3) / SKATE.airTurnRate).toBeLessThan(HALF_TURN);
  });

  it("a vert air at 11 m/s with full steer turns one half turn or more", () => {
    const air = firstAir(runAt(8, 3, 1, 0, 11), 200);
    expect(air.from).toBe("ramp");
    expect(air.turn).toBeGreaterThanOrEqual(HALF_TURN);
  });

  it("a slow kicker air (8 m/s) and a hop on flat ground stay under one half turn", () => {
    const kicker = firstAir(runAt(-13, 0, 1, 0, 8), 200);
    expect(kicker.from).toBe("launch");
    expect(kicker.turn).toBeLessThan(HALF_TURN);
    // A hop on flat ground: about 0.5 s of air, about 172 degrees.
    let s = createSkateState();
    s.speed = 5;
    let turn = 0;
    for (let t = 0; t < 120 && !s.justLanded; t += 1) {
      const airBefore = s.state === "air";
      s = stepSkate(s, { jump: t === 1, steer: airBefore ? 1 : 0 }, DT, FLAT_GROUND);
      if (airBefore) turn += SKATE.airTurnRate * DT;
    }
    expect(s.justLanded).toBe(true);
    expect(turn).toBeLessThan(HALF_TURN);
    expect(turn).toBeGreaterThan(HALF_TURN * 0.9);
  });
});
