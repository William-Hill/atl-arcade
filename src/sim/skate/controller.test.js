import { describe, expect, it } from "vitest";
import { SKATE } from "./constants.js";
import { FLAT_GROUND, carveRate, createSkateState, heading, runScript, stepSkate } from "./controller.js";
import { GREYBOX } from "../../level/greybox.js";
import { createGroundSampler } from "../../level/ground.js";

const DT = 1 / 60;
const greybox = { sampleGround: createGroundSampler(GREYBOX) };

function roll(speed, yaw = 0, position = [0, 0, 0]) {
  const s = createSkateState({ position, yaw });
  s.speed = speed;
  s.velocity = [speed * Math.cos(yaw), 0, -speed * Math.sin(yaw)];
  return s;
}

describe("push", () => {
  it("adds a burst per push and caps at maxSpeed", () => {
    const first = stepSkate(createSkateState(), { push: true }, DT);
    expect(first.speed).toBeCloseTo(SKATE.pushImpulse - (SKATE.coastDecel + SKATE.coastDrag * SKATE.pushImpulse ** 2) * DT, 3);

    const { state } = runScript(createSkateState(), [{ frames: 600, input: { push: true } }]);
    expect(state.speed).toBeLessThanOrEqual(SKATE.maxSpeed);
    expect(state.speed).toBeGreaterThan(SKATE.maxSpeed - SKATE.pushImpulse);
  });

  it("waits for the cooldown between pushes", () => {
    const { states } = runScript(createSkateState(), [{ frames: 30, input: { push: true } }], { trace: true });
    const bursts = states.filter((s, i) => s.speed > (i > 0 ? states[i - 1].speed : 0) + 1).length;
    expect(bursts).toBe(Math.ceil(0.5 / SKATE.pushCooldown));
  });
});

describe("coast", () => {
  it("decays speed and moves forward along the heading", () => {
    const { state } = runScript(roll(8), [{ frames: 120 }]);
    expect(state.speed).toBeLessThan(8);
    expect(state.speed).toBeGreaterThan(5);
    expect(state.position[0]).toBeGreaterThan(10);
    expect(Math.abs(state.position[2])).toBeLessThan(1e-9);
  });

  it("comes to a full stop eventually", () => {
    const { state } = runScript(roll(3), [{ frames: 60 * 20 }]);
    expect(state.speed).toBe(0);
  });
});

describe("carve", () => {
  it("turns the facing left with positive steer and the velocity follows", () => {
    const { state } = runScript(roll(6), [{ frames: 30, input: { steer: 1 } }]);
    expect(state.yaw).toBeGreaterThan(0);
    expect(state.position[2]).toBeLessThan(0); // left of +x is -z
    const h = heading(state.yaw);
    expect(state.velocity[0] / state.speed).toBeCloseTo(h[0], 5);
    expect(state.velocity[2] / state.speed).toBeCloseTo(h[2], 5);
  });

  it("turns slower at a crawl than at full carve speed", () => {
    expect(carveRate(1)).toBeLessThan(carveRate(SKATE.carveFullSpeed));
    expect(carveRate(SKATE.carveFullSpeed)).toBeCloseTo(SKATE.carveRate);
    expect(carveRate(100)).toBeCloseTo(SKATE.carveRate);
  });

  it("keeps the speed through a turn", () => {
    const a = runScript(roll(6), [{ frames: 60 }]).state;
    const b = runScript(roll(6), [{ frames: 60, input: { steer: -1 } }]).state;
    expect(b.speed).toBeCloseTo(a.speed, 6);
  });
});

describe("brake", () => {
  it("stops from 8 m/s within 5 meters", () => {
    const { state, states } = runScript(roll(8), [{ frames: 120, input: { brake: true } }], { trace: true });
    expect(state.speed).toBe(0);
    expect(state.position[0]).toBeLessThan(5);
    const stopTick = states.findIndex((s) => s.speed === 0);
    expect(stopTick).toBeGreaterThan(0);
    expect(stopTick * DT).toBeLessThan(8 / SKATE.brakeDecel + 0.1);
  });
});

describe("jump", () => {
  it("has a fixed arc and a landing state", () => {
    const { states } = runScript(roll(5), [{ frames: 1, input: { jump: true } }, { frames: 120 }], { trace: true });
    expect(states[0].state).toBe("air");
    expect(states[0].justJumped).toBe(true);
    const apex = Math.max(...states.map((s) => s.position[1]));
    const ideal = SKATE.jumpSpeed ** 2 / (2 * SKATE.gravity);
    expect(apex).toBeGreaterThan(ideal * 0.9);
    expect(apex).toBeLessThanOrEqual(ideal + 0.02);
    const landIndex = states.findIndex((s) => s.justLanded);
    expect(landIndex).toBeGreaterThan(0);
    expect(landIndex * DT).toBeCloseTo((2 * SKATE.jumpSpeed) / SKATE.gravity, 1);
    expect(states[landIndex].state).toBe("rolling");
    expect(states[landIndex].position[1]).toBe(0);
    expect(states[landIndex].speed).toBeGreaterThan(4);
  });

  it("does not jump again while the button stays held", () => {
    const { states } = runScript(roll(5), [{ frames: 90, input: { jump: true } }], { trace: true });
    expect(states.filter((s) => s.justJumped)).toHaveLength(1);
  });
});

describe("determinism", () => {
  it("gives the same end state for the same script", () => {
    const script = [
      { frames: 40, input: { push: true } },
      { frames: 30, input: { steer: 1 } },
      { frames: 1, input: { jump: true } },
      { frames: 60, input: { steer: -0.5 } },
      { frames: 30, input: { brake: true } },
    ];
    const a = runScript(createSkateState({ position: [-24, 0, 0] }), script, { env: greybox }).state;
    const b = runScript(createSkateState({ position: [-24, 0, 0] }), script, { env: greybox }).state;
    expect(a).toEqual(b);
    expect(a.tick).toBe(161);
  });
});

describe("on the greybox", () => {
  it("rolls up the curb onto the sidewalk", () => {
    const yawSouth = -Math.PI / 2; // heading (0, 0, +1)
    const { state } = runScript(roll(4, yawSouth, [0, 0, 4]), [{ frames: 60 }], { env: greybox });
    expect(state.position[2]).toBeGreaterThan(6);
    expect(state.position[1]).toBeCloseTo(0.15);
    expect(state.state).toBe("rolling");
  });

  it("stops at a building wall", () => {
    const yawNorth = Math.PI / 2; // heading (0, 0, -1)
    const { state } = runScript(roll(6, yawNorth, [0, 0.15, -8]), [{ frames: 60 }], { env: greybox });
    expect(state.position[2]).toBeGreaterThanOrEqual(-10.01);
    expect(state.speed).toBe(0);
  });

  it("stops at a ledge side instead of rolling through it", () => {
    const yawNorth = Math.PI / 2;
    const { state } = runScript(roll(4, yawNorth, [-12, 0.15, -6]), [{ frames: 60 }], { env: greybox });
    expect(state.position[2]).toBeGreaterThan(-6.75);
    expect(state.position[1]).toBeCloseTo(0.15);
  });

  it("launches off the quarter pipe and lands back on it", () => {
    // Climbing the 3 m pipe needs v^2 / (2 g) > 3, so about 11 m/s at g = 20.
    const { states } = runScript(roll(12, 0, [24.5, 0, 0]), [{ frames: 240 }], { env: greybox, trace: true });
    const launch = states.find((s) => s.state === "air");
    expect(launch).toBeTruthy();
    expect(launch.velocity[1]).toBeGreaterThan(3);
    expect(Math.abs(launch.velocity[0])).toBeLessThan(1.5);
    const apex = Math.max(...states.map((s) => s.position[1]));
    expect(apex).toBeGreaterThan(3.02);
    const landed = states.find((s) => s.justLanded);
    expect(landed).toBeTruthy();
    expect(landed.groundId).toBe("quarter-pipe");
    // After the landing the skater rolls back down toward -x.
    const after = states[states.length - 1];
    expect(after.position[0]).toBeLessThan(26);
    expect(Math.cos(after.yaw)).toBeLessThan(0);
  });

  it("rolls off the deck edge into the air", () => {
    const yawWest = Math.PI; // heading (-1, 0, 0)... deck is x 29..32, pipe below
    const { states } = runScript(roll(3, yawWest, [31, 3, 5.5]), [{ frames: 120 }], { env: greybox, trace: true });
    // Steer slightly so we leave the pipe width: start near the edge z = 5.5 and head off.
    expect(states.some((s) => s.state === "air")).toBe(true);
  });

  it("falls off the level edge", () => {
    const { state } = runScript(roll(5, 0, [100, 0, 100]), [{ frames: 10 }], { env: greybox });
    expect(state.state).toBe("air");
    expect(state.position[1]).toBeLessThan(0);
  });
});

describe("flat env", () => {
  it("is the default environment", () => {
    const s = stepSkate(roll(1), {}, DT);
    expect(s.groundId).toBe("flat");
    expect(FLAT_GROUND.sampleGround(5, 5).height).toBe(0);
  });
});

describe("quarter pipe, too slow", () => {
  it("rolls back down facing the other way", () => {
    const { states } = runScript(roll(7, 0, [24.5, 0, 0]), [{ frames: 240 }], { env: greybox, trace: true });
    expect(states.some((s) => s.state === "air")).toBe(false);
    const peak = Math.max(...states.map((s) => s.position[1]));
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(3);
    const last = states[states.length - 1];
    expect(Math.cos(last.yaw)).toBeLessThan(0);
    expect(last.position[0]).toBeLessThan(26);
  });
});

describe("air collisions", () => {
  it("does not land on a roof the jump never reached", () => {
    // Jump north off the sidewalk toward building-north (face at z = -10, roof at y = 8).
    const yawNorth = Math.PI / 2;
    const { states } = runScript(roll(8, yawNorth, [0, 0.15, -9]), [{ frames: 1, input: { jump: true } }, { frames: 60 }], { env: greybox, trace: true });
    expect(Math.max(...states.map((s) => s.position[1]))).toBeLessThan(1.5);
    expect(Math.min(...states.map((s) => s.position[2]))).toBeGreaterThan(-10.01);
    const last = states[states.length - 1];
    expect(last.state).toBe("rolling");
    expect(last.position[1]).toBeCloseTo(0.15);
  });

  it("still lands on a curb it hops onto", () => {
    const yawSouth = -Math.PI / 2;
    const { state } = runScript(roll(4, yawSouth, [0, 0, 4]), [{ frames: 1, input: { jump: true } }, { frames: 60 }], { env: greybox });
    expect(state.state).toBe("rolling");
    expect(state.position[1]).toBeCloseTo(0.15);
    expect(state.position[2]).toBeGreaterThan(6);
  });
});

describe("out-of-bounds recovery", () => {
  const level = { sampleGround: greybox.sampleGround, bounds: GREYBOX.bounds, spawn: GREYBOX.spawn };

  it("respawns a skater that falls below the level", () => {
    const s = roll(5, 0, [10, -4, 0]);
    s.state = "air";
    const next = stepSkate(s, {}, DT, level);
    expect(next.respawned).toBe(true);
    expect(next.position).toEqual(GREYBOX.spawn.position);
    expect(next.speed).toBe(0);
    expect(next.state).toBe("rolling");
  });

  it("respawns a skater past the level bounds", () => {
    const next = stepSkate(roll(5, 0, [GREYBOX.bounds.maxX + 2, 0, 0]), {}, DT, level);
    expect(next.respawned).toBe(true);
  });

  it("leaves a skater inside the level alone", () => {
    const next = stepSkate(roll(5, 0, [0, 0, 0]), {}, DT, level);
    expect(next.respawned).toBe(false);
  });
});
