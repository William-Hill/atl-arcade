import { describe, expect, it } from "vitest";
import { createOneButton, oneButtonFrame, oneButtonNeedsRail, ONE_BUTTON_HOLD } from "../../input/one-button.js";
import { DT, fr, rig, straightGrindable, vyFor } from "./trick-rig.js";
import { oneButtonContext } from "./skater.js";

// #328: the connection of one-button mode. The game loop (src/main.js
// sampleInput) gives stepOneButton() the sim context and puts its intent on
// the frame; the sim applies it. These tests run the same 2 calls as the game.
function obRig(opts = {}) {
  const r = rig({ tricks: { oneButton: true }, ...opts });
  const skaterEnv = { grindables: opts.grindables ?? [], skater: opts.skater ?? "nia" };
  let ob = createOneButton();
  const frames = [];
  // One frame with TRICK `trick` (and other input fields).
  r.ob = (trick, input = {}) => {
    const frame = { ...input, style1: Boolean(trick), oneButton: true };
    const t = r.s.time + DT;
    const ctx = oneButtonContext(r.s, skaterEnv, { rail: oneButtonNeedsRail(ob, frame) });
    const out = oneButtonFrame(ob, frame, ctx, t);
    ob = out.ob;
    frames.push(out.frame);
    return r.step(out.frame);
  };
  r.obSteps = (n, trick, input = {}, until = null) => {
    for (let i = 0; i < n; i += 1) {
      r.ob(trick, input);
      if (until && until(r.run)) break;
    }
  };
  r.frames = frames;
  return r;
}

// A tap: TRICK down for `frames` frames, then up for one frame.
function tap(r, frames = 3, input = { push: true }) {
  r.obSteps(frames, true, input);
  r.ob(false, input);
}

describe("#328 one-button context from the sim", () => {
  it("maps the skater state to the context of stepOneButton()", () => {
    const g = straightGrindable("rail:test", 0, 20);
    const env = { grindables: [g], skater: "marcus" };
    const r = rig({ grindables: [g], speed: 6, position: [-1, 0, 0] });
    expect(oneButtonContext(r.s, env)).toEqual({ state: "ground", railInRange: true, skater: "marcus" });
    expect(oneButtonContext(r.s, env, { rail: false }).railInRange).toBe(false);
    expect(oneButtonContext({ ...r.s, state: "air" }, env).state).toBe("air");
    expect(oneButtonContext({ ...r.s, state: "grind" }, env)).toMatchObject({ state: "grind", railInRange: false });
    expect(oneButtonContext({ ...r.s, manual: { balance: 0 } }, env).state).toBe("manual");
    // Far from the rail, and with no grindables.
    expect(oneButtonContext({ ...r.s, position: [-30, 0, 9] }, env).railInRange).toBe(false);
    expect(oneButtonContext(r.s, { grindables: [] }).railInRange).toBe(false);
    // A grind cooldown blocks the snap, so no rail is in range.
    expect(oneButtonContext({ ...r.s, grindCooldown: 0.2 }, env).railInRange).toBe(false);
  });

  it("the ledge catch (#262): just after a bonk the rail is in range at the wider catch angle", () => {
    const g = straightGrindable("ledge:test", 0, 20);
    const env = { grindables: [g], skater: "nia" };
    // 70 degrees to the ledge: |cos| 0.34 is under minAlongDot (0.5) and over catchAlongDot (0.2).
    const s = { ...rig({ grindables: [g], position: [5, 0, 0.5] }).s, yaw: (70 * Math.PI) / 180 };
    expect(oneButtonContext(s, env).railInRange).toBe(false);
    expect(oneButtonContext({ ...s, bonkCatch: { speed: 6, left: 0.2 } }, env).railInRange).toBe(true);
  });

  it("does the rail search only while TRICK is down or was down", () => {
    const ob = createOneButton();
    expect(oneButtonNeedsRail(ob, { style1: false })).toBe(false);
    expect(oneButtonNeedsRail(ob, { style1: true })).toBe(true);
    expect(oneButtonNeedsRail({ ...ob, down: true }, { style1: false })).toBe(true);
  });
});

describe("#328 one-button intent in the sim (R12.1)", () => {
  it("AC: a rail in snap range: the TRICK press snaps the skater to the rail, and the hold stays on it", () => {
    const g = straightGrindable("rail:test", 0, 20);
    const r = obRig({ grindables: [g], speed: 6, position: [-1, 0, 0] });
    r.ob(true);
    expect(r.frames[0].grind).toBe(true);
    expect(r.s.state).toBe("grind");
    r.obSteps(20, true, { steer: 0 });
    expect(r.s.state).toBe("grind");
    expect(r.s.style).toBeNull();
  });

  it("AC: on the ground with no rail, a TRICK tap starts the next dance of the set at the release", () => {
    const r = obRig({ speed: 5 });
    r.obSteps(5, true, { push: true });
    expect(r.s.style).toBeNull(); // nothing at the press
    r.ob(false, { push: true });
    expect(r.s.style).toMatchObject({ name: "Bankhead Bounce", clip: "dance_bankhead" });
    expect(r.s.trick).toMatchObject({ kind: "dance", name: "Bankhead Bounce" });
  });

  it("AC: a TRICK hold of 0.5 s starts a manual and no dance; the release ends the manual clean", () => {
    const r = obRig({ speed: 6 });
    r.obSteps(fr(ONE_BUTTON_HOLD * 1000) - 1, true);
    expect(r.s.manual).toBeNull();
    r.obSteps(2, true);
    expect(r.s.manual).not.toBeNull();
    expect(r.s.trick).toMatchObject({ kind: "manual", id: "manual" });
    r.obSteps(10, true);
    expect(r.s.manual).not.toBeNull();
    expect(r.s.style).toBeNull();
    r.ob(false);
    expect(r.s.manual).toBeNull();
    expect(r.s.manualEnd).toMatchObject({ reason: "release", result: "clean" });
    expect(r.s.style).toBeNull(); // the release of a manual starts no dance
    expect(r.moves.some((m) => m.move === "manual" || /Manual/.test(m.name))).toBe(true);
  });

  it("a rail that comes in range during a one-button manual takes the input: the manual ends clean and the skater snaps (R8)", () => {
    const g = straightGrindable("rail:test", 0, 20);
    const r = obRig({ grindables: [g], speed: 6, position: [-6, 0, 0] });
    r.obSteps(fr(ONE_BUTTON_HOLD * 1000) + 1, true, { push: true });
    expect(r.s.manual).not.toBeNull();
    r.obSteps(120, true, {}, (run) => run.skater.state === "grind");
    expect(r.s.state).toBe("grind");
    expect(r.s.manualEnd).toMatchObject({ reason: "rail", result: "clean" });
  });

  it("the beat judges a one-button manual at its start (there is no GRIND press)", () => {
    const PERFECT = { index: 0, offsetMs: 0, tag: "PERFECT", onBeat: true };
    const r = obRig({ speed: 6, beat: { judge: () => PERFECT } });
    r.obSteps(fr(ONE_BUTTON_HOLD * 1000) + 1, true);
    expect(r.s.justManual == null || r.s.manual).toBeTruthy();
    expect(r.run.manualBeat).toEqual(PERFECT);
    r.obSteps(30, true);
    r.ob(false);
    const m = r.moves.find((x) => x.move === "manual");
    expect(m).toMatchObject({ onBeat: true, beatTag: "PERFECT" });
  });

  it("a manual that ended while TRICK is still held does not start again", () => {
    const r = obRig({ speed: 6 });
    r.obSteps(fr(ONE_BUTTON_HOLD * 1000) + 1, true);
    expect(r.s.manual).not.toBeNull();
    // No balance input: the manual tips over (a stumble) after about 1.25 s.
    r.obSteps(200, true, {}, (run) => run.skater.manualEnd != null);
    expect(r.s.manualEnd).toMatchObject({ reason: "balance", result: "stumble" });
    r.obSteps(30, true);
    expect(r.s.manual).toBeNull();
  });

  it("AC: in the air with no rail, TRICK in 3 airs held at each touchdown gives Mute, Japan, and Side, and each landing is clean", () => {
    const r = obRig({ speed: 6 });
    const names = [];
    for (let i = 0; i < 3; i += 1) {
      r.air({ vy: vyFor(0.6) });
      r.obSteps(fr(150), false);
      r.obSteps(200, true, {}, (run) => run.skater.state !== "air");
      names.push(r.s.landing.grab.name);
      expect(r.s.landing.result).toBe("clean");
      r.obSteps(2, false);
    }
    expect(names).toEqual(["Mute Grab", "Japan Grab", "Side Grab"]);
  });

  it("AC: TRICK in 6 airs: the 6th grab is the Mute Grab again", () => {
    const r = obRig({ speed: 6 });
    const ids = [];
    for (let i = 0; i < 6; i += 1) {
      r.air({ vy: vyFor(0.5) });
      r.obSteps(fr(150), false);
      r.ob(true);
      ids.push(r.s.grab?.id);
      r.obSteps(200, false, {}, (run) => run.skater.state !== "air");
      r.obSteps(2, false);
    }
    expect(ids).toEqual(["mute", "japan", "side", "rocket", "tuckknee", "mute"]);
  });

  it("the direction is not read for the one-button grab", () => {
    const r = obRig({ speed: 6 });
    r.air({ vy: vyFor(0.5) });
    r.obSteps(fr(150), false);
    r.ob(true, { flick: { style1: "u" }, dirHist: [{ dir: "u", at: r.s.time, up: null }] });
    expect(r.s.grab.id).toBe("mute");
  });

  it("AC: Nia, 11 TRICK taps on the ground: the 10 slots of the Nia set in order, then Bankhead Bounce again", () => {
    const r = obRig({ speed: 6 });
    const names = [];
    for (let i = 0; i < 11; i += 1) {
      tap(r);
      names.push(r.s.style?.name ?? null);
      // Let the dance end before the next tap.
      r.obSteps(600, false, { push: true }, (run) => run.skater.style == null);
    }
    expect(names).toEqual(["Bankhead Bounce", "Walk It Out", "The Prep", "Swag Surf", "Snap Lean", "Cross Step", "Toe Spin", "Smooth Quad", "ATL Rydin", "Sit Spin", "Bankhead Bounce"]);
  });

  it("Marcus: the 3 extra dances of his set play by name (Jam Groove, Bankhead Bounce, Snap Lean)", () => {
    const r = obRig({ speed: 6, skater: "marcus" });
    const names = [];
    for (let i = 0; i < 13; i += 1) {
      tap(r);
      names.push(r.s.style?.name ?? null);
      r.obSteps(600, false, { push: true }, (run) => run.skater.style == null);
    }
    expect(names.slice(10)).toEqual(["Jam Groove", "Bankhead Bounce", "Snap Lean"]);
  });

  it("a TRICK held at the end of a dance does not repeat it (the next tap takes the next item)", () => {
    const r = obRig({ speed: 6 });
    tap(r);
    expect(r.s.style.name).toBe("Bankhead Bounce");
    // TRICK goes down again 0.1 s before the dance ends and is held past the end.
    r.obSteps(600, false, { push: true }, (run) => run.skater.style.time >= run.skater.style.duration - 0.1);
    r.obSteps(fr(200), true, { push: true }, (run) => run.skater.style == null);
    expect(r.s.style).toBeNull();
    r.ob(false, { push: true });
    expect(r.s.style?.name).toBe("Walk It Out");
  });

  it("a tap that is too slow gives the refusal reason at the release", () => {
    const r = obRig({ speed: 0.5 });
    r.obSteps(3, true);
    expect(r.s.refused).toBeNull();
    r.ob(false);
    expect(r.s.style).toBeNull();
    expect(r.s.refused).toMatchObject({ reason: "slow" });
  });

  it("SPIN still works in one-button mode", () => {
    const r = obRig({ speed: 6 });
    r.obSteps(fr(60) + 1, false, { style2: true }, (run) => run.skater.style != null);
    expect(r.s.style?.name).toBe("Cross Step");
  });
});
