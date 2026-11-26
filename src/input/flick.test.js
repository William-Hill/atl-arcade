import { describe, expect, it } from "vitest";
import { resolveFramePress, resolvePress } from "./direction.js";
import { createFlick, flickDirOf, flickLift, flickMove, flickTick, createTouchTricks, touchTrickDown, touchTrickMove, touchTrickUp, touchTricksFrame } from "./flick.js";
import { createInput } from "./input.js";
import { TRICK_INPUT, trickKnobs } from "./trick-constants.js";
import { frameToSec, msToFrame } from "../sim/skate/frames.js";

// The R11 times are the nearest whole 60 Hz frame (#343, src/sim/skate/frames.js).
const ms = (frame) => frameToSec(frame) * 1000; // the time of a frame in ms
const HALF = ms(1) / 2;

// Steps the touch trick state through frames 0..last. `events[frame]` runs
// before the frame: (st, tMs) => st. Returns the frame outputs by frame.
function run(events, last, k = TRICK_INPUT) {
  let st = createTouchTricks();
  const outs = [];
  for (let i = 0; i <= last; i += 1) {
    if (events[i]) st = events[i](st, ms(i));
    const f = touchTricksFrame(st, ms(i), k, HALF);
    st = f.state;
    outs.push(f.out);
  }
  return { outs, st };
}

describe("flick: pure", () => {
  it("gives the main axis of the drag; screen y down", () => {
    expect(flickDirOf(30, 5)).toBe("r");
    expect(flickDirOf(-30, 5)).toBe("l");
    expect(flickDirOf(5, -30)).toBe("u");
    expect(flickDirOf(5, 30)).toBe("d");
  });

  it("resolves at flickMin px, at a lift, or at flickMaxMs", () => {
    const f = createFlick("style1", 100, 100, 0);
    expect(flickMove(f, 123, 100, 10).resolved).toBeNull();
    expect(flickMove(f, 124, 100, 10).resolved).toEqual({ dir: "r", atMs: 10, by: "drag" });
    expect(flickLift(f, 50).resolved).toEqual({ dir: "n", atMs: 50, by: "tap" });
    expect(flickTick(f, 119).resolved).toBeNull();
    expect(flickTick(f, 120).resolved).toMatchObject({ dir: "n", by: "timeout" });
    // A resolved flick does not change.
    const r = flickMove(f, 100, 70, 10);
    expect(flickMove(r, 150, 100, 20).resolved.dir).toBe("u");
  });
});

describe("#328 touch flick on TRICK (R11)", () => {
  it("AC: a 24 px drag right gives the Side Grab direction in that frame", () => {
    const { outs } = run({ 0: (s, t) => touchTrickDown(s, "style1", 1, 300, 300, t), 3: (s, t) => touchTrickMove(s, 1, 324, 302, t) }, 6);
    expect(outs[0]).toMatchObject({ style1: false, flick: { style1: null } });
    expect(outs[2].style1).toBe(false);
    expect(outs[3]).toMatchObject({ style1: true, flick: { style1: "r" } });
    expect(outs[4]).toMatchObject({ style1: true, flick: { style1: null } }); // held, one resolve
  });

  it("AC: a lift at 50 ms with less than 24 px gives neutral (Mute Grab) for one frame", () => {
    const { outs } = run({ 0: (s, t) => touchTrickDown(s, "style1", 1, 300, 300, t), 2: (s, t) => touchTrickMove(s, 1, 310, 300, t), [msToFrame(50)]: (s, t) => touchTrickUp(s, 1, t) }, 5);
    expect(outs.slice(0, msToFrame(50)).map((o) => o.style1)).toEqual([false, false, false]);
    expect(outs[msToFrame(50)]).toMatchObject({ style1: true, flick: { style1: "n" } });
    expect(outs[msToFrame(50) + 1].style1).toBe(false);
  });

  it("AC: 120 ms with no drag gives neutral at the 120 ms frame (frame 7)", () => {
    const { outs } = run({ 0: (s, t) => touchTrickDown(s, "style1", 1, 300, 300, t) }, 9);
    expect(outs.findIndex((o) => o.flick.style1 != null)).toBe(msToFrame(TRICK_INPUT.flickMaxMs));
    expect(outs[msToFrame(120)]).toMatchObject({ style1: true, flick: { style1: "n" } });
    expect(outs[9].style1).toBe(true); // held until the lift
  });

  it("Relaxed timing waits 250 ms (frame 15)", () => {
    const { outs } = run({ 0: (s, t) => touchTrickDown(s, "style1", 1, 300, 300, t) }, 16, trickKnobs({ relaxed: true }));
    expect(outs.findIndex((o) => o.flick.style1 != null)).toBe(msToFrame(250));
  });

  it("a held flick press ends at the lift", () => {
    const { outs } = run({ 0: (s, t) => touchTrickDown(s, "style2", 4, 0, 0, t), 1: (s, t) => touchTrickMove(s, 4, 0, -30, t), 5: (s, t) => touchTrickUp(s, 4, t) }, 6);
    expect(outs[1]).toMatchObject({ style2: true, flick: { style2: "u" } });
    expect(outs[4].style2).toBe(true);
    expect(outs[5].style2).toBe(false);
  });

  it("gives a start event for a flick that is not neutral, at the resolve frame", () => {
    const { st } = run({ 0: (s, t) => touchTrickDown(s, "style1", 1, 0, 0, t), 2: (s, t) => touchTrickMove(s, 1, -30, 0, t) }, 3);
    expect(st).toMatchObject({ lastDir: "l", lastDirAt: ms(2) / 1000 });
    expect(st.hist).toEqual([{ dir: "l", at: ms(2) / 1000, up: ms(2) / 1000 }]);
  });

  it("a tap inside one frame is not lost", () => {
    const { outs } = run({ 2: (s, t) => touchTrickUp(touchTrickDown(s, "style1", 1, 0, 0, t), 1, t) }, 3);
    expect(outs[2]).toMatchObject({ style1: true, flick: { style1: "n" } });
  });
});

describe("#340 touch GRIND: press at the touch-down, stance at the resolve", () => {
  it("AC: the GRIND press reaches the frame of the touch-down", () => {
    const { outs } = run({ 5: (s, t) => touchTrickDown(s, "grind", 2, 0, 0, t) }, 6);
    expect(outs[4].grind).toBe(false);
    expect(outs[5]).toMatchObject({ grind: true, grindFlick: true, flick: { grind: null } });
  });

  it("AC: a flick up of 24 px after the snap gives the stance up (Makio) once, at that frame", () => {
    const { outs } = run({ 0: (s, t) => touchTrickDown(s, "grind", 2, 0, 0, t), 4: (s, t) => touchTrickMove(s, 2, 0, -24, t) }, 8);
    expect(outs.slice(0, 4).every((o) => o.grind && o.grindFlick && o.flick.grind === null)).toBe(true);
    expect(outs[4]).toMatchObject({ grind: true, grindFlick: false, flick: { grind: "u" } });
    expect(outs.slice(5).every((o) => o.grind && o.flick.grind === null)).toBe(true);
    expect(outs.filter((o) => o.flick.grind != null)).toHaveLength(1);
  });

  it("the stance resolve is at most flickMaxMs after the touch-down (neutral)", () => {
    const { outs } = run({ 0: (s, t) => touchTrickDown(s, "grind", 2, 0, 0, t) }, 9);
    expect(outs.findIndex((o) => o.flick.grind != null)).toBe(msToFrame(TRICK_INPUT.flickMaxMs));
    expect(outs[msToFrame(120)].flick.grind).toBe("n");
  });

  it("AC: TRICK and SPIN still press at the resolve frame, not at the touch-down", () => {
    const { outs } = run({ 0: (s, t) => touchTrickDown(touchTrickDown(s, "style1", 1, 0, 0, t), "grind", 2, 50, 0, t), 2: (s, t) => touchTrickMove(s, 1, 0, 30, t) }, 3);
    expect(outs[0]).toMatchObject({ style1: false, grind: true });
    expect(outs[2]).toMatchObject({ style1: true, flick: { style1: "d" } });
  });

  it("GRIND let go ends the press; a tap gives one frame with the neutral stance", () => {
    const { outs } = run({ 1: (s, t) => touchTrickDown(s, "grind", 2, 0, 0, t), 3: (s, t) => touchTrickUp(s, 2, t) }, 4);
    expect(outs[2].grind).toBe(true);
    expect(outs[3]).toMatchObject({ grind: true, flick: { grind: "n" } });
    expect(outs[4].grind).toBe(false);
  });
});

describe("#328 the same direction on keyboard, gamepad, and touch", () => {
  // A stub touch overlay in the shape of src/input/touch.js.
  function touchStub() {
    let st = createTouchTricks();
    const api = {
      events: [],
      sample(t) {
        for (const e of api.events) st = e(st, t * 1000);
        api.events = [];
        const f = touchTricksFrame(st, t * 1000, TRICK_INPUT, HALF);
        st = f.state;
        return { steer: 0, push: false, brake: false, jump: false, grind: f.out.grind, style1: f.out.style1, style2: f.out.style2, switch: false, flick: f.out.flick, grindFlick: f.out.grindFlick, dirs: { lastDir: st.lastDir, lastDirAt: st.lastDirAt, hist: st.hist, held: false }, balance: 0 };
      },
      touching: false,
    };
    return api;
  }
  const target = () => {
    const l = {};
    return { addEventListener: (ty, fn) => (l[ty] ||= []).push(fn), removeEventListener() {}, fire: (ty, code) => (l[ty] || []).forEach((fn) => fn({ code, preventDefault() {} })) };
  };
  const padOf = (x, y) => ({ id: "pad", connected: true, axes: [x, y], buttons: [] });

  it("AC: up gives the same press direction for all 3 devices", () => {
    const dirs = {};
    // Keyboard: W down 2 frames before Q.
    const kt = target();
    const ki = createInput({ target: kt, getGamepads: () => [] });
    ki.sample(frameToSec(98));
    kt.fire("keydown", "KeyW");
    ki.sample(frameToSec(99));
    kt.fire("keydown", "KeyQ");
    const kf = ki.sample(frameToSec(100));
    dirs.keyboard = resolveFramePress(kf, "style1").dir;
    // Gamepad: the stick up 2 frames before Y.
    let p = padOf(0, 0);
    const pi = createInput({ target: target(), getGamepads: () => [p] });
    pi.sample(frameToSec(98));
    p = padOf(0, -1);
    pi.sample(frameToSec(99));
    dirs.gamepad = resolveFramePress(pi.sample(frameToSec(100)), "style1").dir;
    // Touch: a flick up from TRICK.
    const touch = touchStub();
    const ti = createInput({ target: target(), getGamepads: () => [], touch });
    touch.events.push((s, t) => touchTrickDown(s, "style1", 1, 0, 0, t));
    ti.sample(frameToSec(98));
    touch.events.push((s, t) => touchTrickMove(s, 1, 0, -30, t));
    const tf = ti.sample(frameToSec(100));
    expect(tf).toMatchObject({ style1: true, flick: { style1: "u" }, lastDir: "u" });
    dirs.touch = resolveFramePress(tf, "style1").dir;
    expect(dirs).toEqual({ keyboard: "u", gamepad: "u", touch: "u" });
  });

  it("a touch tap gives neutral at once, with no dirAfter wait", () => {
    const touch = touchStub();
    const ti = createInput({ target: target(), getGamepads: () => [], touch });
    touch.events.push((s, t) => touchTrickUp(touchTrickDown(s, "style1", 1, 0, 0, t), 1, t));
    const f = ti.sample(1);
    expect(resolveFramePress(f, "style1")).toEqual({ dir: "n", at: 1 });
    expect(resolvePress(f.t, f.dirHist).pending).toBe(1); // the R3 rule alone would wait
  });

  it("gives the touch stick y as the balance, up is +1", () => {
    const touch = { sample: () => ({ steer: 0, push: false, brake: false, jump: false, grind: false, style1: false, style2: false, switch: false, balance: 0.4 }), touching: true };
    const ti = createInput({ target: target(), getGamepads: () => [], touch });
    expect(ti.sample(1)).toMatchObject({ balance: 0.4, flick: { style1: null, style2: null, grind: null }, grindFlick: false });
  });
});

describe("touch state when the sim clock goes back", () => {
  it("clears the touch start events and restarts the timeout of a flick that is down", async () => {
    const { rebaseTouchTricks } = await import("./flick.js");
    let st = createTouchTricks();
    st = touchTrickDown(st, "style1", 1, 0, 0, 5000);
    st = touchTrickMove(st, 1, 0, -30, 5010);
    st = touchTricksFrame(st, 5010).state;
    st = touchTrickDown(st, "style2", 2, 0, 0, 5020);
    expect(st.lastDirAt).toBeCloseTo(5.01);
    const r = rebaseTouchTricks(st, 100);
    expect(r).toMatchObject({ lastDir: "n", lastDirAt: -Infinity, hist: [] });
    expect(r.pointers[2].t0).toBe(100);
    expect(touchTricksFrame(r, 150).out.flick.style2).toBeNull();
    expect(touchTricksFrame(r, 220).out.flick.style2).toBe("n");
  });
});

describe("skip() with touch", () => {
  it("calls the touch skip, so waiting flicks do not reach a later frame", () => {
    let skipped = 0;
    const touch = { sample: () => ({ steer: 0, push: false, brake: false, jump: false, grind: false, style1: false, style2: false, switch: false }), touching: false, skip: () => (skipped += 1) };
    const l = {};
    const input = createInput({ target: { addEventListener: (t, f) => (l[t] ||= []).push(f), removeEventListener() {} }, getGamepads: () => [], touch });
    input.skip();
    expect(skipped).toBe(1);
  });
});
