import { describe, expect, it } from "vitest";
import { createInput } from "./input.js";

function fakeTarget() {
  const listeners = {};
  return {
    addEventListener: (type, fn) => {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener: (type, fn) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    fire: (type, event) => (listeners[type] || []).forEach((fn) => fn(event)),
    count: () => Object.values(listeners).reduce((n, l) => n + l.length, 0),
  };
}

const key = (code) => ({ code, preventDefault() {} });
const pad = (pressed = [], axes = [0, 0]) => ({ id: "fake", connected: true, axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });

describe("createInput", () => {
  it("samples held keys and clears on blur", () => {
    const t = fakeTarget();
    const input = createInput({ target: t, getGamepads: () => [] });
    t.fire("keydown", key("KeyW"));
    t.fire("keydown", key("KeyA"));
    expect(input.sample()).toMatchObject({ push: true, steer: 1 });
    expect(input.source).toBe("keyboard");
    t.fire("keyup", key("KeyW"));
    expect(input.sample().push).toBe(false);
    t.fire("blur");
    expect(input.sample().steer).toBe(0);
    input.dispose();
    expect(t.count()).toBe(0);
  });

  it("uses the gamepad when one is connected and merges it with the keyboard", () => {
    const t = fakeTarget();
    let pads = [];
    const input = createInput({ target: t, getGamepads: () => pads });
    expect(input.gamepadId).toBeNull();
    pads = [null, pad([2], [-1, 0])];
    const i = input.sample();
    expect(i).toMatchObject({ push: true, steer: 1 });
    expect(input.source).toBe("gamepad");
    expect(input.gamepadId).toBe("fake");
    t.fire("keydown", key("Space"));
    pads = [pad()];
    expect(input.sample()).toMatchObject({ jump: true, push: false });
    expect(input.source).toBe("keyboard");
  });

  it("works when getGamepads throws", () => {
    const input = createInput({ target: fakeTarget(), getGamepads: () => { throw new Error("no pads"); } });
    expect(input.sample().jump).toBe(false);
  });
});

describe("browser shortcuts", () => {
  function keyEvent(code) {
    return { code, prevented: false, preventDefault() { this.prevented = true; } };
  }

  it("grinds on F by default, not on Control", () => {
    const t = fakeTarget();
    const input = createInput({ target: t, getGamepads: () => [] });
    t.fire("keydown", keyEvent("ControlLeft"));
    expect(input.sample().grind).toBe(false);
    t.fire("keydown", keyEvent("KeyF"));
    expect(input.sample().grind).toBe(true);
  });

  it("prevents the browser default for every bound key and only those", () => {
    const t = fakeTarget();
    const input = createInput({ target: t, getGamepads: () => [] });
    const bound = Object.values(input.bindings.keyboard).flat();
    expect(bound).toContain("KeyW");
    for (const code of bound) {
      const e = keyEvent(code);
      t.fire("keydown", e);
      expect(e.prevented, code).toBe(true);
    }
    const free = keyEvent("KeyL");
    t.fire("keydown", free);
    expect(free.prevented).toBe(false);
  });
});

describe("touch", () => {
  it("merges the touch overlay input and reports the touch source", () => {
    const t = fakeTarget();
    const touch = { touching: false, out: { steer: 0, push: false, brake: false, jump: false, grind: false, style1: false, style2: false, switch: false }, sample() { return this.out; } };
    const input = createInput({ target: t, getGamepads: () => [], touch });
    expect(input.sample().push).toBe(false);
    expect(input.source).toBe("keyboard");
    touch.touching = true;
    touch.out = { ...touch.out, push: true, steer: -0.5, grind: true };
    expect(input.sample()).toMatchObject({ push: true, steer: -0.5, grind: true });
    expect(input.source).toBe("touch");
    touch.touching = false;
    touch.out = { ...touch.out, push: false, steer: 0, grind: false };
    t.fire("keydown", key("KeyA"));
    expect(input.sample().steer).toBe(1);
    expect(input.source).toBe("keyboard");
  });

  it("keeps the gamepad source when a key and the gamepad are both active", () => {
    const t = fakeTarget();
    const touch = { touching: false, sample: () => ({ steer: 0, push: false, brake: false, jump: false, grind: false, style1: false, style2: false, switch: false }) };
    const input = createInput({ target: t, getGamepads: () => [pad([2], [-1, 0])], touch });
    t.fire("keydown", key("KeyA"));
    input.sample();
    expect(input.source).toBe("gamepad");
  });
});
