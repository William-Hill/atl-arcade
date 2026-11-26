// Trick input on the ground: dance slots (R3, R7) and the manual (R8, F1,
// F2). docs/gdd/trick-input.md, Acceptance Criteria. Times go through the
// frame helper of #343 (`fr` = msToFrame).
import { describe, expect, it } from "vitest";
import { STYLE, TRICK, styleDuration } from "./constants.js";
import { manualPoints, manualStep } from "./manual.js";
import { DT, at, fr, keys, rig, straightGrindable } from "./trick-rig.js";

const PREP_MS = 100;
// A skater rolling at `speed`, `frames` frames in (so the clock is past 0).
function rolling(speed = 5, opts = {}) {
  const r = rig({ speed, ...opts });
  r.steps(30, { push: speed > 4 });
  r.set({ speed });
  return r;
}

describe("R3 and R7: the direction picks the dance slot", () => {
  it("Q with a fresh right that started 100 ms before gives The Prep; 160 ms before gives the neutral slot", () => {
    for (const [ms, want] of [[PREP_MS, "The Prep"], [160, "Bankhead Bounce"]]) {
      const r = rolling();
      const q = r.frame + 1;
      const hist = keys([{ dir: "r", down: q - fr(ms), up: q - fr(ms) + 2 }]);
      r.step({ style1: true, dirHist: hist });
      r.steps(fr(60), { style1: true, dirHist: hist });
      expect(r.s.style.name).toBe(want);
    }
  });

  it("a fresh up 20 ms after the Q press starts the dance at the 20 ms frame; with no direction the neutral dance starts 60 ms after the press", () => {
    let r = rolling();
    const q = r.frame + 1;
    const up = { dir: "u", down: q + fr(20), up: null };
    r.step({ style1: true });
    expect(r.s.style).toBe(null);
    r.step({ style1: true, dirHist: keys([up]) });
    expect(r.frame).toBe(q + fr(20));
    expect(r.s.style.name).toBe("Swag Surf");

    r = rolling();
    const q2 = r.frame + 1;
    r.step({ style1: true });
    while (!r.s.style) r.step({ style1: true });
    expect(r.frame).toBe(q2 + fr(60));
    expect(r.s.style.name).toBe("Bankhead Bounce");
  });

  it("left and then right start before the press in the window: right wins", () => {
    const r = rolling();
    const q = r.frame + 1;
    r.step({ style1: true, dirHist: keys([{ dir: "l", down: q - 6, up: q - 4 }, { dir: "r", down: q - 3, up: null }]) });
    expect(r.s.style.name).toBe("The Prep");
  });

  it("W tapped down and up between frame -6 and frame -3 before the Q press gives Up", () => {
    const r = rolling();
    const q = r.frame + 1;
    r.step({ style1: true, dirHist: keys([{ dir: "u", down: q - 6, up: q - 3 }]) });
    expect(r.s.style.name).toBe("Swag Surf");
  });

  it("W held for 1 s, then A down 3 frames before the Q press gives Left", () => {
    const r = rolling();
    const q = r.frame + 1;
    r.step({ style1: true, push: true, dirHist: keys([{ dir: "u", down: q - fr(1000), up: null }, { dir: "l", down: q - 3, up: null }]) });
    expect(r.s.style.name).toBe("Walk It Out");
  });

  it("W held for 1 s to push, then Q: the neutral slot (Bankhead Bounce for Nia); Shift held to push gives no direction", () => {
    for (const extra of [{ dirHist: (q) => keys([{ dir: "u", down: q - fr(1000), up: null }]) }, { dirHist: () => [] }]) {
      const r = rolling();
      const q = r.frame + 1;
      const hist = extra.dirHist(q);
      r.step({ style1: true, push: true, dirHist: hist });
      r.steps(fr(60), { style1: true, push: true, dirHist: hist });
      expect(r.s.style.name).toBe("Bankhead Bounce");
    }
  });

  it("at 1.4 m/s Q starts no dance; at 1.5 m/s a dance starts", () => {
    for (const [v, want] of [[1.4, false], [1.5, true]]) {
      const r = rolling(v);
      r.step({ style1: true, flick: { style1: "n" } });
      expect(Boolean(r.s.style)).toBe(want);
    }
  });

  it("Nia: E with no direction plays the Cross Step for 2 beats and pays 150 points", () => {
    const r = rolling();
    r.step({ style2: true, flick: { style2: "n" } });
    expect(r.s.style).toMatchObject({ name: "Cross Step", clip: "dance_crisscross", points: 150 });
    expect(r.s.style.duration).toBeCloseTo((2 * 60) / 100, 9);
    r.steps(200, {}, (run) => run.skater.justStyled);
    expect(r.moves.at(-1)).toMatchObject({ name: "Cross Step", points: 150 });
  });

  it("Nia: E with up plays ATL Rydin for 8 beats and pays 600 points (Sit Spin clip until dance_atlrydin exists)", () => {
    const r = rolling(8);
    r.step({ style2: true, flick: { style2: "u" } });
    expect(r.s.style).toMatchObject({ name: "ATL Rydin", points: 600 });
    expect(r.s.style.duration).toBeCloseTo((8 * 60) / 100, 9);
    // Keep the speed up on flat ground for the 4.8 s dance.
    r.steps(400, (f, rr) => ({ push: rr.s.speed < 5 }), (run) => run.skater.justStyled);
    expect(r.moves.at(-1)).toMatchObject({ name: "ATL Rydin", points: 600 });
  });

  it("Marcus: Q with no direction is Swag Surf; with up it is Drumline Count", () => {
    const names = [];
    for (const d of ["n", "u"]) {
      const r = rolling(5, { skater: "marcus" });
      r.step({ style1: true, flick: { style1: d } });
      names.push(r.s.style.name);
    }
    expect(names).toEqual(["Swag Surf", "Drumline Count"]);
  });

  it("STYLE.moves has beats and points per dance", () => {
    for (const m of STYLE.moves) {
      expect(m.beats).toBeUndefined();
      expect(m.points).toBeUndefined();
      for (const d of m.dances) {
        expect(d.beats).toBeGreaterThan(0);
        expect(d.points).toBeGreaterThan(0);
        expect(styleDuration(d)).toBeCloseTo((d.beats * 60) / 100, 9);
      }
    }
  });

  it("state.trick names the dance in progress", () => {
    const r = rolling();
    r.step({ style1: true, flick: { style1: "r" } });
    expect(r.s.trick).toMatchObject({ kind: "dance", name: "The Prep", clip: "dance_prep", dir: "r", held: true });
  });
});

describe("R8: the manual", () => {
  // A manual on flat ground: hold GRIND (and keep the balance near 0).
  const keep = (rr) => {
    const m = rr.s.manual;
    return m ? (m.side * TRICK.manualDrift + TRICK.manualGravity * m.balance) / TRICK.manualCorrect : 0;
  };

  it("a roll at 5 m/s with no rail: F held for 0.2 s starts a manual, and push and brake are off", () => {
    const r = rolling(5);
    r.steps(fr(200), { grind: true });
    expect(r.s.manual).not.toBe(null);
    expect(r.s.trick).toMatchObject({ kind: "manual", name: "Manual", clip: "manual" });
    const v = r.s.speed;
    r.step({ grind: true, push: true, balance: keep(r) });
    expect(r.s.pushing).toBe(false);
    expect(r.s.speed).toBeLessThan(v);
    r.step({ grind: true, brake: true, balance: keep(r) });
    expect(r.s.braking).toBe(false);
  });

  it("the manual starts at manualDelay (0.15 s = frame 9), not before", () => {
    const r = rolling(5);
    const p = r.frame + 1;
    r.steps(fr(150), { grind: true }); // the press frame p and 8 more: 0.133 s of hold
    expect(r.s.manual).toBe(null);
    r.step({ grind: true });
    expect(r.frame).toBe(p + fr(150));
    expect(r.s.manual).not.toBe(null);
  });

  it("F held at 2.9 m/s starts no manual; at 3.0 m/s a manual starts", () => {
    for (const [v, want] of [[2.9, false], [3.0, true]]) {
      const r = rolling(5);
      r.steps(fr(150), { grind: true });
      r.set({ speed: v });
      r.step({ grind: true });
      expect(Boolean(r.s.manual)).toBe(want);
    }
  });

  it("F held with a fresh up gives the Toe Roll (manual_toe), and its link is 40 + 15 x meters + 20", () => {
    const r = rolling(5);
    r.step({ grind: true, flick: { grind: "u" } });
    r.steps(fr(150), { grind: true });
    expect(r.s.trick).toMatchObject({ kind: "manual", id: "toe", name: "Toe Roll", clip: "manual_toe" });
    r.steps(30, (f, rr) => ({ grind: true, balance: keep(rr) }));
    r.step({});
    expect(r.s.manualEnd).toMatchObject({ reason: "release", result: "clean" });
    const meters = r.s.manualEnd.meters;
    expect(meters).toBeGreaterThan(2);
    expect(r.moves.at(-1)).toMatchObject({ name: "Toe Roll", points: Math.round(40 + 15 * meters + 20) });
    expect(r.moves.at(-1).points).toBe(manualPoints(meters, true));
  });

  it("a roll at 8 m/s toward a ledge with F held from 0.1 s before the ledge is in snap range: no manual, the skater snaps", () => {
    // The ledge starts at x = 10; the snap range starts 1.2 m before it.
    const ledge = straightGrindable("ledge:test", 10, 30);
    const r = rig({ grindables: [ledge], speed: 8, position: [10 - 1.2 - 8 * 0.1 - 0.05, 0, 0] });
    r.steps(fr(400), { grind: true }, (run) => run.skater.state === "grind");
    expect(r.s.state).toBe("grind");
    expect(r.states.some((x) => x.skater.manual)).toBe(false);
  });

  it("F held for 0.2 s toward a rail 2 s away: a manual starts, and the grind snaps when the rail is in range; the manual ends clean with its link", () => {
    const rail = straightGrindable("rail:test", 20, 40);
    const r = rig({ grindables: [rail], speed: 8, position: [20 - 1.2 - 16, 0, 0] });
    r.steps(fr(3000), (f, rr) => ({ grind: true, balance: keep(rr) }), (run) => run.skater.state === "grind");
    expect(r.states.some((x) => x.skater.manual)).toBe(true);
    expect(r.s.state).toBe("grind");
    expect(r.s.manualEnd).toMatchObject({ reason: "rail", result: "clean" });
    expect(r.moves.at(-1)).toMatchObject({ move: "manual", name: "Manual", landing: "clean" });
  });

  it("a manual ends clean with no speed loss when F is let go, when JUMP is pressed, or when the speed drops under 3 m/s", () => {
    // Release.
    let r = rolling(6);
    r.steps(fr(200), (f, rr) => ({ grind: true, balance: keep(rr) }));
    let v = r.s.speed;
    r.step({});
    expect(r.s.manualEnd).toMatchObject({ reason: "release", result: "clean" });
    expect(r.s.speed).toBeGreaterThan(v - 0.1);
    // Jump.
    r = rolling(6);
    r.steps(fr(200), (f, rr) => ({ grind: true, balance: keep(rr) }));
    v = r.s.speed;
    r.step((f, rr) => ({ grind: true, jump: true, balance: keep(rr) }));
    expect(r.s.state).toBe("air");
    expect(r.s.manualEnd).toMatchObject({ reason: "jump", result: "clean" });
    expect(r.s.speed).toBeGreaterThan(v - 0.1);
    // Slow.
    r = rolling(3.4);
    r.steps(fr(150) + 1, { grind: true });
    expect(r.s.manual).not.toBe(null);
    r.steps(600, (f, rr) => ({ grind: true, balance: keep(rr) }), (run) => run.skater.manualEnd);
    expect(r.s.manualEnd).toMatchObject({ reason: "slow", result: "clean" });
    expect(r.s.speed).toBeGreaterThan(TRICK.manualMinSpeed - 0.1);
  });

  it("F1: m = 0.3, side +1, s = 0.2, dt = 1/60 gives 0.3043", () => {
    expect(manualStep(0.3, 1, 0.2, 1 / 60)).toBeCloseTo(0.3043, 4);
  });

  it("a gamepad manual: side +1 and m = 0.9, the stick up at raw -0.70 (balance 0.647) moves m down, and X does not push", () => {
    const balance = (0.7 - 0.15) / 0.85;
    expect(balance).toBeCloseTo(0.647, 3);
    expect((0.4 + 0.9 - 2.2 * balance)).toBeCloseTo(-0.12, 2);
    const r = rolling(6);
    r.steps(fr(150) + 1, { grind: true });
    expect(r.s.manual).not.toBe(null);
    r.set({ manual: { ...r.s.manual, side: 1, balance: 0.9 } });
    const v = r.s.speed;
    r.step({ grind: true, push: true, balance });
    expect(r.s.manual.balance).toBeLessThan(0.9);
    expect(r.s.manual.balance).toBeCloseTo(0.9 - 0.12 * DT, 3);
    expect(r.s.pushing).toBe(false);
    expect(r.s.speed).toBeLessThan(v);
  });

  it("a manual that hits a wall head-on: the speed drops under 3 m/s, the manual ends clean, and the link is added", () => {
    const wall = { sampleGround: (x) => (x > 6 ? { height: 2, normal: [0, 1, 0], id: "box" } : { height: 0, normal: [0, 1, 0], id: "flat" }) };
    const r = rig({ speed: 6, env: wall });
    r.steps(200, (f, rr) => ({ grind: true, balance: keep(rr) }), (run) => run.skater.manualEnd);
    expect(r.states.some((x) => x.skater.bonked)).toBe(true);
    expect(r.s.manualEnd).toMatchObject({ reason: "slow", result: "clean" });
    expect(r.moves.at(-1)).toMatchObject({ move: "manual", landing: "clean" });
  });

  it("GRIND pressed in the air with no rail and held through the landing starts no manual; let go and pressed again for 0.2 s, a manual starts", () => {
    const r = rig({ speed: 6 }).air({ airFrom: "jump", vy: 3 });
    r.steps(5, {});
    r.steps(fr(1000), { grind: true }, (run) => run.skater.justLanded);
    r.steps(fr(400), { grind: true });
    expect(r.states.some((x) => x.skater.manual)).toBe(false);
    r.step({});
    r.steps(fr(200), { grind: true });
    expect(r.s.manual).not.toBe(null);
  });

  it("a manual with no balance input reaches |m| = 1 in about 1.25 s: the state is rolling, the result is a stumble, and the speed is 0.7 times the step before", () => {
    const r = rig({ speed: 9, tricks: { k: { manualFriction: 0 } } });
    r.steps(fr(150) + 1, { grind: true });
    expect(r.s.manual).not.toBe(null);
    const start = r.frame;
    let before = r.s.speed;
    r.steps(200, (f, rr) => {
      before = rr.s.speed;
      return { grind: true };
    }, (run) => run.skater.manualEnd);
    expect((r.frame - start) * DT).toBeGreaterThan(1.0);
    expect((r.frame - start) * DT).toBeLessThan(1.5);
    expect(r.s.state).toBe("rolling");
    expect(r.s.manual).toBe(null);
    expect(r.s.manualEnd).toMatchObject({ reason: "balance", result: "stumble" });
    expect(r.s.speed).toBeCloseTo(before * 0.7, 1);
    expect(r.moves.at(-1)).toMatchObject({ move: "manual", landing: "stumble" });
  });

  it("a manual of 20 m that ends clean off the beat pays 340", () => {
    expect(manualPoints(20)).toBe(340);
    const beat = { judge: () => ({ index: 0, offsetMs: 200, tag: null, onBeat: false }) };
    const r = rig({ speed: 8, beat, tricks: { k: { manualFriction: 0 } } });
    r.steps(fr(150), { grind: true });
    r.steps(400, (f, rr) => ({ grind: true, balance: keep(rr) }), (run) => run.skater.manual && run.skater.manual.meters >= 20 - 8 * DT / 2);
    r.step({});
    const meters = r.s.manualEnd.meters;
    expect(meters).toBeCloseTo(20, 0);
    expect(r.moves.at(-1)).toMatchObject({ name: "Manual", points: manualPoints(meters), earned: manualPoints(meters) });
  });

  it("manualFriction 0 and the balance held near 0 at 8 m/s: at 30 m the combo holds one manual link of 490, and the bank comes 0.8 s after the cap", () => {
    const r = rig({ speed: 8, tricks: { k: { manualFriction: 0 } } });
    r.steps(fr(150), { grind: true });
    r.steps(600, (f, rr) => ({ grind: true, balance: keep(rr) }), (run) => run.skater.manualCap);
    expect(r.s.manualCap).not.toBe(null);
    expect(r.run.combo.links).toHaveLength(1);
    expect(r.run.combo.links[0]).toMatchObject({ move: "manual", points: 490 });
    const cap = r.frame;
    r.steps(120, (f, rr) => ({ grind: true, balance: keep(rr) }), (run) => run.banked > 0);
    expect(r.s.manual).not.toBe(null); // the skater stays in the manual
    expect(r.run.banked).toBe(490);
    expect((r.frame - cap) * DT).toBeCloseTo(0.8, 1);
  });

  it("the grind-to-manual link: F held from the grind through the rail end, the skater lands at 5 m/s with no rail in range: a manual starts at the touchdown frame", () => {
    const rail = straightGrindable("rail:test", 0, 4, 0.4);
    const r = rig({ grindables: [rail], speed: 6, position: [-0.5, 0, 0] });
    r.steps(200, { grind: true, steer: 0.25 }, (run) => run.skater.justLanded);
    expect(r.states.some((x) => x.skater.state === "grind")).toBe(true);
    expect(r.s.justLanded).toBe(true);
    expect(r.s.speed).toBeGreaterThan(TRICK.manualMinSpeed);
    expect(r.s.manual).toMatchObject({ link: true });
    expect(r.s.justManual).toMatchObject({ link: true });
  });

  it("a manual that rolls onto a kicker: the manual link is added at the launch and the air starts a new link", () => {
    // A kicker face from x = 4 to x = 6, 0.8 m high, then a drop.
    const ramp = {
      sampleGround: (x) => {
        if (x > 4 && x < 6) {
          const slope = 0.4;
          const n = [-slope / Math.hypot(1, slope), 1 / Math.hypot(1, slope), 0];
          return { height: (x - 4) * slope, normal: n, id: "kicker" };
        }
        return { height: 0, normal: [0, 1, 0], id: "flat" };
      },
    };
    const r = rig({ speed: 8, env: ramp, position: [0, 0, 0] });
    r.steps(fr(150) + 1, { grind: true });
    expect(r.s.manual).not.toBe(null);
    r.steps(200, (f, rr) => ({ grind: true, balance: keep(rr) }), (run) => run.skater.state === "air");
    expect(r.s.manualEnd).toMatchObject({ result: "clean" });
    expect(r.moves.at(-1)).toMatchObject({ move: "manual" });
    const n = r.moves.length;
    r.steps(200, {}, (run) => run.skater.justLanded);
    expect(r.moves.length).toBe(n + 1);
    expect(r.moves.at(-1).move).toBe("air");
  });
});
