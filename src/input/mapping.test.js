import { describe, expect, it } from "vitest";
import { ACTIONS, createBindings, rebind } from "./bindings.js";
import { EMPTY_INPUT, isActive, mapGamepad, mapKeyboard, mergeInputs } from "./mapping.js";

const bindings = createBindings();
const keys = (...codes) => new Set(codes);
const pad = ({ axes = [0, 0, 0, 0], pressed = [] } = {}) => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
});

describe("keyboard mapping", () => {
  it("maps WASD and arrows to steer, push, and brake", () => {
    expect(mapKeyboard(keys("KeyA"), bindings).steer).toBe(1);
    expect(mapKeyboard(keys("ArrowRight"), bindings).steer).toBe(-1);
    expect(mapKeyboard(keys("KeyA", "KeyD"), bindings).steer).toBe(0);
    expect(mapKeyboard(keys("KeyW"), bindings).push).toBe(true);
    expect(mapKeyboard(keys("ShiftLeft"), bindings).push).toBe(true);
    expect(mapKeyboard(keys("ArrowDown"), bindings).brake).toBe(true);
  });

  it("maps Space, Control, Q, and E", () => {
    const i = mapKeyboard(keys("Space", "ControlLeft", "KeyQ", "KeyE"), bindings);
    expect(i).toMatchObject({ jump: true, grind: true, style1: true, style2: true, push: false });
  });

  it("gives the empty input with nothing held", () => {
    expect(mapKeyboard(keys(), bindings)).toEqual({ ...EMPTY_INPUT });
    expect(isActive(mapKeyboard(keys(), bindings))).toBe(false);
  });
});

describe("gamepad mapping", () => {
  it("maps the left stick to steer with a deadzone and stick left as steer left", () => {
    expect(mapGamepad(pad({ axes: [-1, 0] }), bindings).steer).toBe(1);
    expect(mapGamepad(pad({ axes: [1, 0] }), bindings).steer).toBe(-1);
    expect(mapGamepad(pad({ axes: [0.1, 0] }), bindings).steer).toBe(0);
    const half = mapGamepad(pad({ axes: [-0.575, 0] }), bindings).steer;
    expect(half).toBeCloseTo(0.5);
  });

  it("maps A, X, Y, B, RT, LT", () => {
    expect(mapGamepad(pad({ pressed: [0] }), bindings).jump).toBe(true);
    expect(mapGamepad(pad({ pressed: [2] }), bindings).push).toBe(true);
    expect(mapGamepad(pad({ pressed: [3] }), bindings).style1).toBe(true);
    expect(mapGamepad(pad({ pressed: [1] }), bindings).style2).toBe(true);
    expect(mapGamepad(pad({ pressed: [7] }), bindings).grind).toBe(true);
    expect(mapGamepad(pad({ pressed: [6] }), bindings).brake).toBe(true);
  });

  it("treats an analog trigger past half as pressed and the d-pad as steer", () => {
    const p = pad();
    p.buttons[7] = { pressed: false, value: 0.8 };
    expect(mapGamepad(p, bindings).grind).toBe(true);
    expect(mapGamepad(pad({ pressed: [14] }), bindings).steer).toBe(1);
    expect(mapGamepad(pad({ pressed: [15] }), bindings).steer).toBe(-1);
  });

  it("survives a pad with no buttons or axes", () => {
    expect(mapGamepad({ axes: [], buttons: [] }, bindings)).toEqual({ ...EMPTY_INPUT });
  });
});

describe("rebinding", () => {
  it("moves an action to new codes on one device", () => {
    const b = rebind(bindings, "keyboard", "jump", "KeyJ");
    expect(mapKeyboard(keys("Space"), b).jump).toBe(false);
    expect(mapKeyboard(keys("KeyJ"), b).jump).toBe(true);
    expect(mapKeyboard(keys("Space"), bindings).jump).toBe(true); // original untouched
    const g = rebind(bindings, "gamepad", "grind", [5]);
    expect(mapGamepad(pad({ pressed: [7] }), g).grind).toBe(false);
    expect(mapGamepad(pad({ pressed: [5] }), g).grind).toBe(true);
  });

  it("rejects unknown actions and devices", () => {
    expect(() => rebind(bindings, "keyboard", "fly", "KeyF")).toThrow();
    expect(() => rebind(bindings, "mouse", "jump", "Button0")).toThrow();
    expect(ACTIONS).toContain("grind");
  });

  it("accepts overrides at creation", () => {
    const b = createBindings({ keyboard: { push: ["KeyP"] }, gamepad: { deadzone: 0.5 } });
    expect(mapKeyboard(keys("KeyW"), b).push).toBe(false);
    expect(mapKeyboard(keys("KeyP"), b).push).toBe(true);
    expect(mapGamepad(pad({ axes: [-0.4, 0] }), b).steer).toBe(0);
    expect(mapGamepad(pad({ pressed: [0] }), b).jump).toBe(true);
  });
});

describe("merge", () => {
  it("ORs buttons and keeps the stronger steer", () => {
    const a = { ...EMPTY_INPUT, steer: 0.3, push: true };
    const b = { ...EMPTY_INPUT, steer: -0.8, jump: true };
    expect(mergeInputs(a, b)).toMatchObject({ steer: -0.8, push: true, jump: true, grind: false });
  });
});
