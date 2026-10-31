import { describe, expect, it } from "vitest";
import { GREYBOX_BLOCK } from "../../levels/greybox-block.js";
import { FIXED_DT } from "../fixed-step.js";
import { flatDistance, flatLength } from "../math/vec3.js";
import { SKATE, carveRateAt } from "./constants.js";
import { createSkater, createWorld, NO_INPUT, runScript, step } from "./controller.js";
import { expandScript } from "./input-script.js";

// Controller behaviour is tested on an endless flat floor, so a result can
// never be an artefact of running out of block. The greybox level is used
// below, where the surface itself is the thing under test.
const flat = {
  probe: () => ({ height: 0, kind: "ground", objectId: "flat" }),
  spawn: { position: { x: 0, y: 0, z: 0 }, yaw: Math.PI / 2 },
  tuning: SKATE,
};
const block = createWorld(GREYBOX_BLOCK);

const fresh = (world = flat) => createSkater({ spawn: world.spawn });
const hold = (state, input, seconds, world = flat) =>
  runScript(state, expandScript([{ for: seconds, input }], FIXED_DT), FIXED_DT, world);

// Run until a condition holds, or give up. Used where the interesting moment
// is "the skater reached the ramp", not "2.4 seconds elapsed".
function until(state, input, predicate, world, maxSeconds = 10) {
  let current = state;
  for (let i = 0; i < Math.round(maxSeconds / FIXED_DT); i += 1) {
    current = step(current, input, FIXED_DT, world);
    if (predicate(current)) return { state: current, reached: true, seconds: (i + 1) * FIXED_DT };
  }
  return { state: current, reached: false, seconds: maxSeconds };
}

describe("push", () => {
  it("adds speed and then waits out the cooldown", () => {
    let skater = step(fresh(), { push: true }, FIXED_DT, flat);
    expect(skater.speed).toBeCloseTo(SKATE.pushImpulse, 6);
    expect(skater.state).toBe("push");

    // Still inside the cooldown, so the next push does nothing but coast.
    skater = step(skater, { push: true }, FIXED_DT, flat);
    expect(skater.speed).toBeLessThan(SKATE.pushImpulse);
    expect(skater.state).toBe("coast");
  });

  it("climbs to the speed cap and stops there", () => {
    const skater = hold(fresh(), { push: true }, 12);
    expect(skater.speed).toBeGreaterThan(SKATE.maxSpeed * 0.9);
    expect(skater.speed).toBeLessThanOrEqual(SKATE.maxSpeed);
  });

  it("takes several pushes to get up to speed", () => {
    const afterOneSecond = hold(fresh(), { push: true }, 1);
    expect(afterOneSecond.speed).toBeLessThan(SKATE.maxSpeed * 0.75);
  });
});

describe("coast", () => {
  it("decays slowly, because momentum is king", () => {
    const rolling = hold(fresh(), { push: true }, 4);
    const coasted = hold(rolling, NO_INPUT, 2);
    expect(coasted.speed).toBeCloseTo(rolling.speed - SKATE.coastDecay * 2, 4);
    expect(coasted.speed).toBeGreaterThan(rolling.speed * 0.7);
  });

  it("settles to a stop rather than creeping forever", () => {
    const skater = hold(hold(fresh(), { push: true }, 1), NO_INPUT, 30);
    expect(skater.speed).toBe(0);
    expect(skater.state).toBe("coast");
  });
});

describe("carve", () => {
  it("turns the facing, and turns harder when slow", () => {
    const slow = step(fresh(), { steer: 1 }, FIXED_DT, flat);
    expect(slow.yaw).toBeCloseTo(flat.spawn.yaw + carveRateAt(0) * FIXED_DT, 10);

    const fast = hold(fresh(), { push: true }, 8);
    const turnedFast = step(fast, { steer: 1 }, FIXED_DT, flat);
    const slowRate = slow.yaw - flat.spawn.yaw;
    const fastRate = turnedFast.yaw - fast.yaw;
    expect(fastRate).toBeLessThan(slowRate);
    expect(fastRate).toBeGreaterThan(0);
  });

  it("sends the skater where it is facing", () => {
    const turned = hold(hold(fresh(), { push: true }, 2), { steer: -1 }, 0.5);
    const rolled = hold(turned, NO_INPUT, 0.5);
    const travel = {
      x: rolled.position.x - turned.position.x,
      z: rolled.position.z - turned.position.z,
    };
    expect(Math.atan2(travel.x, travel.z)).toBeCloseTo(turned.yaw, 2);
  });
});

describe("brake", () => {
  it("stops inside 12 m from top speed", () => {
    const fast = hold(fresh(), { push: true }, 12);
    expect(fast.speed).toBeGreaterThan(SKATE.maxSpeed * 0.9);

    const stopped = hold(fast, { brake: true }, 4);
    expect(stopped.speed).toBe(0);
    expect(flatDistance(fast.position, stopped.position)).toBeLessThan(12);
  });

  it("reports the brake state while slowing", () => {
    const fast = hold(fresh(), { push: true }, 4);
    expect(step(fast, { brake: true }, FIXED_DT, flat).state).toBe("brake");
  });
});

describe("jump", () => {
  it("leaves the ground and comes back in a fixed arc", () => {
    const rolling = hold(fresh(), { push: true }, 2);
    const frames = expandScript([{ for: 1.2, tap: ["jump"] }], FIXED_DT);

    let skater = rolling;
    let apex = -Infinity;
    let airSteps = 0;
    for (const input of frames) {
      skater = step(skater, input, FIXED_DT, flat);
      apex = Math.max(apex, skater.position.y);
      if (!skater.grounded) airSteps += 1;
    }

    const expectedApex = (SKATE.jumpSpeed * SKATE.jumpSpeed) / (2 * SKATE.gravity);
    const expectedAir = (2 * SKATE.jumpSpeed) / SKATE.gravity;

    expect(apex).toBeGreaterThan(expectedApex * 0.85);
    expect(apex).toBeLessThan(expectedApex * 1.15);
    expect(airSteps * FIXED_DT).toBeGreaterThan(expectedAir * 0.8);
    expect(airSteps * FIXED_DT).toBeLessThan(expectedAir * 1.2);
    expect(skater.grounded).toBe(true);
    expect(skater.jumps).toBe(1);
  });

  it("passes through a landing state and keeps rolling", () => {
    const rolling = hold(fresh(), { push: true }, 2);
    const frames = expandScript([{ for: 1.2, tap: ["jump"] }], FIXED_DT);

    let skater = rolling;
    const states = new Set();
    for (const input of frames) {
      skater = step(skater, input, FIXED_DT, flat);
      states.add(skater.state);
    }
    expect(states.has("air")).toBe(true);
    expect(states.has("land")).toBe(true);
    expect(skater.speed).toBeGreaterThan(rolling.speed * 0.7);
  });

  it("does not jump again while airborne", () => {
    const rolling = hold(fresh(), { push: true }, 2);
    const airborne = hold(rolling, { jump: true }, 0.3);
    expect(airborne.grounded).toBe(false);
    expect(airborne.jumps).toBe(1);
  });
});

describe("the surface, on the greybox block", () => {
  it("steps up onto the sidewalk without leaving the ground", () => {
    // Roll north off the street and over the curb.
    const start = { ...fresh(block), yaw: 0, position: { x: 0, y: 0, z: 0 } };
    const run = until(start, { push: true }, (s) => s.surface === "sidewalk", block, 6);

    expect(run.reached).toBe(true);
    expect(run.state.grounded).toBe(true);
    expect(run.state.position.y).toBeCloseTo(0.18, 6);
  });

  it("rides up the quarter-pipe transition", () => {
    const ramp = GREYBOX_BLOCK.objects.find((o) => o.id === "ramp-east").shape;
    const start = { ...fresh(block), yaw: Math.PI / 2, position: { x: ramp.position.x - 8, y: 0, z: 0 } };
    const onRamp = until(start, { push: true }, (s) => s.surface === "ramp", block, 6);
    expect(onRamp.reached).toBe(true);

    const climbing = until(onRamp.state, { push: true }, (s) => s.position.y > 0.6, block, 2);
    expect(climbing.reached).toBe(true);
    expect(climbing.state.grounded).toBe(true);
  });

  it("launches off the lip instead of sticking to it", () => {
    const ramp = GREYBOX_BLOCK.objects.find((o) => o.id === "ramp-east").shape;
    const start = { ...fresh(block), yaw: Math.PI / 2, position: { x: ramp.position.x - 8, y: 0, z: 0 } };
    const flying = until(start, { push: true }, (s) => !s.grounded, block, 6);

    expect(flying.reached).toBe(true);
    expect(flying.state.position.x).toBeGreaterThan(ramp.position.x);
  });

  it("spawns the skater standing on the street", () => {
    const skater = hold(fresh(block), NO_INPUT, 0.5, block);
    expect(skater.grounded).toBe(true);
    expect(skater.surface).toBe("ground");
    expect(skater.position.y).toBeCloseTo(0, 10);
  });
});

describe("the safety net", () => {
  it("never ends a run: off the block is a respawn, not a death", () => {
    let skater = { ...fresh(block), position: { x: 200, y: 0, z: 200 } };
    skater = hold(skater, NO_INPUT, 4, block);
    expect(skater.respawns).toBe(1);
    expect(skater.position).toEqual(GREYBOX_BLOCK.spawn.position);
    expect(skater.grounded).toBe(true);
    expect(skater.state).toBe("coast");
  });
});

describe("determinism", () => {
  const script = expandScript(
    [
      { for: 1.5, input: { push: true } },
      { for: 0.8, input: { steer: -1 } },
      { for: 0.6, tap: ["jump"] },
      { for: 1.0, input: { push: true, steer: 0.4 } },
      { for: 0.7, input: { brake: true } },
    ],
    FIXED_DT,
  );

  it("gives the same end state every run", () => {
    const a = runScript(fresh(), script, FIXED_DT, flat);
    const b = runScript(fresh(), script, FIXED_DT, flat);
    expect(a).toEqual(b);
  });

  it("does not mutate the state it was given", () => {
    const start = fresh();
    const snapshot = structuredClone(start);
    runScript(start, script, FIXED_DT, flat);
    expect(start).toEqual(snapshot);
  });

  it("rejects a non-positive dt rather than quietly doing nothing", () => {
    expect(() => step(fresh(), NO_INPUT, 0, world)).toThrow();
  });

  it("ends up somewhere sane", () => {
    const end = runScript(fresh(), script, FIXED_DT, flat);
    expect(Number.isFinite(end.position.x)).toBe(true);
    expect(flatLength(end.velocity)).toBeLessThanOrEqual(SKATE.maxSpeed + 1e-6);
  });
});
