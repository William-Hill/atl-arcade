// Trick input: grind stances (R6, F4) and the combo rules (R9, R10, F5 to
// F7) with the worked example of the GDD (3894, 3492, 325).
// docs/gdd/trick-input.md, Acceptance Criteria.
import { describe, expect, it } from "vitest";
import { BEAT, COMBO, GRIND } from "./constants.js";
import { beatFactor, comboBail, comboMove, comboTick, createCombo } from "./combo.js";
import { teleportRun } from "./run.js";
import { grindName } from "./tricks.js";
import { DT, fr, keys, rig, straightGrindable, vyFor } from "./trick-rig.js";

const BAL = GRIND.balanceDrift / GRIND.balanceCorrect;

// A skater 1 m before a ledge or rail at z = 0 (in snap range: the first GRIND tick snaps).
function toRail(id = "ledge:test", { length = 20, speed = 6, beat = null } = {}) {
  const g = straightGrindable(id, 0, length);
  return rig({ grindables: [g], speed, beat, position: [-1, 0, 0] });
}

describe("R6, F4: grind stances", () => {
  it("a ledge snap with a fresh left: the clip is grind_soul and the name is Ledge Soul Grind", () => {
    const r = toRail();
    const p = r.frame + 1;
    r.step({ grind: true, dirHist: keys([{ dir: "l", down: p - 3, up: null }]) });
    expect(r.s.state).toBe("grind");
    expect(r.s.trick).toMatchObject({ kind: "grind", id: "soul", clip: "grind_soul", name: "Ledge Soul Grind" });
  });

  it("a ledge snap with a fresh up and a grind under 10 m: Ledge Makio Grind, and the link is 100 + 35 x meters + 30", () => {
    const r = toRail("ledge:test", { length: 6 });
    r.step({ grind: true, flick: { grind: "u" } });
    r.steps(200, { grind: true, steer: BAL }, (run) => run.skater.justExited);
    const g = r.s.endedGrind;
    expect(g.distance).toBeLessThan(10);
    expect(r.moves.at(-1)).toMatchObject({ name: "Ledge Makio Grind", points: Math.round(100 + 35 * g.distance + 30) });
  });

  it("a neutral ledge snap under 10 m is Ledge Grind; at 12 m it is Long Ledge Grind; Makio at 12 m is Long Ledge Makio Grind", () => {
    expect(grindName("ledge:x", 6)).toBe("Ledge Grind");
    expect(grindName("ledge:x", 12)).toBe("Long Ledge Grind");
    expect(grindName("ledge:x", 12, "u")).toBe("Long Ledge Makio Grind");
    expect(grindName("rail:x", 12)).toBe("Long Rail Grind");
    const r = toRail("ledge:test", { length: 12.5, speed: 8 });
    r.step({ grind: true, flick: { grind: "n" } });
    r.steps(300, { grind: true, steer: BAL }, (run) => run.skater.justExited);
    expect(r.s.endedGrind.distance).toBeGreaterThanOrEqual(12);
    expect(r.moves.at(-1).name).toBe("Long Ledge Grind");
  });

  it("a GRIND tap 100 ms before the rail and a fresh right at the snap give the Unity stance", () => {
    // The rail is in snap range 1.2 m before its start; at 6 m/s 100 ms is 0.6 m.
    const g = straightGrindable("rail:test", 0, 20);
    const r = rig({ grindables: [g], speed: 6, position: [-1.2 - 0.6 - 0.05, 0, 0] });
    const p = r.frame + 1;
    r.step({ grind: true });
    let snapAt = null;
    r.steps(fr(150), (f) => ({ dirHist: keys([{ dir: "r", down: p + 3, up: null }]) }), (run) => {
      if (run.skater.justSnapped) snapAt = run.skater.time;
      return run.skater.state === "grind";
    });
    expect(r.s.state).toBe("grind");
    expect(snapAt - (p * DT)).toBeLessThanOrEqual(GRIND.buffer + 1e-6);
    expect(r.s.trick.id).toBe("unity");
  });

  it("a GRIND press at the snap with no fresh direction waits dirAfter: up 2 frames after the snap gives Makio, once", () => {
    const r = toRail();
    const p = r.frame + 1;
    r.step({ grind: true });
    expect(r.s.trick.id).toBe("edge");
    r.step({ grind: true, steer: BAL });
    const up = keys([{ dir: "u", down: p + 2, up: null }]);
    r.step({ grind: true, steer: BAL, dirHist: up });
    expect(r.s.trick.id).toBe("makio");
    r.steps(8, { grind: true, steer: BAL, dirHist: keys([{ dir: "u", down: p + 2, up: null }, { dir: "l", down: p + 5, up: null }]) });
    expect(r.s.trick.id).toBe("makio");
  });

  it("a touch flick token that is not a direction gives the neutral stance and no stance bonus", () => {
    const r = toRail("rail:test", { length: 4 });
    r.step({ grind: true, flick: { grind: "ul" } });
    expect(r.s.grind.stance).toBe("n");
    r.steps(200, { grind: true, steer: BAL }, (run) => run.skater.justExited);
    const g = r.s.endedGrind;
    expect(r.moves.at(-1)).toMatchObject({ name: "Rail Grind", points: Math.round(100 + 35 * g.distance) });
  });

  it("a new direction during the grind does not change the clip", () => {
    const r = toRail();
    r.step({ grind: true, flick: { grind: "l" } });
    const p = r.frame;
    r.steps(20, (f) => ({ grind: true, steer: BAL, dirHist: keys([{ dir: "u", down: p + 5, up: null }]) }));
    expect(r.s.state).toBe("grind");
    expect(r.s.trick.clip).toBe("grind_soul");
  });

  it("phone: the stance comes at the flick resolve, once, if the snap came first (R6)", () => {
    const r = toRail();
    r.step({ grind: true });
    expect(r.s.trick.id).toBe("edge");
    r.steps(3, { grind: true, steer: BAL });
    r.step({ grind: true, steer: BAL, flick: { grind: "u" } });
    expect(r.s.trick.id).toBe("makio");
    r.step({ grind: true, steer: BAL, flick: { grind: "l" } });
    expect(r.s.trick.id).toBe("makio");
  });
});

describe("R9, R10, F5 to F7: links, landings, beat, bank", () => {
  it("F6, the pure beat function in ms: 20 ms gives 1.75, 21 ms 1.5, 60 ms 1.5, 61 ms 1; a stumble or no beat clock gives 1", () => {
    expect(beatFactor(20)).toBe(1.75);
    expect(beatFactor(-20)).toBe(1.75);
    expect(beatFactor(21)).toBe(1.5);
    expect(beatFactor(60)).toBe(1.5);
    expect(beatFactor(61)).toBe(1);
    expect(beatFactor(0, true)).toBe(1);
    expect(beatFactor(null)).toBe(1);
    expect(BEAT.perfectMs).toBe(20);
    expect(BEAT.goodMs).toBe(60);
  });

  it("a stumble on the beat has B = 1", () => {
    const c = comboMove(createCombo(), { move: "air", name: "Japan Grab", points: 268, beat: { tag: "PERFECT", offsetMs: 0 }, landing: "stumble" });
    expect(c.links[0]).toMatchObject({ points: 134, landing: "stumble", tag: null, onBeat: false });
  });

  it("the beat judges the grind at the snap, the manual at the GRIND press, and the dance at its end", () => {
    const at = { snap: null, press: null };
    const judged = [];
    const beat = {
      judge(t) {
        judged.push(t);
        const perfect = [at.snap, at.press].some((x) => x != null && Math.abs(x - t) < 1e-6);
        return perfect ? { index: 0, offsetMs: 0, tag: "PERFECT", onBeat: true } : { index: 0, offsetMs: 200, tag: null, onBeat: false };
      },
    };
    // Grind: judged at the snap, scored at the exit.
    let r = toRail("ledge:test", { length: 4, beat });
    at.snap = r.s.time + DT; // the snap tick (the judge runs inside the step)
    r.step({ grind: true });
    expect(r.s.justSnapped).toBe(true);
    r.steps(200, { grind: true, steer: BAL }, (run) => run.skater.justExited);
    expect(r.s.time - at.snap).toBeGreaterThan(0.2);
    expect(r.moves.at(-1)).toMatchObject({ move: "grind", beatTag: "PERFECT" });
    // Manual: judged at the GRIND press.
    r = rig({ speed: 6, beat });
    r.step({});
    at.press = r.s.time + DT;
    r.step({ grind: true });
    r.steps(40, { grind: true, balance: 0 }, (run) => run.skater.manualEnd);
    r.step({});
    expect(r.moves.at(-1)).toMatchObject({ move: "manual", beatTag: "PERFECT" });
    // Dance: judged at its end.
    judged.length = 0;
    r = rig({ speed: 6, beat });
    r.step({ style1: true, flick: { style1: "n" } });
    r.steps(200, {}, (run) => run.skater.justStyled);
    expect(judged.at(-1)).toBeCloseTo(r.s.time, 9);
  });

  it("no beat clock: B = 1", () => {
    const r = rig({ speed: 6 }).air({ airFrom: "launch", vy: vyFor(0.5) });
    r.steps(60, {}, (run) => run.skater.justLanded);
    expect(r.moves[0]).toMatchObject({ points: 100, earned: 100, beatTag: null });
  });

  it("the same trick 4 times in one combo pays P, P x 0.5, P x 0.25, and 0, and the 4th adds no multiplier", () => {
    let c = createCombo();
    for (let i = 0; i < 4; i += 1) c = comboMove(c, { move: "air", name: "Japan Grab", points: 268 });
    expect(c.links.map((l) => l.points)).toEqual([268, 134, 67, 0]);
    expect(c.multiplier).toBe(3);
  });

  it("a combo with 10 scoring links: an 11th scoring link keeps the multiplier at 10", () => {
    let c = createCombo();
    for (let i = 0; i < 11; i += 1) c = comboMove(c, { move: "air", name: `Trick ${i}`, points: 100 });
    expect(c.multiplier).toBe(COMBO.maxMultiplier);
    expect(c.multiplier).toBe(10);
  });

  // F7: the worked example.
  const OFF = { index: 0, offsetMs: 80, tag: null, onBeat: false };
  const GOOD = { index: 0, offsetMs: 40, tag: "GOOD", onBeat: true };
  function workedExample(stumble = false) {
    let c = createCombo();
    c = comboMove(c, { move: "grind", name: "Long Ledge Grind", points: 100 + 35 * 12, beat: { index: 0, offsetMs: 200, tag: null, onBeat: false } });
    c = comboMove(c, { move: "manual", name: "Manual", points: 340, beat: GOOD });
    c = comboMove(c, { move: "air", name: "Japan Grab", points: 268, beat: OFF, landing: stumble ? "stumble" : "clean" });
    return c;
  }

  it("the F7 run (520, 510, 268) and 0.8 s of flat roll: pending 1298, multiplier 3, the score adds 3894", () => {
    let c = workedExample();
    expect(c.links.map((l) => l.points)).toEqual([520, 510, 268]);
    expect(c.pending).toBe(1298);
    expect(c.multiplier).toBe(3);
    for (let i = 0; i < fr(800); i += 1) c = comboTick(c, DT, false);
    expect(c.active).toBe(false);
    expect(c.score).toBe(3894);
  });

  it("with TRICK still held at the touchdown the air link pays 134: pending 1164, bank 3492", () => {
    let c = workedExample(true);
    expect(c.links[2].points).toBe(134);
    expect(c.pending).toBe(1164);
    for (let i = 0; i < fr(800); i += 1) c = comboTick(c, DT, false);
    expect(c.score).toBe(3492);
  });

  it("pending 1298 and a bail on a grind: the score adds 325, the speed is 0.5 times, and the style meter drops 0.5", () => {
    const c0 = { ...workedExample(), style: 0.75 };
    const c = comboBail(c0);
    expect(c.score - c0.score).toBe(325);
    expect(c.style).toBeCloseTo(0.25, 9);
    // The sim bail: a grind balance out.
    const r = toRail("rail:test", { length: 30 });
    r.step({ grind: true });
    r.setRun({ combo: c0 });
    let before = null;
    let along = null;
    r.steps(200, (f, rr) => {
      before = rr.s.speed;
      along = rr.s.velocity.map((v) => v / (Math.hypot(...rr.s.velocity) || 1)); // the rail direction
      return { grind: true, steer: 0 };
    }, (run) => run.skater.justFell);
    expect(r.s.justFell).toBe(true);
    expect(r.run.combo.score - c0.score).toBe(325);
    // The run reports the bail payout in bailBanked; banked is for combo banks only.
    expect(r.run.bailBanked).toBe(325);
    expect(r.run.banked).toBe(0);
    expect(r.run.combo.style).toBeCloseTo(0.25, 9);
    expect(Math.hypot(r.s.velocity[0], r.s.velocity[2])).toBeGreaterThan(before * GRIND.fallSpeedKeep - 0.01);
    // The speed along the rail after the bail is 0.5 times the speed of the
    // step before (the fall adds only a side push, GRIND.fallSideSpeed).
    const keep = r.s.velocity.reduce((sum, v, i) => sum + v * along[i], 0);
    expect(keep).toBeCloseTo(before * GRIND.fallSpeedKeep, 1);
    expect(GRIND.fallSpeedKeep).toBe(0.5);
  });

  it("a bail with 0 pending banks 0, and the style meter drops 0.5", () => {
    const c = comboBail({ ...createCombo(), style: 0.6 });
    expect(c.lastBanked).toBe(0);
    expect(c.score).toBe(0);
    expect(c.style).toBeCloseTo(0.1, 9);
  });

  it("a teleport ends the combo and the pending points are lost", () => {
    const r = rig({ speed: 6 });
    r.setRun({ combo: workedExample() });
    const run = teleportRun(r.run, null, { position: [5, 0, 5], yaw: 0 });
    expect(run.combo.pending).toBe(0);
    expect(run.combo.active).toBe(false);
    expect(run.skater.time).toBe(r.run.skater.time);
  });

  it("the same air with TRICK held 0.8 s up to the touchdown: the link is 134, the speed is 0.7 times, and the style meter drops 0.25", () => {
    const beat = { judge: () => OFF };
    // Held to the touchdown: 0.1 s before the grab, 0.8 s of hold.
    const r = rig({ beat, speed: 6 }).air({ airFrom: "launch", vy: vyFor(0.1 + 0.8 + DT) });
    r.setRun({ combo: { ...createCombo(), style: 0.5 } });
    while (r.frame < fr(100) + 1 - 1) r.step({});
    r.step({ style1: true, flick: { style1: "l" } });
    let before = null;
    r.steps(120, (f, rr) => {
      before = Math.hypot(rr.s.velocity[0], rr.s.velocity[2]); // the travel speed (the landing keeps it on flat ground)
      return { style1: true };
    }, (run) => run.skater.justLanded);
    expect(r.s.landing.result).toBe("stumble");
    expect(r.s.landing.hold).toBeCloseTo(0.8, 1);
    const full = r.moves.at(-1).points;
    // F3 for the same air: 100 + 120 + 60 * 0.8 = 268; F5 with stumbleKeep 0.5: 134.
    expect(full).toBe(268);
    expect(r.moves.at(-1)).toMatchObject({ name: "Japan Grab", landing: "stumble", earned: 134 });
    expect(r.run.combo.style).toBeCloseTo(0.25, 9);
    expect(r.s.speed).toBeCloseTo(before * 0.7, 6);
  });

  it("the grab ends the state.trick at the touchdown", () => {
    const r = rig({ speed: 6 }).air({ airFrom: "launch", vy: vyFor(0.5) });
    while (r.frame < fr(200) - 1) r.step({});
    r.step({ style1: true, flick: { style1: "u" } });
    expect(r.s.trick).toMatchObject({ kind: "grab", id: "rocket", held: true });
    r.step({});
    expect(r.s.trick.held).toBe(false);
    r.steps(60, {}, (run) => run.skater.justLanded);
    expect(r.s.trick).toBe(null);
  });
});
