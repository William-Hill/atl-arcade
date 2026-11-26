// #334: a late grab is void at the touchdown; a held grab is clean in
// one-button mode. #339: airYaw for spins, and points for a drop with a grab.
// docs/gdd/trick-input.md R4, R10, R12, F3. Times go through the frame
// helper of #343.
import { describe, expect, it } from "vitest";
import { TRICK } from "./constants.js";
import { halfTurns } from "./tricks.js";
import { DT, fr, rig, vyFor } from "./trick-rig.js";

// The landing tick of an air of `sec` s (on flat ground).
function landingFrame(sec) {
  const r = rig().air({ airFrom: "launch", vy: vyFor(sec) });
  r.steps(600, {}, (run) => run.skater.justLanded);
  return r.frame;
}

// A grab that starts `before` frames before the touchdown and is held through it.
function grabBefore(before, tricks = true, sec = 0.6) {
  const land = landingFrame(sec);
  const r = rig({ tricks }).air({ airFrom: "launch", vy: vyFor(sec) });
  while (r.frame < land - before - 1) r.step({});
  r.step({ style1: true, flick: { style1: "l" } });
  r.steps(60, { style1: true }, (run) => run.skater.justLanded);
  expect(r.frame).toBe(land);
  return r;
}

describe("#334: the late grab and the landing", () => {
  it("a grab that started 3 frames (0.05 s) before the touchdown and is held through it is void: no grab points, no stumble", () => {
    expect(fr(50)).toBe(3);
    const r = grabBefore(fr(50));
    expect(r.s.landing.result).toBe("clean");
    expect(r.s.landing.grab).toBe(null);
    expect(r.s.landing.voided).toMatchObject({ id: "japan" });
    // The link is the air with no grab: Ramp Air, the air points only.
    expect(r.moves.at(-1)).toMatchObject({ name: "Ramp Air", points: 100, landing: "clean" });
    // The grab clip blends out: no trick after the touchdown.
    expect(r.s.trick).toBe(null);
  });

  it("the sim decides at the touchdown event only: the grab is a full grab until the touchdown tick", () => {
    const land = landingFrame(0.6);
    const r = rig().air({ airFrom: "launch", vy: vyFor(0.6) });
    while (r.frame < land - 3 - 1) r.step({});
    r.step({ style1: true, flick: { style1: "l" } });
    // On the ticks before the touchdown the grab is live (no look-ahead).
    r.step({ style1: true });
    expect(r.s.trick).toMatchObject({ kind: "grab", id: "japan" });
    expect(r.s.landing).toBe(null);
    r.steps(60, { style1: true }, (run) => run.skater.justLanded);
    expect(r.s.landing.voided).not.toBe(null);
  });

  it("a grab older than landingGrace and held at the touchdown is a stumble; let go 1 frame before the touchdown it is clean", () => {
    // A grab that started 0.5 s before the touchdown.
    const r = grabBefore(fr(500), true, 0.8);
    expect(r.s.landing.result).toBe("stumble");
    expect(r.s.landing.grab).toMatchObject({ id: "japan" });
    const land = landingFrame(0.8);
    const r2 = rig().air({ airFrom: "launch", vy: vyFor(0.8) });
    while (r2.frame < land - fr(500) - 1) r2.step({});
    r2.step({ style1: true, flick: { style1: "l" } });
    while (r2.frame < land - 1 - 1) r2.step({ style1: true });
    r2.steps(60, {}, (run) => run.skater.justLanded); // let go 1 frame before
    expect(r2.frame).toBe(land);
    expect(r2.s.landing.result).toBe("clean");
    expect(r2.moves.at(-1).name).toBe("Japan Grab");
  });

  it("with landingGrace 0.2 s (Relaxed timing), a grab that starts 0.15 s before the touchdown is void and the landing is clean", () => {
    // With 0.1 s the same grab is a stumble.
    let r = grabBefore(fr(150));
    expect(r.s.landing.result).toBe("stumble");
    r = grabBefore(fr(150), { relaxed: true });
    expect(r.s.landing.result).toBe("clean");
    expect(r.s.landing.voided).toMatchObject({ id: "japan" });
    r = grabBefore(fr(150), { k: { landingGrace: 0.2 } });
    expect(r.s.landing.result).toBe("clean");
    expect(r.moves.at(-1).name).toBe("Ramp Air");
  });

  it("one-button mode: TRICK in 3 airs, held at each touchdown, gives Mute Grab, Japan Grab, and Side Grab, and every landing is clean", () => {
    const r = rig({ tricks: { oneButton: true }, speed: 6 });
    const names = [];
    for (let i = 0; i < 3; i += 1) {
      r.air({ airFrom: "launch", vy: vyFor(0.6) });
      r.steps(fr(200), {});
      r.step({ style1: true });
      r.steps(120, { style1: true }, (run) => run.skater.justLanded);
      expect(r.s.landing.result).toBe("clean");
      names.push(r.moves.at(-1).name);
      r.step({});
    }
    expect(names).toEqual(["Mute Grab", "Japan Grab", "Side Grab"]);
  });

  it("one-button mode: the 6th grab is the Mute Grab again (the set starts again after Tuck Knee)", () => {
    const r = rig({ tricks: { oneButton: true }, speed: 6 });
    const ids = [];
    for (let i = 0; i < 6; i += 1) {
      r.air({ airFrom: "launch", vy: vyFor(0.5) });
      r.steps(fr(200), {});
      r.step({ style1: true, flick: { style1: "r" } }); // one-button mode does not read the direction
      ids.push(r.s.trick.id);
      r.steps(120, {}, (run) => run.skater.justLanded);
      r.step({});
    }
    expect(ids).toEqual(["mute", "japan", "side", "rocket", "tuckknee", "mute"]);
  });
});

describe("#339: airYaw and the drop", () => {
  it("airYaw is the signed sum of the air turn with no wrap: a 200 degree turn out and 200 back gives 0 half turns", () => {
    const r = rig({ speed: 6 }).air({ airFrom: "ramp", vy: vyFor(1.6) });
    const n = Math.round((200 * Math.PI) / 180 / 6 / DT); // 200 degrees at 6 rad/s
    r.steps(n, { steer: 1 });
    expect(r.s.airYaw).toBeCloseTo(n * 6 * DT, 9); // 35 frames of 6 degrees: about 200 degrees
    expect(Math.abs((r.s.airYaw * 180) / Math.PI - 200)).toBeLessThan(3);
    // The wrapped yaw went past +180 degrees; airYaw does not wrap.
    expect(Math.abs(r.s.yaw)).toBeLessThan(Math.PI);
    r.steps(n, { steer: -1 });
    expect(r.s.airYaw).toBeCloseTo(0, 9);
    r.steps(200, {}, (run) => run.skater.justLanded);
    expect(halfTurns(r.s.landing.airYaw)).toBe(0);
    expect(r.moves.at(-1)).toMatchObject({ name: "Vert Air", points: 200 });
  });

  it("F3 uses |airYaw|: only full half turns pay (179 degrees 0, 181 degrees 1, -370 degrees 2)", () => {
    expect(halfTurns((179 * Math.PI) / 180)).toBe(0);
    expect(halfTurns((181 * Math.PI) / 180)).toBe(1);
    expect(halfTurns((-370 * Math.PI) / 180)).toBe(2);
    expect(halfTurns(20 * Math.PI)).toBe(TRICK.spinCapHalfTurns);
  });

  it("a vert air with a 180 in one direction pays one spin (40)", () => {
    const r = rig({ speed: 6 }).air({ airFrom: "ramp", vy: vyFor(0.8) });
    const n = Math.ceil(Math.PI / 6 / DT) + 2;
    r.steps(n, { steer: -1 });
    r.steps(200, {}, (run) => run.skater.justLanded);
    expect(r.s.landing.airYaw).toBeLessThan(-Math.PI);
    expect(r.moves.at(-1)).toMatchObject({ name: "Vert Air", points: 200 + 40 });
  });

  it("airYaw starts again at 0 in each air", () => {
    const r = rig({ speed: 6 }).air({ airFrom: "launch", vy: vyFor(0.5) });
    r.steps(10, { steer: 1 });
    r.steps(200, {}, (run) => run.skater.justLanded);
    expect(r.s.airYaw).toBeGreaterThan(0.5);
    r.step({ jump: true });
    expect(r.s.state).toBe("air");
    expect(r.s.airYaw).toBe(0);
  });

  it("a roll off an edge (airFrom edge) has airBase 0: with no grab no link; with a Japan Grab the link is the grab name with 120 + the hold pay", () => {
    let r = rig({ speed: 6 }).air({ airFrom: "edge", vy: vyFor(0.6) });
    r.steps(200, {}, (run) => run.skater.justLanded);
    expect(r.moves).toHaveLength(0);

    r = rig({ speed: 6 }).air({ airFrom: "edge", vy: vyFor(0.6) });
    r.steps(fr(150), {});
    r.step({ style1: true, flick: { style1: "l" } });
    r.steps(fr(200) - 1, { style1: true });
    r.steps(200, {}, (run) => run.skater.justLanded);
    const hold = r.s.landing.hold;
    expect(hold).toBeCloseTo(0.2, 6);
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0]).toMatchObject({ name: "Japan Grab", points: Math.round(120 + TRICK.holdRate * hold) });
    expect(r.moves[0].points).toBe(132);
  });
});
