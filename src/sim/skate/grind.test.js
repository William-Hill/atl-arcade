import { describe, expect, it } from "vitest";
import { GRIND, SKATE } from "./constants.js";
import { findSnap, prepareGrindables, startGrind, stepGrind } from "./grind.js";
import { createSkater, createSkaterEnv, runSkaterScript, stepSkater } from "./skater.js";
import { GREYBOX } from "../../level/greybox.js";
import { createGroundSampler } from "../../level/ground.js";
import { pointAtDistance } from "../../level/splines.js";

const DT = 1 / 60;
const BAL_STEER = GRIND.balanceDrift / GRIND.balanceCorrect;
const env = { sampleGround: createGroundSampler(GREYBOX) };
const skaterEnv = createSkaterEnv(GREYBOX);
const grindables = skaterEnv.grindables;
const straight = grindables.find((g) => g.id === "rail-straight");

function skaterAt(position, yaw, speed, state = "rolling") {
  const s = createSkater(GREYBOX, { position, yaw });
  s.speed = speed;
  const h = [Math.cos(yaw), 0, -Math.sin(yaw)];
  s.velocity = [h[0] * speed, 0, h[2] * speed];
  s.state = state;
  return s;
}

describe("prepareGrindables", () => {
  it("samples all five rails and ledges into polylines", () => {
    expect(grindables.map((g) => g.id).sort()).toEqual(["ledge-north", "ledge-south", "rail-curved", "rail-kinked", "rail-straight"]);
    expect(straight.total).toBeCloseTo(12);
    expect(grindables.find((g) => g.id === "rail-curved").points.length).toBe(17);
  });
});

describe("findSnap", () => {
  it("snaps inside the radius and refuses outside it", () => {
    // Rail at z = -2, y = 0.6. Skater rolling on the street at y = 0.
    expect(findSnap(grindables, skaterAt([-15, 0, -2 + GRIND.snapRadius - 0.1], 0, 6))).not.toBeNull();
    expect(findSnap(grindables, skaterAt([-15, 0, -2 + GRIND.snapRadius + 0.2], 0, 6))).toBeNull();
  });

  it("refuses a rail far below the feet or far above them", () => {
    expect(findSnap(grindables, skaterAt([-15, 0.6 + GRIND.snapBelow + 0.2, -2], 0, 6, "air"))).toBeNull();
    expect(findSnap(grindables, skaterAt([-15, 0.6 - GRIND.snapAbove - 0.2, -2], 0, 6))).toBeNull();
  });

  it("snaps only when moving roughly along the spline", () => {
    expect(findSnap(grindables, skaterAt([-15, 0, -2], Math.PI / 2, 6))).toBeNull(); // crossing it
    const forward = findSnap(grindables, skaterAt([-15, 0, -2], 0, 6));
    const backward = findSnap(grindables, skaterAt([-15, 0, -2], Math.PI, 6));
    expect(forward.direction).toBe(1);
    expect(backward.direction).toBe(-1);
    expect(forward.s).toBeCloseTo(5);
  });

  it("picks the nearest of two candidates", () => {
    const near = findSnap(grindables, skaterAt([-12, 0.15, -6.6], 0, 5));
    expect(near.grindable.id).toBe("ledge-north");
  });
});

describe("startGrind and stepGrind", () => {
  it("puts the skater on the rail with the tangent heading and at least the floor speed", () => {
    const snap = findSnap(grindables, skaterAt([-15, 0.3, -1.5], 0.2, 1, "air"));
    const g = startGrind(skaterAt([-15, 0.3, -1.5], 0.2, 1, "air"), snap);
    expect(g.state).toBe("grind");
    expect(g.position[1]).toBeCloseTo(0.6);
    expect(g.position[2]).toBeCloseTo(-2);
    expect(g.yaw).toBeCloseTo(0);
    expect(g.speed).toBeGreaterThanOrEqual(GRIND.minSpeed);
    expect(g.justSnapped).toBe(true);
  });

  it("drifts off balance with no input and falls past the limit", () => {
    let s = startGrind(skaterAt([-19, 0, -2], 0, 6), findSnap(grindables, skaterAt([-19, 0, -2], 0, 6)), 1);
    const balances = [];
    for (let i = 0; i < 90 && s.state === "grind"; i += 1) {
      s = stepGrind(s, {}, DT, grindables);
      if (s.grind) balances.push(s.grind.balance);
    }
    expect(balances[10]).toBeGreaterThan(0);
    expect(balances[30]).toBeGreaterThan(balances[10]);
    expect(s.state).toBe("air");
    expect(s.justFell).toBe(true);
    expect(s.exitReason).toBe("fall");
    expect(s.velocity[2]).not.toBe(0); // pushed off the side
  });

  it("holds balance with a correction in the lean direction", () => {
    let s = startGrind(skaterAt([-19, 0, -2], 0, 6), findSnap(grindables, skaterAt([-19, 0, -2], 0, 6)), 1);
    for (let i = 0; i < 60; i += 1) s = stepGrind(s, { steer: GRIND.balanceDrift / GRIND.balanceCorrect }, DT, grindables);
    expect(s.state).toBe("grind");
    expect(Math.abs(s.grind.balance)).toBeLessThan(0.05);
  });

  it("corrects a lean back toward zero", () => {
    let s = startGrind(skaterAt([-19, 0, -2], 0, 6), findSnap(grindables, skaterAt([-19, 0, -2], 0, 6)), 1);
    for (let i = 0; i < 20; i += 1) s = stepGrind(s, {}, DT, grindables);
    const leaned = s.grind.balance;
    for (let i = 0; i < 20; i += 1) s = stepGrind(s, { steer: 1 }, DT, grindables);
    expect(s.grind.balance).toBeLessThan(leaned);
  });

  it("launches with the tangent velocity at the end of the spline", () => {
    let s = startGrind(skaterAt([-9.5, 0, -2], 0, 6), findSnap(grindables, skaterAt([-9.5, 0, -2], 0, 6)), 1);
    const speedOnRail = s.speed;
    let ticks = 0;
    while (s.state === "grind" && ticks < 120) {
      s = stepGrind(s, { steer: 0.25 }, DT, grindables);
      ticks += 1;
    }
    expect(s.exitReason).toBe("end");
    expect(s.justExited).toBe(true);
    expect(s.position[0]).toBeCloseTo(-8, 1);
    expect(s.velocity[0]).toBeGreaterThan(speedOnRail - GRIND.friction * 2);
    expect(s.velocity[1]).toBeCloseTo(GRIND.endPop);
    expect(Math.abs(s.velocity[2])).toBeLessThan(1e-9);
  });

  it("exits early with a jump that adds the jump speed", () => {
    let s = startGrind(skaterAt([-15, 0, -2], 0, 6), findSnap(grindables, skaterAt([-15, 0, -2], 0, 6)), 1);
    s = stepGrind(s, { jump: true }, DT, grindables);
    expect(s.state).toBe("air");
    expect(s.exitReason).toBe("jump");
    expect(s.velocity[1]).toBeCloseTo(SKATE.jumpSpeed);
  });
});

describe("every rail and ledge in the greybox", () => {
  const starts = {
    "rail-straight": { position: [-20.5, 0, -2], yaw: 0 },
    "rail-kinked": { position: [-4.5, 0, 2.5], yaw: 0 },
    "rail-curved": { position: [13.5, 0, -1], yaw: 0 },
    "ledge-north": { position: [-16.5, 0.15, -6.7], yaw: 0 },
    "ledge-south": { position: [7.5, 0.15, 6.7], yaw: 0 },
  };

  for (const g of grindables) {
    it(`grinds ${g.id} end to end`, () => {
      const start = starts[g.id];
      let s = skaterAt(start.position, start.yaw, 6);
      const script = [{ frames: 240, input: { grind: true, steer: GRIND.balanceDrift / GRIND.balanceCorrect } }];
      const { states } = runSkaterScript(s, script, { env, skaterEnv, trace: true });
      const snapped = states.find((x) => x.justSnapped);
      expect(snapped, "snapped").toBeTruthy();
      expect(snapped.grind.id).toBe(g.id);
      const exited = states.find((x) => x.exitReason === "end");
      expect(exited, "reached the end").toBeTruthy();
      const endPoint = pointAtDistance(g.points, g.total).point;
      expect(exited.position[0]).toBeCloseTo(endPoint[0], 0);
      expect(exited.position[2]).toBeCloseTo(endPoint[2], 0);
      expect(states.some((x) => x.justFell)).toBe(false);
      expect(states[states.length - 1].stats.exits).toBe(1);
    });
  }

  it("turns at the kink and follows the curve", () => {
    const kinked = runSkaterScript(skaterAt([-4.5, 0, 2.5], 0, 6), [{ frames: 150, input: { grind: true, steer: 0.25 } }], { env, skaterEnv, trace: true }).states;
    const yaws = kinked.filter((x) => x.state === "grind").map((x) => x.yaw);
    // The kink bends toward -z, which is a left turn: positive yaw.
    expect(Math.min(...yaws)).toBeCloseTo(0, 1);
    expect(Math.max(...yaws)).toBeGreaterThan(0.3);
    const curved = runSkaterScript(skaterAt([13.5, 0, -1], 0, 6), [{ frames: 150, input: { grind: true, steer: 0.25 } }], { env, skaterEnv, trace: true }).states;
    const cy = curved.filter((x) => x.state === "grind").map((x) => x.yaw);
    expect(cy[cy.length - 1]).toBeGreaterThan(1.2); // ends heading -z (yaw pi/2)
  });
});

describe("skater orchestration", () => {
  it("does not snap again right after an exit", () => {
    let s = skaterAt([-15, 0, -2], 0, 6);
    s = stepSkater(s, { grind: true }, DT, env, skaterEnv);
    expect(s.state).toBe("grind");
    s = stepSkater(s, { grind: true, jump: true }, DT, env, skaterEnv);
    expect(s.state).toBe("air");
    expect(s.grindCooldown).toBeCloseTo(GRIND.resnapCooldown);
    s = stepSkater(s, { grind: true }, DT, env, skaterEnv);
    expect(s.state).toBe("air");
  });

  it("counts falls and lands rolling after one", () => {
    const { states, state } = runSkaterScript(skaterAt([-19, 0, -2], 0, 6), [{ frames: 240, input: { grind: true } }], { env, skaterEnv, trace: true });
    // The grind button stays held, so the skater re-snaps after landing and may fall again.
    expect(state.stats.falls).toBeGreaterThanOrEqual(1);
    const fall = states.find((x) => x.justFell);
    const land = states.slice(states.indexOf(fall)).find((x) => x.justLanded);
    expect(land).toBeTruthy();
    expect(land.state).toBe("rolling");
    expect(state.stats.snaps).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic", () => {
    const script = [{ frames: 60, input: { push: true } }, { frames: 120, input: { grind: true, steer: 0.2 } }, { frames: 60 }];
    const a = runSkaterScript(createSkater(GREYBOX, { position: [-24, 0, -2] }), script, { env, skaterEnv }).state;
    const b = runSkaterScript(createSkater(GREYBOX, { position: [-24, 0, -2] }), script, { env, skaterEnv }).state;
    expect(a).toEqual(b);
  });
});

describe("one-tick flags on the rail", () => {
  it("clears justJumped and justLanded after the snap tick", () => {
    // Jump and grind on the same tick beside the straight rail.
    let s = skaterAt([-15, 0, -2], 0, 6);
    s = stepSkater(s, { grind: true, jump: true }, DT, env, skaterEnv);
    expect(s.state).toBe("grind");
    const after = [];
    for (let i = 0; i < 20; i += 1) {
      s = stepSkater(s, { grind: true, steer: BAL_STEER }, DT, env, skaterEnv);
      after.push(s);
    }
    expect(after.every((x) => x.state === "grind")).toBe(true);
    expect(after.some((x) => x.justJumped || x.justLanded || x.bonked)).toBe(false);
  });
});

describe("respawn stats", () => {
  it("counts a respawn", () => {
    const lost = skaterAt([10, -5, 0], 0, 3, "air");
    const s = stepSkater(lost, {}, DT, { ...env, bounds: GREYBOX.bounds, spawn: GREYBOX.spawn }, skaterEnv);
    expect(s.respawned).toBe(true);
    expect(s.stats.respawns).toBe(1);
  });
});
