import { describe, expect, it } from "vitest";
import { TOUCH, mapTouch, steerFromX, stickVector, wantsTouch } from "./touch-map.js";
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
