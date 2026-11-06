import { describe, expect, it } from "vitest";
import { LEAN, blending, createBlend, leanLayers, leanTarget, rollFor, startBlend, stepBlend, stepLean } from "./anim-blend.js";
import { ANIM, CLIPS, FADES, createAnimState, fadeFor, groupOf, stepAnim } from "./skater-anim.js";

const sum = (w) => Object.values(w).reduce((a, b) => a + b, 0);
const rolling = (extra = {}) => ({ state: "rolling", speed: 5, yaw: 0, style: null, ...extra });

// Steps a blend for `seconds` at 60 Hz and returns every frame's weights.
function frames(blend, seconds, dt = 1 / 60) {
  const out = [];
  let b = blend;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    b = stepBlend(b, dt);
    out.push(b.weights);
  }
  return { blend: b, out };
}

describe("fade times for each state change", () => {
  it("gives every clip a group", () => {
    for (const name of Object.keys(CLIPS)) expect(groupOf(name), name).not.toBe("other");
    expect(groupOf("wall_slide")).toBe("other");
  });

  it("has a fade time for every pair of clips, between 0.04 s and 0.5 s", () => {
    const names = Object.keys(CLIPS);
    for (const a of names) for (const b of names) {
      const t = fadeFor(a, b);
      expect(t, `${a} -> ${b}`).toBeGreaterThanOrEqual(0.04);
      expect(t, `${a} -> ${b}`).toBeLessThanOrEqual(0.5);
    }
  });

  it("fades fast into an impact and slow between ground clips", () => {
    expect(fadeFor("coast", "bail")).toBeLessThan(0.1);
    expect(fadeFor("air_mute", "land")).toBeLessThan(0.1);
    expect(fadeFor("coast", "jump")).toBeLessThan(0.1);
    expect(fadeFor("coast", "push")).toBeLessThan(fadeFor("push", "coast"));
    expect(fadeFor("carve_left", "carve_right")).toBeGreaterThan(fadeFor("coast", "push"));
    expect(fadeFor("idle", "coast")).toBeGreaterThanOrEqual(0.3);
    expect(fadeFor("coast", "ride_back")).toBe(ANIM.turnTime);
    expect(fadeFor("jump", "air_japan")).toBe(0.15);
    expect(fadeFor("grind_soul", "coast")).toBe(0.15);
  });

  it("keys on clip names, so an unknown clip gets the default", () => {
    expect(fadeFor("wall_slide", "hard_land")).toBe(ANIM.fade);
    expect(fadeFor("coast", "wall_slide")).toBe(ANIM.fade);
    // A rule list with one clip name.
    expect(fadeFor("coast", "wall_slide", [["*", "wall_slide", 0.1], ...FADES])).toBe(0.1);
  });

  it("stepAnim reports the fade of its change", () => {
    let anim = createAnimState();
    const changes = [];
    for (const s of [rolling(), rolling({ pushing: true }), rolling(), rolling({ speed: 0 })]) {
      const r = stepAnim(anim, s, 1 / 60);
      anim = r.anim;
      if (r.change) changes.push(r.change);
    }
    for (const c of changes) expect(c.fade).toBe(fadeFor(c.from, c.to));
  });
});

describe("the blender", () => {
  it("starts with one clip at weight 1", () => {
    const b = createBlend("idle");
    expect(b.weights).toEqual({ idle: 1 });
    expect(blending(b)).toBe(false);
  });

  it("fades from one clip to the next in the fade time, with weights that sum to 1", () => {
    const { blend, out } = frames(startBlend(createBlend("coast"), "push", 0.12), 0.2);
    for (const w of out) expect(sum(w)).toBeCloseTo(1, 9);
    expect(out[3].push).toBeGreaterThan(0);
    expect(out[3].push).toBeLessThan(1);
    expect(blend.weights).toEqual({ push: 1 });
    expect(blending(blend)).toBe(false);
  });

  it("changes the weights by small steps (no pop), and starts and ends the fade with a small step", () => {
    const fade = 0.25;
    const { out } = frames(startBlend(createBlend("push"), "coast", fade), fade);
    const steps = out.map((w, i) => (w.coast ?? 0) - (i ? out[i - 1].coast ?? 0 : 0));
    // smoothstep: the largest step is 1.5 / frames; the first and last are small.
    expect(Math.max(...steps)).toBeLessThan((1.5 / out.length) * 1.05);
    expect(steps[0]).toBeLessThan(0.02);
    expect(steps.at(-1)).toBeLessThan(0.02);
  });

  it("does not reset a clip that a second change cuts in the middle of its fade", () => {
    // coast -> push, and after 0.06 s back to coast.
    let { blend } = frames(startBlend(createBlend("coast"), "push", 0.12), 0.06);
    const before = { ...blend.weights };
    expect(before.coast).toBeGreaterThan(0.3);
    blend = startBlend(blend, "coast", 0.25);
    // The first frame of the new fade keeps the weights of the last frame.
    const next = stepBlend(blend, 1 / 60).weights;
    expect(Math.abs(next.coast - before.coast)).toBeLessThan(0.03);
    expect(Math.abs(next.push - before.push)).toBeLessThan(0.03);
    expect(frames(blend, 0.3).blend.weights).toEqual({ coast: 1 });
  });

  it("fades out every clip of a three-way blend", () => {
    let b = frames(startBlend(createBlend("coast"), "push", 0.2), 0.1).blend;
    b = frames(startBlend(b, "carve_left", 0.3), 0.1).blend;
    expect(Object.keys(b.weights).sort()).toEqual(["carve_left", "coast", "push"]);
    expect(sum(b.weights)).toBeCloseTo(1, 9);
    b = frames(b, 0.3).blend;
    expect(b.weights).toEqual({ carve_left: 1 });
  });

  it("changes at once with a fade of 0", () => {
    expect(stepBlend(startBlend(createBlend("coast"), "bail", 0), 1 / 60).weights).toEqual({ bail: 1 });
  });
});

describe("the carve lean", () => {
  it("banks into the turn by a part of the centripetal angle, with a limit", () => {
    // A left turn (positive yaw rate) banks left (positive).
    expect(leanTarget(rolling({ speed: 6 }), 0.45)).toBeCloseTo(LEAN.scale * Math.atan((6 * 0.45) / 9.81), 6);
    expect(leanTarget(rolling({ speed: 6 }), -0.45)).toBeLessThan(0);
    expect(leanTarget(rolling({ speed: 12 }), 3)).toBe(LEAN.maxBank);
    expect(leanTarget(rolling({ speed: 12 }), -3)).toBe(-LEAN.maxBank);
    expect(leanTarget(rolling({ speed: 6 }), 0)).toBe(0);
  });

  it("does not lean in the air, on a rail, in a dance, or when the skater stands", () => {
    expect(leanTarget({ ...rolling(), state: "air" }, 1)).toBe(0);
    expect(leanTarget({ ...rolling(), state: "grind" }, 1)).toBe(0);
    expect(leanTarget(rolling({ style: { clip: "dance_spin" } }), 1)).toBe(0);
    expect(leanTarget(rolling({ speed: 0.1 }), 1)).toBe(0);
    expect(leanTarget(rolling({ manual: true }), 1)).toBe(0);
    expect(leanTarget(null, 1)).toBe(0);
  });

  it("smooths the lean the same way at 30 Hz and at 120 Hz", () => {
    const run = (hz) => {
      let l = 0;
      for (let i = 0; i < hz * 0.2; i += 1) l = stepLean(l, 0.2, 1 / hz);
      return l;
    };
    expect(run(30)).toBeCloseTo(run(120), 9);
    expect(run(60)).toBeGreaterThan(0.15);
    expect(stepLean(0.1, 0.2, 0)).toBe(0.1);
  });

  it("adds the carve lean pose on top of the coast and the push only", () => {
    expect(leanLayers(LEAN.maxBank, "coast")).toEqual({ carve_left: LEAN.layer, carve_right: 0 });
    expect(leanLayers(-LEAN.maxBank / 2, "push")).toEqual({ carve_left: 0, carve_right: LEAN.layer / 2 });
    expect(leanLayers(0, "coast")).toEqual({ carve_left: 0, carve_right: 0 });
    // A carve clip has its own lean.
    expect(leanLayers(LEAN.maxBank, "carve_left")).toEqual({ carve_left: 0, carve_right: 0 });
    expect(leanLayers(LEAN.maxBank, "grind_soul")).toEqual({ carve_left: 0, carve_right: 0 });
  });

  it("rolls the model top toward the inside of the turn", () => {
    // heading(yaw) = [cos, 0, -sin]: a left turn at yaw 0 goes to -z. A
    // positive roll tilts the top to +z, so a left bank is a negative roll.
    expect(rollFor(0.2)).toBe(-0.2);
  });
});
