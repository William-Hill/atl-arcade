import { describe, expect, it } from "vitest";
import { COMBO, GRIND, STYLE, styleDuration } from "./constants.js";
import { createRun, runScriptOnRun, stepRun } from "./run.js";
import { createSkaterEnv } from "./skater.js";
import { comboString } from "./combo.js";
import { GREYBOX } from "../../level/greybox.js";
import { createGroundSampler } from "../../level/ground.js";

const env = { sampleGround: createGroundSampler(GREYBOX) };
const skaterEnv = createSkaterEnv(GREYBOX);
const BAL = GRIND.balanceDrift / GRIND.balanceCorrect;

// Approach the straight rail, grind with balance, jump off, land, dance.
// The dance is 2 beats (1.2 s), then the link window banks the combo.
export const THREE_LINK = [
  { frames: 90, input: { push: true } },
  { frames: 40, input: { grind: true, steer: BAL } },
  { frames: 1, input: { grind: true, steer: BAL, jump: true } },
  { frames: 45, input: {} },
  { frames: 1, input: { style1: true } },
  { frames: 150, input: {} },
];

describe("style moves", () => {
  it("runs for the move duration while rolling and reports completion", () => {
    let r = createRun(GREYBOX);
    r.skater.speed = 5;
    r = stepRun(r, { style1: true }, 1 / 60, env, skaterEnv);
    expect(r.skater.style).toMatchObject({ id: "groove", anim: "tilt", name: "Bankhead Bounce", clip: "dance_bankhead" });
    const ticks = Math.ceil(styleDuration(STYLE.moves[0]) * 60);
    let done = null;
    for (let i = 0; i < ticks + 1 && !done; i += 1) {
      r = stepRun(r, {}, 1 / 60, env, skaterEnv);
      if (r.skater.justStyled) done = r.skater.justStyled;
    }
    expect(done).toMatchObject({ id: "groove", name: "Bankhead Bounce", points: STYLE.moves[0].points });
    expect(r.combo.links).toHaveLength(1);
    expect(r.combo.style).toBeCloseTo(COMBO.styleGain);
  });

  it("starts the next dance on each new press, and repeats a dance while the button is held", () => {
    let r = createRun(GREYBOX);
    r.skater.speed = 9;
    const names = [];
    const press = () => {
      r = stepRun(r, { style1: true }, 1 / 60, env, skaterEnv);
      names.push(r.skater.style.name);
      for (let i = 0; i < 80; i += 1) r = stepRun(r, {}, 1 / 60, env, skaterEnv);
      r.skater.speed = 9;
    };
    press();
    press();
    expect(names).toEqual(["Bankhead Bounce", "Walk It Out"]);
    // Hold: the same dance runs again after it ends.
    r = stepRun(r, { style1: true }, 1 / 60, env, skaterEnv);
    const held = r.skater.style.name;
    let repeats = 0;
    for (let i = 0; i < 150; i += 1) {
      r = stepRun(r, { style1: true }, 1 / 60, env, skaterEnv);
      if (r.skater.justStyled) repeats += 1;
      expect(r.skater.style?.name ?? held).toBe(held);
    }
    expect(repeats).toBe(2);
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
    expect(comboString(peak.combo)).toBe("Rail Grind + Hop + Bankhead Bounce");
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

describe("run signals for the loop and the HUD", () => {
  const hop = [{ frames: 1, input: { jump: true } }, { frames: 100, input: {} }];

  it("reports a bank once per banked combo", () => {
    let r = createRun(GREYBOX, { position: [0, 0, 0], yaw: 0 });
    r.skater.speed = 4;
    const { states } = runScriptOnRun(r, [...hop, ...hop], { env, skaterEnv, trace: true });
    const banks = states.filter((x) => x.banked > 0);
    expect(banks).toHaveLength(2);
    expect(banks.every((x) => x.banked === COMBO.hopPoints)).toBe(true);
  });

  it("keeps the last move and a sequence number across ticks with no move", () => {
    let r = createRun(GREYBOX, { position: [0, 0, 0], yaw: 0 });
    r.skater.speed = 4;
    const { states } = runScriptOnRun(r, hop, { env, skaterEnv, trace: true });
    const scored = states.findIndex((x) => x.moves.length > 0);
    expect(scored).toBeGreaterThan(0);
    const later = states[scored + 5];
    expect(later.moves).toEqual([]);
    expect(later.lastMove).toMatchObject({ name: "Hop" });
    expect(later.moveSeq).toBe(1);
  });

  it("bails the combo when the skater respawns", () => {
    let r = createRun(GREYBOX, { position: [0, 0, 0], yaw: 0 });
    r.skater.speed = 4;
    r = runScriptOnRun(r, [{ frames: 1, input: { jump: true } }, { frames: 30, input: {} }], { env, skaterEnv }).run;
    expect(r.combo.active).toBe(true);
    r.skater = { ...r.skater, position: [10, -5, 0], state: "air" };
    r = stepRun(r, {}, 1 / 60, { ...env, bounds: GREYBOX.bounds, spawn: GREYBOX.spawn }, skaterEnv);
    expect(r.skater.respawned).toBe(true);
    expect(r.combo.active).toBe(false);
    expect(r.combo.bails).toBe(1);
  });
});

describe("teleportRun", async () => {
  const { createRun, teleportRun } = await import("./run.js");

  it("moves the skater to rest at the new place, and keeps the score and the time", () => {
    const level = { spawn: { position: [0, 0, 0], yaw: 0 } };
    const run = { ...createRun(level, { position: [0, 0, 0], yaw: 0 }), time: 12, score: 345 };
    const next = teleportRun(run, level, { position: [50, 2, -30], yaw: 1 });
    expect(next.skater.position).toEqual([50, 2, -30]);
    expect(next.skater.yaw).toBe(1);
    expect(next.skater.speed).toBe(0);
    expect(next.time).toBe(12);
    expect(next.score).toBe(345);
    expect(next.moves).toEqual([]);
    expect(run.skater.position).toEqual([0, 0, 0]);
  });
});
