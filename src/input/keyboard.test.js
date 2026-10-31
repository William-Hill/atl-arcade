import { describe, expect, it } from "vitest";
import { createKeyboard } from "./keyboard.js";

function fakeTarget() {
  const listeners = {};
  return {
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    removeEventListener: () => {},
    fire: (type, event) => (listeners[type] || []).forEach((fn) => fn(event)),
  };
}

function key(code) {
  return { code, prevented: false, preventDefault() { this.prevented = true; } };
}

describe("keyboard sampler", () => {
  it("grinds on F, not on Control", () => {
    const t = fakeTarget();
    const kb = createKeyboard(t);
    t.fire("keydown", key("ControlLeft"));
    expect(kb.sample().grind).toBe(false);
    t.fire("keydown", key("KeyF"));
    expect(kb.sample().grind).toBe(true);
  });

  it("prevents the browser default for every bound key", () => {
    const t = fakeTarget();
    createKeyboard(t);
    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "KeyF", "Space", "ArrowUp"]) {
      const e = key(code);
      t.fire("keydown", e);
      expect(e.prevented, code).toBe(true);
    }
    const free = key("KeyL");
    t.fire("keydown", free);
    expect(free.prevented).toBe(false);
  });
});
