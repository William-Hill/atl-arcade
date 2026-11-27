import { describe, expect, it } from "vitest";
import { ONE_BUTTON_BUFFER, createOneButton, oneButtonFrame, oneButtonNeedsRail, stepOneButton } from "../../input/one-button.js";
import { GRIND } from "./constants.js";
import { DT, rig, straightGrindable } from "./trick-rig.js";
import { oneButtonContext } from "./skater.js";
import { oneButtonStance } from "./trick-step.js";

// #336: in one-button mode the direction is not read (GDD R12.1, owner
// choice 2026-11-26). SPIN plays its neutral slot (Cross Step), a GRIND
// press gives the neutral stance, and a snap of the TRICK intent takes the
// next stance of the one-button grind set.
function obRig(opts = {}) {
  const r = rig({ tricks: { oneButton: true }, ...opts });
  const skaterEnv = { grindables: opts.grindables ?? [], skater: opts.skater ?? "nia" };
  let ob = createOneButton();
  r.ob = (trick, input = {}) => {
    const frame = { ...input, style1: Boolean(trick), oneButton: true };
    const ctx = oneButtonContext(r.s, skaterEnv, { rail: oneButtonNeedsRail(ob, frame) });
    const out = oneButtonFrame(ob, frame, ctx, r.s.time + DT);
    ob = out.ob;
    return r.step(out.frame);
  };
  r.obSteps = (n, trick, input = {}, until = null) => {
    for (let i = 0; i < n; i += 1) {
      r.ob(trick, input);
      if (until && until(r.run)) break;
    }
  };
  return r;
}

// A fresh direction key that went down `ms` before the next frame, and is held.
const freshKey = (r, dir, ms = 40) => ({ dirHist: [{ dir, at: r.s.time + DT - ms / 1000, up: null }], lastDir: dir, lastDirAt: r.s.time + DT - ms / 1000, dir });

describe("#336 SPIN in one-button mode", () => {
  for (const dir of ["n", "l", "r", "u", "d"]) {
    it(`SPIN with the direction "${dir}" plays Cross Step at the press frame (the direction is not read)`, () => {
      const r = obRig({ speed: 6 });
      r.obSteps(2, false, { push: true });
      const key = dir === "n" ? {} : freshKey(r, dir);
      r.ob(false, { push: true, style2: true, ...key });
      expect(r.s.style).toMatchObject({ name: "Cross Step", dir: "n" });
      expect(r.s.trickPend).toBeNull();
    });
  }

  it("a touch flick on SPIN is not read: Cross Step", () => {
    const r = obRig({ speed: 6 });
    r.ob(false, { style2: true, flick: { style1: null, style2: "u", grind: null } });
    expect(r.s.style).toMatchObject({ name: "Cross Step" });
  });

  it("the normal mode still reads the direction: SPIN with a fresh up is ATL Rydin", () => {
    const r = rig({ speed: 6 });
    r.steps(2, { push: true });
    r.step({ style2: true, ...freshKey(r, "u") });
    expect(r.s.style).toMatchObject({ name: "ATL Rydin" });
  });
});

describe("#336 GRIND in one-button mode: the neutral stance", () => {
  it("a GRIND press with a fresh left snaps in the neutral stance (Rail Grind)", () => {
    const g = straightGrindable("rail:test", 0, 20);
    const r = obRig({ grindables: [g], speed: 6, position: [-1, 0, 0] });
    r.ob(false, { grind: true, ...freshKey(r, "l") });
    expect(r.s.state).toBe("grind");
    expect(r.s.grind.stance).toBe("n");
    expect(r.s.trick).toMatchObject({ kind: "grind", name: "Rail Grind" });
    // The stance does not wait for a direction after the press.
    r.obSteps(6, false, { grind: true, ...freshKey(r, "u", 0) });
    expect(r.s.grind.stance).toBe("n");
  });

  it("a GRIND touch flick does not set the stance", () => {
    const g = straightGrindable("ledge:test", 0, 20);
    const r = obRig({ grindables: [g], speed: 6, position: [-1, 0, 0] });
    r.ob(false, { grind: true, flick: { style1: null, style2: null, grind: "d" } });
    r.obSteps(3, false, { grind: true, flick: { style1: null, style2: null, grind: "d" } });
    expect(r.s.grind.stance).toBe("n");
    expect(r.s.trick.name).toBe("Ledge Grind");
  });

  it("a GRIND hold with a fresh up on the ground starts a plain manual, not the Toe Roll", () => {
    const r = obRig({ speed: 6 });
    r.ob(false, { grind: true, ...freshKey(r, "u") });
    r.obSteps(40, false, { grind: true });
    expect(r.s.manual).toMatchObject({ toe: false, dir: "n" });
  });
});

describe("#336 TRICK snaps take the one-button grind set", () => {
  it("6 TRICK snaps: (edge) Grind, Soul, Unity, Makio, Royale, then (edge) Grind again", () => {
    const g = straightGrindable("rail:test", 0, 20);
    const r = obRig({ grindables: [g], speed: 6, position: [-1, 0, 0] });
    const names = [];
    for (let i = 0; i < 6; i += 1) {
      // Back to the start of the rail (a new skater state); the input keeps the set count.
      r.set({ state: "rolling", grind: null, position: [-1, 0, 0], velocity: [6, 0, 0], speed: 6, yaw: 0, grindCooldown: 0 });
      r.ob(false);
      r.ob(true, freshKey(r, "u")); // a direction is not read
      expect(r.s.state).toBe("grind");
      names.push(r.s.trick.name);
      r.ob(false);
    }
    expect(names).toEqual(["Rail Grind", "Rail Soul Grind", "Rail Unity Grind", "Rail Makio Grind", "Rail Royale Grind", "Rail Grind"]);
  });

  it("oneButtonStance: the stance that the input sends, else the neutral stance", () => {
    expect(oneButtonStance({ grind: true })).toBe("n");
    expect(oneButtonStance({ grind: true, ob: { stance: "u" } })).toBe("u");
    expect(oneButtonStance({ ob: { stance: null } })).toBe("n");
    expect(oneButtonStance({ ob: { stance: "x" } })).toBe("n");
  });

  it("a real GRIND press between the TRICK snaps gives the neutral stance and does not move the set", () => {
    const g = straightGrindable("rail:test", 0, 20);
    const r = obRig({ grindables: [g], speed: 6, position: [-1, 0, 0] });
    const names = [];
    for (const how of ["trick", "grind", "trick"]) {
      r.set({ state: "rolling", grind: null, position: [-1, 0, 0], velocity: [6, 0, 0], speed: 6, yaw: 0, grindCooldown: 0 });
      r.ob(false);
      r.ob(how === "trick", how === "grind" ? { grind: true } : {});
      names.push(r.s.trick.name);
      r.ob(false);
    }
    expect(names).toEqual(["Rail Grind", "Rail Grind", "Rail Soul Grind"]);
  });
});

describe("#336 one-button frame", () => {
  it("ob.stance is the next stance of the set only while the TRICK intent holds GRIND and the real GRIND is up", () => {
    const ctx = { state: "ground", railInRange: true, skater: "nia" };
    const a = oneButtonFrame(createOneButton(), { style1: true }, ctx, 0);
    expect(a.frame).toMatchObject({ grind: true, ob: { stance: "n" } });
    expect(a.ob.stanceSent).toBe(true);
    const b = oneButtonFrame(createOneButton(), { style1: true, grind: true }, ctx, 0);
    expect(b.frame).toMatchObject({ grind: true, ob: { stance: null } });
    const c = oneButtonFrame(createOneButton(), { style1: false }, ctx, 0);
    expect(c.frame.ob.stance).toBe(null);
  });

  it("the set moves on the frame after the snap, and a reset (releaseOneButton in src/main.js) keeps it", () => {
    const near = { state: "ground", railInRange: true, skater: "nia" };
    const a = oneButtonFrame(createOneButton(), { style1: true }, near, 0);
    const b = oneButtonFrame(a.ob, { style1: true }, { ...near, state: "grind", railInRange: false }, 0.02);
    expect(b.ob.next.grind).toBe(1);
    expect(b.frame.ob.stance).toBe(null);
    const reset = { ...createOneButton(), next: b.ob.next };
    const c = oneButtonFrame(reset, { style1: true }, near, 0);
    expect(c.frame.ob.stance).toBe("l");
  });

  it("no snap after the stance was sent: the set does not move", () => {
    const near = { state: "ground", railInRange: true, skater: "nia" };
    const a = oneButtonFrame(createOneButton(), { style1: true }, near, 0);
    const b = oneButtonFrame(a.ob, { style1: false }, { ...near, railInRange: false }, 0.02);
    expect(b.ob.next.grind).toBe(0);
  });
});

describe("#336 the air snap buffer (R12.1: buffered as GRIND.buffer)", () => {
  const air = (rail) => ({ state: "air", railInRange: rail, skater: "nia" });

  it("ONE_BUTTON_BUFFER is GRIND.buffer", () => {
    expect(ONE_BUTTON_BUFFER).toBe(GRIND.buffer);
  });

  it("a rail that comes in range inside the buffer after an air press takes the input", () => {
    const a = stepOneButton(createOneButton(), air(false), true, 1);
    expect(a.start).toMatchObject({ kind: "grab", name: "Mute Grab" });
    const b = stepOneButton(a.ob, air(true), true, 1 + GRIND.buffer - 0.01);
    expect(b.grind).toBe(true);
    expect(b.ob.mode).toBe("rail");
  });

  it("a rail that comes in range after the buffer does not: the grab stays", () => {
    const a = stepOneButton(createOneButton(), air(false), true, 1);
    const b = stepOneButton(a.ob, air(true), true, 1 + GRIND.buffer + 0.02);
    expect(b.grind).toBe(false);
    expect(b.ob.mode).toBe("air");
  });
});
