// Trick input: the fresh direction (R3, R3a, R11 sim side) and air grabs
// (R4, R5, F3). docs/gdd/trick-input.md, Acceptance Criteria. Times go
// through the frame helper of #343 (`fr` = msToFrame).
import { describe, expect, it } from "vitest";
import { COMBO, TRICK } from "./constants.js";
import { airPoints } from "./tricks.js";
import { DT, at, fr, keys, rig, vyFor } from "./trick-rig.js";

// An air of `sec` s off a kicker (airFrom "launch", airBase 100).
const inAir = (sec, opts = {}) => rig(opts).air({ airFrom: "launch", vy: vyFor(sec) });

// Step until frame `f` (the sim time at(f)) with `input`.
function until(r, f, input = {}) {
  while (r.frame < f - 1) r.step(input);
  return r;
}

describe("R3: the fresh direction", () => {
  it("a ramp air of 0.3 s: A starts 100 ms before Q gives the Japan Grab and air_japan at the Q frame", () => {
    const r = inAir(0.3);
    const q = fr(200); // Q at 200 ms into the air
    until(r, q);
    r.step({ style1: true, dirHist: keys([{ dir: "l", down: q - fr(100), up: null }]) });
    expect(r.frame).toBe(q);
    expect(r.s.trick).toMatchObject({ kind: "grab", id: "japan", clip: "air_japan" });
  });

  it("a fresh left at the Q press stays left when up starts 2 frames after the press", () => {
    const r = inAir(0.6);
    const q = fr(200);
    until(r, q);
    const l = { dir: "l", down: q - 3, up: null };
    r.step({ style1: true, dirHist: keys([l]) });
    r.step({ style1: true, dirHist: keys([l]) });
    r.step({ style1: true, dirHist: keys([l, { dir: "u", down: q + 2, up: null }]) });
    expect(r.s.trick.id).toBe("japan");
  });

  it("the axis rule (R3a): W down 15 frames (250 ms) before Q and still held gives the Rocket Grab; the R3 rule only gives the Mute Grab", () => {
    expect(fr(250)).toBe(15);
    for (const [k, want] of [[{}, "rocket"], [{ axisRule: false }, "mute"]]) {
      const r = inAir(0.6, { tricks: { k } });
      const q = fr(300);
      until(r, q);
      const hist = keys([{ dir: "u", down: q - fr(250), up: null }]);
      r.step({ style1: true, dirHist: hist });
      // With no fresh direction the press waits dirAfter (60 ms = 4 frames).
      r.steps(fr(TRICK.dirAfter * 1000), { style1: true, dirHist: hist });
      expect(r.s.trick.id).toBe(want);
    }
  });

  it("the axis rule (R3a): W tapped at frame -6 and D down at frame -3 gives the Rocket Grab; the R3 rule only gives the Side Grab", () => {
    for (const [k, want] of [[{}, "rocket"], [{ axisRule: false }, "side"]]) {
      const r = inAir(0.6, { tricks: { k } });
      const q = fr(300);
      until(r, q);
      r.step({ style1: true, dirHist: keys([{ dir: "u", down: q - 6, up: q - 5 }, { dir: "r", down: q - 3, up: null }]) });
      expect(r.s.trick.id).toBe(want);
    }
  });

  it("the same direction from the keyboard (dirHist), a gamepad (lastDir and lastDirAt), and a touch flick gives the same trick id", () => {
    const ids = [];
    for (const dirInput of [
      (q) => ({ dirHist: keys([{ dir: "r", down: q - 2, up: null }]) }),
      (q) => ({ dir: "r", lastDir: "r", lastDirAt: at(q - 2) }),
      () => ({ flick: { style1: "r" } }),
    ]) {
      const r = inAir(0.6);
      const q = fr(200);
      until(r, q);
      r.step({ style1: true, ...dirInput(q) });
      ids.push(r.s.trick.id);
    }
    expect(ids).toEqual(["side", "side", "side"]);
  });

  it("a touch flick right gives the Side Grab in the press frame; a tap (neutral flick) gives the Mute Grab", () => {
    let r = inAir(0.6);
    until(r, fr(200));
    r.step({ style1: true, flick: { style1: "r" } });
    expect(r.s.trick.id).toBe("side");
    r = inAir(0.6);
    until(r, fr(200));
    r.step({ style1: true, flick: { style1: "n" } });
    expect(r.s.trick.id).toBe("mute");
  });

  it("Relaxed timing: a direction that starts 240 ms before the press counts", () => {
    for (const [tricks, want] of [[true, "mute"], [{ relaxed: true }, "japan"]]) {
      const r = inAir(0.8, { tricks });
      const q = fr(400);
      until(r, q);
      const hist = keys([{ dir: "l", down: q - fr(240), up: q - fr(200) }]);
      r.step({ style1: true, dirHist: hist });
      r.steps(fr(100), { style1: true, dirHist: hist });
      expect(r.s.trick.id).toBe(want);
    }
  });
});

describe("R4, R5: grabs", () => {
  it("an air of 0.09 s gives no grab at the press; at 0.11 s a grab starts", () => {
    let r = inAir(0.6);
    until(r, fr(90));
    r.step({ style1: true });
    r.steps(fr(60), { style1: true });
    expect(r.s.trick).toBe(null);
    expect(r.s.grab).toBe(null);
    r = inAir(0.6);
    until(r, fr(110) + 1); // airTime 0.117 s at the press (frames count from the first air tick)
    r.step({ style1: true });
    r.steps(fr(60), { style1: true });
    expect(r.s.trick?.kind).toBe("grab");
  });

  it("a second TRICK press in the same air does not change the grab", () => {
    const r = inAir(0.8);
    until(r, fr(200));
    r.step({ style1: true, flick: { style1: "l" } });
    r.steps(3, {});
    r.step({ style1: true, flick: { style1: "r" } });
    expect(r.s.trick.id).toBe("japan");
  });

  it("an air of 0.15 s with TRICK pressed adds no link (COMBO.minAirTime 0.2 s)", () => {
    const r = inAir(0.15);
    until(r, fr(110) + 1);
    r.step({ style1: true, flick: { style1: "l" } });
    r.steps(30, {}, (run) => run.skater.justLanded);
    expect(r.s.justLanded).toBe(true);
    expect(r.run.combo.links).toHaveLength(0);
  });

  it("SPIN in the air starts no trick", () => {
    const r = inAir(0.6);
    until(r, fr(200));
    r.step({ style2: true, flick: { style2: "l" } });
    r.steps(fr(100), { style2: true });
    expect(r.s.trick).toBe(null);
  });

  it("TRICK with up and, in a second air, with down give air_rocket and air_tuckknee", () => {
    const clips = [];
    for (const d of ["u", "d"]) {
      const r = inAir(0.6);
      until(r, fr(200));
      r.step({ style1: true, flick: { style1: d } });
      clips.push(r.s.trick.clip);
    }
    expect(clips).toEqual(["air_rocket", "air_tuckknee"]);
  });

  it("a ramp air with no press: no trick, and the link is Ramp Air with the air points only", () => {
    const r = inAir(0.5);
    r.steps(60, {}, (run) => run.skater.justLanded);
    expect(r.s.trick).toBe(null);
    expect(r.moves).toMatchObject([{ name: "Ramp Air", points: COMBO.rampAirPoints }]);
  });

  it("a ramp air with a Japan Grab held 0.8 s, let go 0.15 s before a touchdown 80 ms off the beat: the link is 268", () => {
    const beat = { judge: () => ({ index: 0, offsetMs: 80, tag: null, onBeat: false }) };
    const air = 0.1 + 0.8 + 0.15;
    const r = rig({ beat }).air({ airFrom: "launch", vy: vyFor(air) });
    until(r, fr(100) + 1);
    const g = fr(800);
    r.step({ style1: true, flick: { style1: "l" } });
    r.steps(g - 1, { style1: true });
    r.steps(120, {}, (run) => run.skater.justLanded);
    const land = r.s.landing;
    expect(land.result).toBe("clean");
    expect(land.hold).toBeCloseTo(0.8, 6);
    expect(land.airTime - land.hold - 0.1).toBeGreaterThan(0.1); // let go well before the touchdown
    expect(r.moves).toMatchObject([{ name: "Japan Grab", points: 268, earned: 268 }]);
  });

  it("a neutral grab has trickBase 80; a direction grab 120", () => {
    expect(TRICK.trickBaseNeutral).toBe(80);
    expect(airPoints({ base: 100, grab: "neutral" })).toBe(180);
    expect(airPoints({ base: 100, grab: "dir" })).toBe(220);
    const r = inAir(0.6);
    until(r, fr(200));
    r.step({ style1: true, flick: { style1: "n" } });
    r.steps(60, {}, (run) => run.skater.justLanded);
    expect(r.moves[0]).toMatchObject({ name: "Mute Grab", points: Math.round(100 + 80 + 60 * DT) });
  });

  it("a ramp air with a grab held 3 s: the hold part of the points is 90", () => {
    expect(airPoints({ base: 100, grab: "dir", tHold: 3 }) - airPoints({ base: 100, grab: "dir", tHold: 0 })).toBe(90);
  });

  it("a vert air with a 180 and a grab held 0.8 s: P is 408; 8 half turns: the spin part is 240", () => {
    expect(airPoints({ base: COMBO.vertAirPoints, grab: "dir", tHold: 0.8, airYaw: Math.PI })).toBe(408);
    expect(airPoints({ base: 0, airYaw: 8 * Math.PI })).toBe(240);
  });

  it("an air with a 90 degree turn lands clean with TRICK let go", () => {
    const r = inAir(0.6);
    until(r, fr(200));
    r.step({ style1: true, flick: { style1: "l" } });
    r.step({});
    // 90 degrees at 6 rad/s: about 0.26 s of steer.
    const n = Math.round(Math.PI / 2 / 6 / DT);
    r.steps(n, { steer: 1 });
    r.steps(60, {}, (run) => run.skater.justLanded);
    expect(Math.abs(r.s.landing.airYaw)).toBeCloseTo(Math.PI / 2, 1);
    expect(r.s.landing.result).toBe("clean");
  });
});
