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
  it("speeds up while the button is held and caps at maxSpeed", () => {
    const one = runScript(createSkateState(), [{ frames: 60, input: { push: true } }]).state;
    expect(one.speed).toBeGreaterThan(5);
    expect(one.speed).toBeLessThan(8);
    const two = runScript(createSkateState(), [{ frames: 120, input: { push: true } }]).state;
    expect(two.speed).toBeGreaterThan(10);
    const { state } = runScript(createSkateState(), [{ frames: 600, input: { push: true } }]);
    expect(state.speed).toBeLessThanOrEqual(SKATE.maxSpeed);
    expect(state.speed).toBeGreaterThan(SKATE.maxSpeed - 0.5);
  });

  it("gives the thrust in strokes: strong in the middle of a stroke, weak at its ends", () => {
    const { states } = runScript(createSkateState(), [{ frames: 24, input: { push: true } }], { trace: true });
    const gain = states.map((s, i) => s.speed - (i > 0 ? states[i - 1].speed : 0));
    const mid = Math.round(SKATE.pushCooldown / 2 / DT);
    expect(gain[mid]).toBeGreaterThan(gain[1] * 3);
    expect(gain[mid]).toBeGreaterThan(gain[22] * 3);
  });

  it("sets pushing while the button is held on the ground, and clears it on release", () => {
    const s = runScript(createSkateState(), [{ frames: 30, input: { push: true } }]).state;
    expect(s.pushing).toBe(true);
    const after = stepSkate(s, {}, DT);
    expect(after.pushing).toBe(false);
    expect(after.pushCooldown).toBeGreaterThan(0);
    expect(createSkateState().pushing).toBe(false);
  });

  it("stops the thrust when the button is released", () => {
    const s = runScript(createSkateState(), [{ frames: 60, input: { push: true } }]).state;
    const after = stepSkate(s, {}, DT);
    expect(after.speed).toBeLessThan(s.speed);
  });
});

describe("coast", () => {
  it("decays speed and moves forward along the heading", () => {
    const { state } = runScript(roll(8), [{ frames: 120 }]);
    expect(state.speed).toBeLessThan(5);
    expect(state.speed).toBeGreaterThan(2);
    expect(state.position[0]).toBeGreaterThan(8);
    expect(Math.abs(state.position[2])).toBeLessThan(1e-9);
  });

  it("loses half its speed from full speed in about 2 s and stops in about 6 s", () => {
    const half = runScript(roll(12), [{ frames: 120 }]).state;
    expect(half.speed).toBeLessThan(6.5);
    expect(half.speed).toBeGreaterThan(5);
    const stop = runScript(roll(12), [{ frames: 60 * 7 }]).state;
    expect(stop.speed).toBe(0);
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

  it("stops one body radius short of a wall, so the body stays out of it", () => {
    const yawNorth = Math.PI / 2;
    const { state } = runScript(roll(6, yawNorth, [0, 0.15, -8]), [{ frames: 60 }], { env: greybox });
    // The building face is at z = -10. The probe stops a move whose next
    // position is within one body radius, so the body keeps its full radius.
    expect(state.position[2]).toBeGreaterThanOrEqual(-10 + SKATE.bodyRadius - 1e-9);
    expect(state.bonked || state.speed === 0).toBe(true);
  });

  it("rolls up the greybox stairs at cruising speed without a bonk", () => {
    // Two 0.17 m treads in reach of the probe are two steps, not a wall.
    const { state } = runScript(roll(10, Math.PI, [-20.3, 0.15, 10]), [{ frames: 12 }], { env: greybox });
    expect(state.bonked).toBe(false);
    expect(state.speed).toBeGreaterThan(5);
  });

  it("stops at a ledge side instead of rolling through it", () => {
    const yawNorth = Math.PI / 2;
    const { state } = runScript(roll(4, yawNorth, [-12, 0.15, -6]), [{ frames: 60 }], { env: greybox });
    expect(state.position[2]).toBeGreaterThan(-6.75);
    expect(state.position[1]).toBeCloseTo(0.15);
  });

  it("launches off the quarter pipe and lands back on it", () => {
    // Climbing the 3 m pipe needs v^2 / (2 g) > 3, so about 11 m/s at g = 20.
    // The skater pushes on the run-in, as a player does.
    const { states } = runScript(roll(12, 0, [24.5, 0, 0]), [{ frames: 10, input: { push: true } }, { frames: 230 }], { env: greybox, trace: true });
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
    // At 6 m/s she leaves the edge. At a slow speed she can drop in on the
    // ramp face instead; the result depends on the frame at the lip.
    const { states } = runScript(roll(6, yawWest, [31, 3, 5.5]), [{ frames: 120 }], { env: greybox, trace: true });
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

describe("coyote time", () => {
  // Roll west off the deck edge, then press jump `late` frames after the skater leaves the ground.
  function offEdge(late) {
    let s = roll(6, Math.PI, [31, 3, 5.5]);
    for (let i = 0; i < 120 && s.state !== "air"; i += 1) s = stepSkate(s, {}, DT, greybox);
    expect(s.airFrom).toBe("edge");
    for (let i = 0; i < late; i += 1) s = stepSkate(s, {}, DT, greybox);
    return stepSkate(s, { jump: true }, DT, greybox);
  }

  it("jumps on a press just after a roll off an edge", () => {
    const s = offEdge(3);
    expect(s.justJumped).toBe(true);
    expect(s.airFrom).toBe("jump");
    expect(s.velocity[1]).toBeGreaterThan(SKATE.jumpSpeed - 1);
  });

  it("does not jump after the window", () => {
    const s = offEdge(Math.ceil(SKATE.coyoteTime / DT) + 1);
    expect(s.justJumped).toBe(false);
    expect(s.velocity[1]).toBeLessThan(0);
  });

  it("gives one jump only", () => {
    let s = offEdge(2);
    s = stepSkate(s, {}, DT, greybox);
    const vy = s.velocity[1];
    s = stepSkate(s, { jump: true }, DT, greybox);
    expect(s.justJumped).toBe(false);
    expect(s.velocity[1]).toBeLessThan(vy);
  });

  it("does not give a second jump after a normal jump", () => {
    let s = stepSkate(roll(6), { jump: true }, DT);
    s = stepSkate(s, {}, DT);
    s = stepSkate(s, { jump: true }, DT);
    expect(s.justJumped).toBe(false);
  });
});

describe("jump buffer", () => {
  // A hop on flat ground. Returns the hop state and the frame count to the landing.
  function hop() {
    let s = stepSkate(roll(5), { jump: true }, DT);
    let frames = 0;
    while (s.state === "air" && frames < 200) {
      s = stepSkate(s, {}, DT);
      frames += 1;
    }
    return frames;
  }

  // Hop, then press jump `early` frames before the landing frame.
  function pressBeforeLanding(early) {
    const land = hop();
    let s = stepSkate(roll(5), { jump: true }, DT);
    const out = [];
    for (let i = 1; i <= land + 3; i += 1) {
      s = stepSkate(s, { jump: i === land - early }, DT);
      out.push(s);
    }
    return out;
  }

  it("jumps on the first ground frame for a press just before the landing", () => {
    const states = pressBeforeLanding(3);
    expect(states.some((s) => s.justLanded)).toBe(true);
    const landed = states.findIndex((s) => s.justLanded);
    expect(states.slice(landed).some((s) => s.justJumped)).toBe(true);
  });

  it("drops a press made too long before the landing", () => {
    const states = pressBeforeLanding(Math.ceil(SKATE.jumpBuffer / DT) + 3);
    const landed = states.findIndex((s) => s.justLanded);
    expect(landed).toBeGreaterThan(0);
    expect(states.slice(landed).some((s) => s.justJumped)).toBe(false);
  });

  it("gives one jump for one press", () => {
    let s = stepSkate(roll(5), { jump: true }, DT);
    expect(s.justJumped).toBe(true);
    expect(s.jumpBuffer).toBe(0);
  });
});

describe("wall slide (#58)", () => {
  // building-north has its face at z = -10. The north sidewalk top is at y = 0.15.
  const FACE = -10;
  const clearance = (s) => s.position[2] - FACE;

  it("slides along a wall on a shallow approach and keeps the body out of it", () => {
    // Yaw 0.1 turns the heading a little to the north, toward the wall.
    const { state, states } = runScript(roll(8, 0.1, [0, 0.15, -9.2]), [{ frames: 90 }], { env: greybox, trace: true });
    expect(states.some((s) => s.wallSlide)).toBe(true);
    expect(states.some((s) => s.bonked)).toBe(false);
    expect(state.speed).toBeGreaterThan(0);
    expect(state.position[0]).toBeGreaterThan(5);
    for (const s of states) expect(clearance(s)).toBeGreaterThanOrEqual(SKATE.bodyRadius - 1e-9);
    // The heading turns parallel to the wall.
    expect(Math.abs(Math.sin(state.yaw))).toBeLessThan(1e-6);
  });

  it("loses only part of the speed on a slide", () => {
    const free = runScript(roll(8, 0, [0, 0.15, -8]), [{ frames: 90 }], { env: greybox }).state;
    const slid = runScript(roll(8, 0.1, [0, 0.15, -9.2]), [{ frames: 90 }], { env: greybox }).state;
    expect(slid.speed).toBeGreaterThan(free.speed * 0.8);
    expect(slid.speed).toBeLessThanOrEqual(free.speed + 1e-9);
  });

  it("still bonks on a head-on hit", () => {
    const nearHeadOn = Math.PI / 2 - 0.2; // 78 degrees to the wall
    const { state, states } = runScript(roll(6, nearHeadOn, [0, 0.15, -8]), [{ frames: 60 }], { env: greybox, trace: true });
    expect(states.some((s) => s.bonked)).toBe(true);
    expect(state.speed).toBe(0);
    for (const s of states) expect(clearance(s)).toBeGreaterThanOrEqual(SKATE.bodyRadius - 1e-9);
  });

  it("keeps moving when the skater skates parallel to a building within 0.25 m", () => {
    const { state, states } = runScript(roll(6, 0, [0, 0.15, FACE + 0.25]), [{ frames: 60 }], { env: greybox, trace: true });
    expect(states.some((s) => s.bonked)).toBe(false);
    expect(state.speed).toBeGreaterThan(3);
    expect(state.position[0]).toBeGreaterThan(4);
    expect(clearance(state)).toBeGreaterThanOrEqual(SKATE.bodyRadius - 1e-9);
  });

  it("slides along a wall in the air on a shallow approach", () => {
    const { states } = runScript(roll(8, 0.1, [0, 0.15, -9.5]), [{ frames: 1, input: { jump: true } }, { frames: 40 }], { env: greybox, trace: true });
    const air = states.filter((s) => s.state === "air");
    expect(air.some((s) => s.wallSlide)).toBe(true);
    expect(air.some((s) => s.bonked)).toBe(false);
    for (const s of states) expect(clearance(s)).toBeGreaterThanOrEqual(SKATE.bodyRadius - 1e-9);
    const last = states[states.length - 1];
    expect(Math.hypot(last.velocity[0], last.velocity[2])).toBeGreaterThan(4);
  });

  it("gives the same end state for the same slide script", () => {
    const script = [{ frames: 30, input: { push: true, steer: 0.3 } }, { frames: 60 }];
    const a = runScript(roll(6, 0.2, [0, 0.15, -9]), script, { env: greybox }).state;
    const b = runScript(roll(6, 0.2, [0, 0.15, -9]), script, { env: greybox }).state;
    expect(a).toEqual(b);
  });
});

describe("wall slide on other walls (#58)", () => {
  // A straight wall 2 m tall on the side n . (x, z) < c, turned by `angle`
  // from the x axis. Flat ground at y = 0 elsewhere; a drop to y = -2 past `dropX`.
  function wallEnv(angle, dropX = Infinity) {
    const n = [-Math.sin(angle), Math.cos(angle)]; // the wall normal, toward +z at angle 0
    return {
      n,
      dist: (p) => p[0] * n[0] + p[2] * n[1] + 1,
      sampleGround(x, z) {
        if (x * n[0] + z * n[1] < -1) return { height: 2, normal: [0, 1, 0], id: "wall" };
        if (x > dropX) return { height: -2, normal: [0, 1, 0], id: "low" };
        return { height: 0, normal: [0, 1, 0], id: "ground" };
      },
    };
  }

  it("slides parallel to a wall that is not on a ring axis, at a crawl too", () => {
    let maxHeadingError = 0;
    for (const angle of [0.1, 0.2, 0.3]) {
      for (const speed of [0.3, 0.6, 1, 2]) {
        const env = wallEnv(angle);
        // Yaw -angle is parallel to the wall; +0.4 rad turns the heading toward it.
        const start = [0, 0, -(1 - 0.34) / Math.cos(angle)];
        const { states } = runScript(roll(speed, -angle + 0.4, start), [{ frames: 90 }], { env, trace: true });
        expect(states.some((s) => s.bonked)).toBe(false);
        for (const s of states) expect(env.dist(s.position)).toBeGreaterThanOrEqual(SKATE.bodyRadius - 1e-9);
        const slide = states.find((s) => s.wallSlide && s.speed > 0);
        if (slide) maxHeadingError = Math.max(maxHeadingError, Math.abs(Math.sin(slide.yaw + angle)));
      }
    }
    expect(maxHeadingError).toBeLessThan(0.01);
  });

  it("rolls off an edge into the air during a slide, not a bonk", () => {
    const env = wallEnv(0, 2);
    // Parallel to the wall, 0.25 m from it: the slide pushes the body out and goes on.
    const { states } = runScript(roll(4, 0, [1.5, 0, -0.75]), [{ frames: 20 }], { env, trace: true });
    expect(states.some((s) => s.bonked)).toBe(false);
    expect(states.some((s) => s.state === "air" && s.airFrom === "edge")).toBe(true);
    expect(states[states.length - 1].position[0]).toBeGreaterThan(2);
  });
});
