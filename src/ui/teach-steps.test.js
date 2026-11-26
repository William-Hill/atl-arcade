import { describe, expect, it } from "vitest";
import { createBindings } from "../input/bindings.js";
import { TEACH, TEACH_SPOTS, TEACH_STEPS, createTeach, currentStep, inputKind, keyLabel, keyLabels, pinLabel, pinPlacement, promptFor, stepTeach, teachMode, teachTarget, touchButtonFor } from "./teach-steps.js";

const rolling = (extra = {}) => ({ state: "rolling", speed: 4, style: null, justJumped: false, justSnapped: false, justExited: false, exitReason: null, ...extra });

// Steps the teach state for `seconds` with the same skater and input.
function hold(t, s, input, seconds, combo = null) {
  let out = t;
  for (let i = 0; i < Math.round(seconds * 60); i += 1) out = stepTeach(out, s, s, input, combo);
  return out;
}

describe("teach steps (#76)", () => {
  it("starts at push and has the five moves in order, then the combo tip", () => {
    expect(TEACH_STEPS).toEqual(["push", "steer", "jump", "dance", "grind", "combo"]);
    const t = createTeach();
    expect(t.step).toBe("push");
    expect(t.finished).toBe(false);
  });

  it("push is done after the push is held for pushTime while rolling", () => {
    let t = hold(createTeach(), rolling(), { push: true }, TEACH.pushTime - 0.1);
    expect(t.step).toBe("push");
    t = hold(t, rolling(), { push: true }, 0.15);
    expect(t.done.push).toBe(true);
    expect(t.step).toBe("steer");
  });

  it("push in the air does not count", () => {
    const t = hold(createTeach(), rolling({ state: "air" }), { push: true }, 2);
    expect(t.done.push).toBeUndefined();
  });

  it("steer needs speed and a real stick or key amount", () => {
    let t = hold(createTeach(), rolling({ speed: 0.5 }), { steer: 1 }, 2);
    expect(t.done.steer).toBeUndefined();
    t = hold(t, rolling(), { steer: 0.1 }, 2);
    expect(t.done.steer).toBeUndefined();
    t = hold(t, rolling(), { steer: -1 }, TEACH.steerTime + 0.05);
    expect(t.done.steer).toBe(true);
  });

  it("a jump, a dance start and a grind snap each finish their step in one tick", () => {
    const t0 = createTeach();
    const j = stepTeach(t0, rolling(), rolling({ state: "air", justJumped: true }), {});
    expect(j.justDone).toEqual(["jump"]);
    const d = stepTeach(t0, rolling(), rolling({ style: { id: "groove" } }), {});
    expect(d.justDone).toEqual(["dance"]);
    const g = stepTeach(t0, rolling(), rolling({ state: "grind", justSnapped: true }), {});
    expect(g.justDone).toEqual(["grind"]);
  });

  it("a jump off a rail counts as a jump", () => {
    const t = stepTeach(createTeach(), rolling({ state: "grind" }), rolling({ state: "air", justExited: true, exitReason: "jump" }), {});
    expect(t.done.jump).toBe(true);
    const fall = stepTeach(createTeach(), rolling({ state: "grind" }), rolling({ state: "air", justExited: true, exitReason: "end" }), {});
    expect(fall.done.jump).toBeUndefined();
  });

  it("a dance that goes on does not count again", () => {
    const style = { id: "groove" };
    const t = stepTeach(createTeach(), rolling({ style }), rolling({ style }), {});
    expect(t.done.dance).toBeUndefined();
  });

  it("a move done early is skipped when its turn comes", () => {
    let t = stepTeach(createTeach(), rolling(), rolling({ justSnapped: true, state: "grind" }), {});
    expect(t.step).toBe("push");
    t = hold(t, rolling(), { push: true }, 1);
    t = hold(t, rolling(), { steer: 1 }, 1);
    t = stepTeach(t, rolling(), rolling({ justJumped: true, state: "air" }), {});
    t = stepTeach(t, rolling(), rolling({ style: { id: "spin" } }), {});
    expect(t.step).toBe("combo");
  });

  it("the combo tip ends at 3 links, or after comboTime", () => {
    const five = { push: true, steer: true, jump: true, dance: true, grind: true };
    const t = { ...createTeach(), done: five, step: "combo" };
    const two = stepTeach(t, rolling(), rolling(), {}, { links: [1, 2] });
    expect(two.finished).toBe(false);
    const three = stepTeach(t, rolling(), rolling(), {}, { links: [1, 2, 3] });
    expect(three.finished).toBe(true);
    expect(three.step).toBeNull();
    expect(three.justDone).toEqual(["combo"]);
    const late = hold(t, rolling(), {}, TEACH.comboTime + 0.1, { links: [] });
    expect(late.finished).toBe(true);
  });

  it("the combo tip does not count links before the five moves", () => {
    const t = stepTeach(createTeach(), rolling(), rolling(), {}, { links: [1, 2, 3, 4] });
    expect(t.done.combo).toBeUndefined();
  });

  it("a finished state does not change", () => {
    const t = { ...createTeach(), finished: true, step: null, justDone: [] };
    expect(stepTeach(t, rolling(), rolling({ justJumped: true }), { push: true })).toBe(t);
  });

  it("currentStep is the first step not done", () => {
    expect(currentStep({ push: true, jump: true })).toBe("steer");
    expect(currentStep(Object.fromEntries(TEACH_STEPS.map((s) => [s, true])))).toBeNull();
  });
});

describe("teach mode", () => {
  it("the URL flag wins, then the saved state, on geodata levels only", () => {
    expect(teachMode("1", "done", false)).toBe("on");
    expect(teachMode("0", null, true)).toBe("off");
    expect(teachMode(null, null, true)).toBe("on");
    expect(teachMode(null, "done", true)).toBe("off");
    expect(teachMode(null, null, false)).toBe("off");
  });
});

describe("prompt icons per input", () => {
  const b = createBindings();

  it("inputKind follows the input source; before the first input, the device", () => {
    expect(inputKind("keyboard")).toBe("keyboard");
    expect(inputKind("gamepad")).toBe("gamepad");
    expect(inputKind("touch")).toBe("touch");
    expect(inputKind("keyboard", { touch: true, started: false })).toBe("touch");
    expect(inputKind("keyboard", { gamepad: true, started: false })).toBe("gamepad");
    expect(inputKind("keyboard", { started: false })).toBe("keyboard");
  });

  it("key labels are short, letters first, no repeats", () => {
    expect(keyLabel("KeyW")).toBe("W");
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("ArrowLeft")).toBe("←");
    expect(keyLabels(["ShiftLeft", "ShiftRight", "KeyW", "ArrowUp"])).toEqual(["W", "Shift"]);
    expect(keyLabels(["ShiftLeft", "ShiftRight"], 3)).toEqual(["Shift"]);
  });

  it("every step has a title and icons for all three inputs", () => {
    for (const step of TEACH_STEPS) {
      for (const kind of ["keyboard", "gamepad", "touch"]) {
        const p = promptFor(step, kind, b);
        expect(p.title.length).toBeGreaterThan(0);
        if (step !== "combo") expect(p.icons.length).toBeGreaterThan(0);
      }
    }
  });

  it("keyboard prompts read the bindings", () => {
    expect(promptFor("push", "keyboard", b).icons).toEqual([
      { type: "key", label: "W" },
      { type: "key", label: "Shift" },
    ]);
    expect(promptFor("steer", "keyboard", b).icons.map((i) => i.label)).toEqual(["A", "D"]);
    expect(promptFor("jump", "keyboard", b).icons).toEqual([{ type: "key", label: "Space" }]);
    expect(promptFor("dance", "keyboard", b).icons.map((i) => i.label)).toEqual(["Q", "E"]);
    expect(promptFor("grind", "keyboard", b).icons.map((i) => i.label)).toEqual(["F"]);
    const re = { ...b, keyboard: { ...b.keyboard, jump: ["KeyJ"] } };
    expect(promptFor("jump", "keyboard", re).icons[0].label).toBe("J");
  });

  it("gamepad prompts name the standard buttons", () => {
    expect(promptFor("push", "gamepad", b).icons).toEqual([{ type: "pad", label: "X" }]);
    expect(promptFor("jump", "gamepad", b).icons).toEqual([{ type: "pad", label: "A" }]);
    expect(promptFor("dance", "gamepad", b).icons.map((i) => i.label)).toEqual(["Y", "B"]);
    expect(promptFor("grind", "gamepad", b).icons).toEqual([{ type: "pad", label: "RT" }]);
    expect(promptFor("steer", "gamepad", b).icons[0].type).toBe("stick");
  });

  it("touch prompts name the on-screen buttons and the stick", () => {
    expect(promptFor("push", "touch", b).icons[0].type).toBe("stick");
    expect(promptFor("jump", "touch", b).icons).toEqual([{ type: "touch", label: "JUMP" }]);
    expect(promptFor("dance", "touch", b).icons.map((i) => i.label)).toEqual(["TRICK", "SPIN"]);
    expect(promptFor("grind", "touch", b).icons).toEqual([{ type: "touch", label: "GRIND" }]);
    expect(touchButtonFor("jump")).toBe("jump");
    expect(touchButtonFor("dance")).toBe("style1");
    expect(touchButtonFor("push")).toBeNull();
  });
});

describe("grind target and pin", () => {
  const g = (id, kind, x, z) => ({ id, kind, points: [[x - 1, 1, z], [x, 1, z], [x + 1, 1, z]] });
  const pool = [g("rail:a", "rail", 10, 0), g("ledge:b", "ledge", 30, 0), g("curb:c", "curb", 2, 0), g("ledge:far", "ledge", 900, 0)];

  it("picks the nearest rail or ledge in range", () => {
    expect(teachTarget(pool, [0, 0, 0]).id).toBe("rail:a");
    expect(teachTarget(pool, [28, 0, 0]).id).toBe("ledge:b");
    expect(teachTarget(pool, [5000, 0, 0])).toBeNull();
  });

  it("uses the level teach spots when they are given", () => {
    expect(teachTarget(pool, [0, 0, 0], ["ledge:b"]).id).toBe("ledge:b");
    expect(TEACH_SPOTS["beltline-eastside"]).toHaveLength(2);
  });

  it("the pin label names the feature and the distance", () => {
    expect(pinLabel({ kind: "rail", distance: 61.6 })).toBe("Rail 62 m");
    expect(pinLabel({ kind: "ledge", distance: 3.2 })).toBe("Ledge 3 m");
    expect(pinLabel(null)).toBe("");
  });

  it("a point on the screen gets the pin on it", () => {
    const p = pinPlacement({ x: 0, y: 0, z: 0.5 }, 800, 600);
    expect(p).toMatchObject({ x: 400, y: 300, onScreen: true });
  });

  it("a point off the screen gets the pin on the edge with an arrow to it", () => {
    const right = pinPlacement({ x: 3, y: 0, z: 0.5 }, 800, 600, 40);
    expect(right.onScreen).toBe(false);
    expect(right.x).toBeCloseTo(760);
    expect(right.y).toBeCloseTo(300);
    expect(right.angle).toBeCloseTo(0);
    const up = pinPlacement({ x: 0, y: 5, z: 0.5 }, 800, 600, 40);
    expect(up.y).toBeCloseTo(40);
    expect(up.angle).toBeCloseTo(-Math.PI / 2);
  });

  it("a point behind the camera flips to the other side", () => {
    const p = pinPlacement({ x: 0.5, y: 0, z: 1.2 }, 800, 600, 40);
    expect(p.onScreen).toBe(false);
    expect(p.x).toBeLessThan(400);
    const straight = pinPlacement({ x: 0, y: 0, z: 1.2 }, 800, 600, 40);
    expect(straight.y).toBeGreaterThan(300);
  });
});
