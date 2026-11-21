import { describe, expect, it } from "vitest";
import { TOUCH, TOUCH_BUTTONS, createButtonState, mapTouch, steerFromX, stickVector, wantsTouch } from "./touch-map.js";
import { EMPTY_INPUT } from "./mapping.js";

describe("stickVector", () => {
  it("scales the thumb offset by the radius", () => {
    expect(stickVector({ x: 100, y: 100 }, { x: 128, y: 100 }, 56)).toEqual({ x: 0.5, y: 0 });
  });
  it("clamps a long drag to the unit circle", () => {
    const v = stickVector({ x: 0, y: 0 }, { x: 300, y: 400 }, 50);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(0.6);
    expect(v.y).toBeCloseTo(0.8);
  });
});

describe("steerFromX", () => {
  it("is zero inside the deadzone", () => {
    expect(steerFromX(0.1)).toBe(0);
    expect(steerFromX(-TOUCH.deadzone)).toBe(0);
  });
  it("steers left (+) for a stick to the left, like the gamepad", () => {
    expect(steerFromX(-1)).toBe(1);
    expect(steerFromX(1)).toBe(-1);
  });
  it("rescales the rest of the travel to the full range", () => {
    const mid = TOUCH.deadzone + (1 - TOUCH.deadzone) / 2;
    expect(steerFromX(mid)).toBeCloseTo(-0.5);
  });
});

describe("mapTouch", () => {
  it("gives the empty input with no stick and no buttons", () => {
    expect(mapTouch({ stick: null, buttons: {} })).toEqual(EMPTY_INPUT);
  });
  it("pushes with the stick up and brakes with the stick down", () => {
    expect(mapTouch({ stick: { x: 0, y: -1 } }).push).toBe(true);
    expect(mapTouch({ stick: { x: 0, y: -1 } }).brake).toBe(false);
    expect(mapTouch({ stick: { x: 0, y: 1 } }).brake).toBe(true);
    expect(mapTouch({ stick: { x: 0, y: 1 } }).push).toBe(false);
  });
  it("does not push or brake near the middle", () => {
    const m = mapTouch({ stick: { x: 0.9, y: 0.1 } });
    expect(m.push).toBe(false);
    expect(m.brake).toBe(false);
    expect(m.steer).toBeLessThan(0);
  });
  it("pushes and steers on a diagonal up-left drag", () => {
    const m = mapTouch({ stick: stickVector({ x: 0, y: 0 }, { x: -40, y: -40 }) });
    expect(m.push).toBe(true);
    expect(m.steer).toBeGreaterThan(0);
  });
  it("passes the held buttons through", () => {
    const m = mapTouch({ stick: null, buttons: { jump: true, grind: true, style1: false, style2: true } });
    expect(m).toMatchObject({ jump: true, grind: true, style1: false, style2: true, switch: false });
  });
  it("passes SWITCH through, so a touch player can ride backward", () => {
    expect(mapTouch({ stick: null, buttons: { switch: true } }).switch).toBe(true);
    expect(mapTouch({ stick: { x: 0, y: -1 }, buttons: { switch: true } })).toMatchObject({ push: true, switch: true });
    expect(mapTouch({ stick: null, buttons: { switch: false } }).switch).toBe(false);
  });
  it("has a button for every button action of the controller input", () => {
    const actions = Object.keys(EMPTY_INPUT).filter((k) => typeof EMPTY_INPUT[k] === "boolean" && k !== "push" && k !== "brake");
    expect([...TOUCH_BUTTONS].sort()).toEqual(actions.sort());
  });
  it("never gives a negative zero steer", () => {
    expect(Object.is(mapTouch({ stick: { x: -0.01, y: 0 } }).steer, -0)).toBe(false);
  });
});

describe("wantsTouch", () => {
  it("follows the URL parameter first", () => {
    expect(wantsTouch("1", { maxTouchPoints: 0 })).toBe(true);
    expect(wantsTouch("0", { maxTouchPoints: 5, coarse: true })).toBe(false);
  });
  it("turns on for a touch screen", () => {
    expect(wantsTouch(null, { maxTouchPoints: 5 })).toBe(true);
    expect(wantsTouch(null, { coarse: true })).toBe(true);
    expect(wantsTouch(null, { maxTouchPoints: 0, coarse: false })).toBe(false);
  });
});

describe("createButtonState", () => {
  it("is down while a pointer holds the button", () => {
    const b = createButtonState();
    b.down("jump", 1);
    expect(b.snapshot().jump).toBe(true);
    expect(b.snapshot().jump).toBe(true);
    b.up("jump", 1);
    expect(b.snapshot().jump).toBe(false);
  });
  it("keeps a tap that ends before the next sample for one sample only", () => {
    const b = createButtonState();
    b.down("switch", 7);
    b.up("switch", 7);
    expect(b.isDown("switch")).toBe(false);
    expect(b.snapshot()).toMatchObject({ switch: true, jump: false });
    expect(b.snapshot().switch).toBe(false);
  });
  it("stays down until the last of two pointers lifts", () => {
    const b = createButtonState();
    b.down("grind", 1);
    b.down("grind", 2);
    b.up("grind", 1);
    expect(b.isDown("grind")).toBe(true);
    expect(b.any).toBe(true);
    b.up("grind", 2);
    b.snapshot();
    expect(b.any).toBe(false);
    expect(b.snapshot().grind).toBe(false);
  });
  it("gives every touch button in the snapshot", () => {
    expect(Object.keys(createButtonState().snapshot()).sort()).toEqual([...TOUCH_BUTTONS].sort());
  });
});
