import { describe, expect, it } from "vitest";
import { COMBO, GRIND, STYLE } from "./constants.js";
import { createRun, runScriptOnRun, stepRun } from "./run.js";
import { createSkaterEnv } from "./skater.js";
import { comboString } from "./combo.js";
import { GREYBOX } from "../../level/greybox.js";
import { createGroundSampler } from "../../level/ground.js";

const env = { sampleGround: createGroundSampler(GREYBOX) };
const skaterEnv = createSkaterEnv(GREYBOX);
const BAL = GRIND.balanceDrift / GRIND.balanceCorrect;

// Approach the straight rail, grind with balance, jump off, land, shuffle.
export const THREE_LINK = [
  { frames: 90, input: { push: true } },
  { frames: 40, input: { grind: true, steer: BAL } },
  { frames: 1, input: { grind: true, steer: BAL, jump: true } },
  { frames: 45, input: {} },
  { frames: 1, input: { style1: true } },
  { frames: 100, input: {} },
];

describe("style moves", () => {
  it("runs for the move duration while rolling and reports completion", () => {
    let r = createRun(GREYBOX);
    r.skater.speed = 5;
    r = stepRun(r, { style1: true }, 1 / 60, env, skaterEnv);
    expect(r.skater.style).toMatchObject({ id: "shuffle", anim: "tilt" });
    const ticks = Math.ceil(STYLE.moves[0].duration * 60);
    let done = null;
    for (let i = 0; i < ticks + 1 && !done; i += 1) {
      r = stepRun(r, {}, 1 / 60, env, skaterEnv);
      if (r.skater.justStyled) done = r.skater.justStyled;
    }
    expect(done).toMatchObject({ id: "shuffle", points: 120 });
    expect(r.combo.links).toHaveLength(1);
    expect(r.combo.style).toBeCloseTo(COMBO.styleGain);
  });

  it("has two distinct moves on two buttons", () => {
    let r = createRun(GREYBOX);
    r.skater.speed = 5;
    const a = stepRun(r, { style1: true }, 1 / 60, env, skaterEnv).skater.style;
    const b = stepRun(r, { style2: true }, 1 / 60, env, skaterEnv).skater.style;
    expect(a.id).not.toBe(b.id);
    expect(a.anim).not.toBe(b.anim);
    expect(a.duration).not.toBe(b.duration);
  });

  it("needs speed and cancels when the skater leaves the ground", () => {
    let r = createRun(GREYBOX);
    r = stepRun(r, { style1: true }, 1 / 60, env, skaterEnv);
    expect(r.skater.style).toBeNull();
    r.skater.speed = 5;
    r = stepRun(r, { style2: true }, 1 / 60, env, skaterEnv);
    expect(r.skater.style).not.toBeNull();
    r = stepRun(r, { jump: true }, 1 / 60, env, skaterEnv);
    expect(r.skater.state).toBe("air");
    expect(r.skater.style).toBeNull();
  });
});

describe("a scripted grind, jump, style run", () => {
  it("yields a 3-link combo worth pending times 3", () => {
    const { run, states } = runScriptOnRun(createRun(GREYBOX, { position: [-26, 0, -2], yaw: 0 }), THREE_LINK, { env, skaterEnv, trace: true });
    const peak = states.reduce((best, r) => (r.combo.links.length > best.combo.links.length ? r : best), states[0]);
    expect(peak.combo.links.map((l) => l.move)).toEqual(["grind", "air", "style"]);
    expect(comboString(peak.combo)).toBe("Rail Grind + Hop + Shuffle");
    expect(peak.combo.multiplier).toBe(3);
    expect(peak.combo.pending).toBeGreaterThan(COMBO.grindBase + COMBO.hopPoints + 120 - 1);
    // After the link window the combo banks.
    expect(run.combo.active).toBe(false);
    expect(run.combo.score).toBe(peak.combo.pending * 3);
    expect(run.combo.best).toBe(run.combo.score);
    expect(run.combo.bails).toBe(0);
  });

  it("bails on a rail fall and keeps nothing pending", () => {
    const script = [
      { frames: 90, input: { push: true } },
      { frames: 200, input: { grind: true } },
    ];
    const { run, states } = runScriptOnRun(createRun(GREYBOX, { position: [-26, 0, -2], yaw: 0 }), script, { env, skaterEnv, trace: true });
    const fell = states.find((r) => r.skater.justFell);
    expect(fell).toBeTruthy();
    expect(fell.combo.links).toHaveLength(0);
    expect(fell.combo.bails).toBe(1);
    expect(fell.combo.score).toBe(0);
    // The grind button stays held, so the skater re-snaps after the fall.
    expect(run.skater.stats.snaps).toBeGreaterThanOrEqual(2);
  });

  it("scores vert air off the quarter pipe", () => {
    let r = createRun(GREYBOX, { position: [24.5, 0, 0], yaw: 0 });
    r.skater.speed = 12;
    const { run, states } = runScriptOnRun(r, [{ frames: 240, input: {} }], { env, skaterEnv, trace: true });
    const landed = states.find((x) => x.moves.some((m) => m.name === "Vert Air"));
    expect(landed).toBeTruthy();
    expect(run.combo.score).toBe(COMBO.vertAirPoints);
  });
});
