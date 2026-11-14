import { describe, expect, it } from "vitest";
import { FX, beatPhase01, bounceDrop, createFxState, fxScale, settleTime, stepFx, stepSpring } from "./anim-fx.js";

const lag = { hz: FX.springHz, zeta: FX.springZeta, cap: FX.lagCap };

describe("stepSpring", () => {
  it("settles a 1 rad step within 0.6 s with the follow-through values", () => {
    const t = settleTime({ hz: FX.springHz, zeta: FX.springZeta }, 1, 0, 0.02);
    expect(t).toBeGreaterThan(0.1);
    expect(t).toBeLessThan(0.6);
  });

  it("settles the twist spring within 0.6 s", () => {
    expect(settleTime({ hz: FX.twistHz, zeta: FX.twistZeta }, 1, 0, 0.02)).toBeLessThan(0.6);
  });

  it("gives a small settle (follow-through) but no large overshoot", () => {
    let s = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 240; i += 1) {
      s = stepSpring(s, 0.2, 1 / 60, lag);
      max = Math.max(max, s.x);
    }
    expect(max).toBeGreaterThan(0.2); // It overshoots a little,
    expect(max).toBeLessThan(0.2 * 1.25); // but by less than 25 %.
    expect(s.x).toBeCloseTo(0.2, 3);
  });

  it("never goes past the cap, also with a target past the cap", () => {
    let s = { x: 0, v: 0 };
    for (let i = 0; i < 600; i += 1) {
      s = stepSpring(s, i % 120 < 60 ? 5 : -5, 1 / 60, lag);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(FX.lagCap);
    }
  });

  it("is stable with a long frame (0.1 s, the frame cap of the game)", () => {
    let s = { x: 1, v: 0 };
    for (let i = 0; i < 50; i += 1) s = stepSpring(s, 0, 0.1, { hz: FX.springHz, zeta: FX.springZeta });
    expect(Math.abs(s.x)).toBeLessThan(1e-3);
  });

  it("does not move with dt = 0", () => {
    const s = { x: 0.1, v: 2 };
    expect(stepSpring(s, 0, 0, lag)).toBe(s);
  });

  it("gives the same result for one frame of 1/30 s and two of 1/60 s", () => {
    const a = stepSpring({ x: 0, v: 0 }, 0.3, 1 / 30, lag);
    const b = stepSpring(stepSpring({ x: 0, v: 0 }, 0.3, 1 / 60, lag), 0.3, 1 / 60, lag);
    expect(a.x).toBeCloseTo(b.x, 9);
  });
});

describe("beatPhase01", () => {
  it("is 0 on each beat and 0.5 halfway between at the game tempo", () => {
    const beat = 60 / 120;
    expect(beatPhase01(0, 120)).toBe(0);
    expect(beatPhase01(beat * 3, 120)).toBeCloseTo(0, 9);
    expect(beatPhase01(beat * 3.5, 120)).toBeCloseTo(0.5, 9);
  });

  it("stays in [0, 1) for negative and large clocks", () => {
    for (const c of [-3.7, -0.01, 0, 1e5 + 0.123]) {
      const p = beatPhase01(c, 97);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
  });

  it("gives 0 for a bad clock or tempo", () => {
    expect(beatPhase01(NaN, 120)).toBe(0);
    expect(beatPhase01(1, 0)).toBe(0);
  });
});

describe("bounceDrop", () => {
  it("drops the hips by the full amount on the beat and not at the half beat", () => {
    expect(bounceDrop(0)).toBeCloseTo(FX.bounce, 9);
    expect(bounceDrop(0.5)).toBeCloseTo(0, 9);
  });

  it("is smooth across the beat (no jump)", () => {
    expect(Math.abs(bounceDrop(0.999) - bounceDrop(0.001))).toBeLessThan(1e-4);
  });
});

describe("fxScale", () => {
  it("is 0 with ?animfx=0, small with reduced motion, and 1 otherwise", () => {
    expect(fxScale({ param: "0" })).toBe(0);
    expect(fxScale({ param: "0", reduced: true })).toBe(0);
    expect(fxScale({ reduced: true })).toBe(FX.reducedScale);
    expect(fxScale({})).toBe(1);
    expect(fxScale({ param: "1" })).toBe(1);
  });
});

describe("stepFx", () => {
  const run = (inp, seconds, s = createFxState()) => {
    for (let t = 0; t < seconds; t += 1 / 60) s = stepFx(s, { ...inp, clock: (inp.clock ?? 0) + t }, 1 / 60);
    return s;
  };

  it("bounces on the beat in a dance and in the ride, not in the air", () => {
    const dance = run({ clip: "dance_bankhead", bpm: 120 }, 1);
    expect(stepFx(dance, { clip: "dance_bankhead", clock: 2, bpm: 120 }, 0).drop).toBeCloseTo(FX.bounce, 6);
    const coast = run({ clip: "coast", bpm: 120 }, 1);
    expect(stepFx(coast, { clip: "coast", clock: 2, bpm: 120 }, 0).drop).toBeCloseTo(FX.bounce, 6);
    const air = run({ clip: "air_mute", bpm: 120 }, 1);
    expect(air.drop).toBe(0);
  });

  it("fades the bounce in over the gain time, so a clip change does not pop", () => {
    const s = stepFx(createFxState(), { clip: "coast", clock: 0, bpm: 120 }, 1 / 60);
    expect(s.drop).toBeLessThan(FX.bounce * 0.1);
  });

  it("lags against a body turn, then settles to 0 after the turn stops", () => {
    let s = run({ clip: "dance_spin", spin: 6 }, 0.5);
    expect(s.out[1]).toBeLessThan(-0.2); // It lags the turn about the up axis.
    expect(Math.abs(s.out[1])).toBeLessThanOrEqual(FX.lagCap);
    s = run({ clip: "dance_spin", spin: 0 }, 1, s);
    expect(Math.abs(s.out[1])).toBeLessThan(0.01);
  });

  it("caps the length of the lag vector, not only each axis", () => {
    const s = run({ clip: "dance_swagsurf", omega: [40, 40, 40] }, 0.5);
    expect(Math.hypot(...s.out)).toBeLessThanOrEqual(FX.lagCap + 1e-9);
    expect(Math.hypot(...s.out)).toBeGreaterThan(FX.lagCap * 0.9);
  });

  it("twists the upper body into the carve, with the twist cap", () => {
    const left = run({ clip: "carve_left", yawRate: 1.2 }, 1);
    expect(left.twistOut).toBeCloseTo(1.2 * FX.twistPerYaw, 2);
    const hard = run({ clip: "carve_right", yawRate: -20 }, 1);
    expect(hard.twistOut).toBeCloseTo(-FX.twistCap, 6);
  });

  it("gives no layers with scale 0 (?animfx=0)", () => {
    const s = run({ clip: "dance_spin", spin: 6, yawRate: 2, scale: 0 }, 1);
    expect(s.drop).toBe(0);
    expect(s.out.every((v) => v === 0)).toBe(true);
    expect(s.twistOut).toBe(0);
  });

  it("is deterministic: the same inputs give the same output", () => {
    const inp = { clip: "dance_walkitout", spin: 2, yawRate: 0.7, omega: [1, -2, 0.5] };
    expect(run(inp, 2)).toEqual(run(inp, 2));
  });
});
