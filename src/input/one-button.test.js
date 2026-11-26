import { describe, expect, it } from "vitest";
import { ONE_BUTTON_HOLD, ONE_BUTTON_SETS, createOneButton, stepOneButton, takeStance } from "./one-button.js";

const F = 1 / 60;

// Plays frames: `trickAt(i)` gives TRICK down, `ctxAt(i)` the sim context.
function play(frames, trickAt, ctxAt, ob = createOneButton()) {
  const outs = [];
  let s = ob;
  for (let i = 0; i < frames; i += 1) {
    const r = stepOneButton(s, ctxAt(i), trickAt(i), i * F);
    s = r.ob;
    outs.push(r);
  }
  return { outs, ob: s };
}

const ground = { state: "ground", railInRange: false, skater: "nia" };

describe("#328 one-button mode (R12.1)", () => {
  it("AC: a rail in snap range: the TRICK press snaps (the grind intent), and the hold stays", () => {
    const { outs } = play(10, (i) => i >= 2, () => ({ ...ground, railInRange: true }));
    expect(outs[1].grind).toBe(false);
    expect(outs.slice(2).every((o) => o.grind && !o.manual && o.start === null)).toBe(true);
  });

  it("air with a rail in range: a buffered grind, no grab", () => {
    const { outs } = play(5, (i) => i >= 1, () => ({ state: "air", railInRange: true }));
    expect(outs[1]).toMatchObject({ grind: true, start: null });
  });

  it("AC: ground with no rail: a tap starts the next dance at the release", () => {
    const { outs } = play(12, (i) => i >= 2 && i < 10, () => ground);
    expect(outs.slice(0, 10).every((o) => o.start === null && !o.grind && !o.manual)).toBe(true);
    expect(outs[10].start).toEqual({ kind: "dance", name: "Bankhead Bounce", dir: "n", button: "style1" });
  });

  it("AC: ground with no rail: a hold of 0.5 s starts a manual and no dance", () => {
    const { outs } = play(50, (i) => i >= 2 && i < 45, () => ground);
    const first = outs.findIndex((o) => o.manual);
    expect(first).toBe(2 + Math.round(ONE_BUTTON_HOLD / F));
    expect(outs.slice(first, 45).every((o) => o.manual)).toBe(true);
    expect(outs[45].manual).toBe(false); // the release ends it
    expect(outs.every((o) => o.start === null)).toBe(true);
  });

  it("AC: 3 airs give Mute, Japan, Side, each clean; the 6th is Mute again", () => {
    let ob = createOneButton();
    const names = [];
    for (let air = 0; air < 6; air += 1) {
      const r = play(20, (i) => i >= 3, () => ({ state: "air", railInRange: false }), ob);
      const s = r.outs.find((o) => o.start);
      names.push(s.start.name);
      expect(s.start.clean).toBe(true);
      // Land with TRICK still held, then let go on the ground.
      ob = stepOneButton(r.ob, ground, false, 1).ob;
    }
    expect(names.slice(0, 3)).toEqual(["Mute Grab", "Japan Grab", "Side Grab"]);
    expect(names[5]).toBe("Mute Grab");
  });

  it("AC: Nia, 11 taps give the 10 slots in order, then Bankhead Bounce again", () => {
    let ob = createOneButton();
    const names = [];
    let t = 0;
    for (let n = 0; n < 11; n += 1) {
      ob = stepOneButton(ob, ground, true, t).ob;
      t += 0.1;
      const r = stepOneButton(ob, ground, false, t);
      ob = r.ob;
      names.push(r.start.name);
      t += 0.1;
    }
    expect(names).toEqual([...ONE_BUTTON_SETS.nia.map((d) => d.name), "Bankhead Bounce"]);
  });

  it("Marcus has 13 items: the 10 slots, then Jam Groove, Bankhead Bounce, Snap Lean", () => {
    expect(ONE_BUTTON_SETS.marcus.map((d) => d.name).slice(10)).toEqual(["Jam Groove", "Bankhead Bounce", "Snap Lean"]);
    const r = stepOneButton(stepOneButton(createOneButton(), { ...ground, skater: "marcus" }, true, 0).ob, { ...ground, skater: "marcus" }, false, 0.1);
    expect(r.start.name).toBe("Swag Surf");
  });

  it("grind and manual: a press does nothing new; the hold stays", () => {
    const g = play(5, (i) => i >= 1, () => ({ state: "grind", railInRange: true }));
    expect(g.outs.slice(1).every((o) => o.grind && o.start === null)).toBe(true);
    const m = play(5, (i) => i >= 1 && i < 4, () => ({ state: "manual", railInRange: false }));
    expect(m.outs.slice(1, 4).every((o) => o.manual && o.start === null)).toBe(true);
    expect(m.outs[4].manual).toBe(false);
  });

  it("a rail that comes in range during a manual hold takes the input", () => {
    const { outs } = play(50, (i) => i >= 0, (i) => ({ ...ground, railInRange: i >= 40 }));
    expect(outs[35].manual).toBe(true);
    expect(outs[40]).toMatchObject({ grind: true, manual: false });
  });

  it("takeStance cycles the 5 grind stances", () => {
    let ob = createOneButton();
    const names = [];
    for (let i = 0; i < 6; i += 1) {
      const r = takeStance(ob);
      ob = r.ob;
      names.push(r.stance.name);
    }
    expect(names).toEqual(["Grind", "Soul Grind", "Unity Grind", "Makio Grind", "Royale Grind", "Grind"]);
  });
});
