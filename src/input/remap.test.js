import { describe, expect, it } from "vitest";
import { createBindings } from "./bindings.js";
import { CONTROLS_KEY, bindingsOf, controlsOf, normalizeControls, readControls, withDirSource, writeControls } from "./controls-store.js";
import { mapGamepad, mapKeyboard, padDir } from "./mapping.js";
import { applyDirSource, findClash, keyName, newPadButton, padButtonName, remap, resetBindings } from "./remap.js";
import { stickDir } from "./direction.js";

const keys = (...c) => new Set(c);
const pad = ({ axes = [0, 0], pressed = [] } = {}) => ({ axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });

describe("#328 remap (R12.2)", () => {
  it("AC: with G on grind, a bind of G to jump is refused; G still grinds and F does nothing for grind", () => {
    const a = remap(createBindings(), "keyboard", "grind", "KeyG");
    expect(a.ok).toBe(true);
    const b = remap(a.bindings, "keyboard", "jump", "KeyG");
    expect(b).toMatchObject({ ok: false, clash: ["grind"] });
    expect(b.bindings).toBe(a.bindings);
    expect(mapKeyboard(keys("KeyG"), b.bindings)).toMatchObject({ grind: true, jump: false });
    expect(mapKeyboard(keys("KeyF"), b.bindings).grind).toBe(false);
  });

  it("refuses two actions of one group on one gamepad button", () => {
    const r = remap(createBindings(), "gamepad", "jump", 7); // RT is grind
    expect(r).toMatchObject({ ok: false, clash: ["grind"] });
    const ok = remap(createBindings(), "gamepad", "jump", 5);
    expect(ok.ok).toBe(true);
    expect(mapGamepad(pad({ pressed: [5] }), ok.bindings).jump).toBe(true);
    expect(mapGamepad(pad({ pressed: [0] }), ok.bindings).jump).toBe(false);
  });

  it("lets one key hold one action of each group (W is push and dirUp)", () => {
    expect(findClash(createBindings(), "keyboard", "dirUp", "KeyW")).toEqual([]);
    expect(findClash(createBindings(), "keyboard", "dirDown", "KeyW")).toEqual(["dirUp"]);
    // A move action on a direction-only key is permitted.
    const r = remap(createBindings(), "keyboard", "jump", "KeyW");
    expect(r).toMatchObject({ ok: false, clash: ["push"] });
    expect(remap(createBindings(), "keyboard", "dirUp", "KeyI").ok).toBe(true);
  });

  it("resets to the defaults", () => {
    expect(resetBindings()).toEqual(createBindings());
  });

  it("throws on an unknown action or device", () => {
    expect(() => remap(createBindings(), "keyboard", "fly", "KeyG")).toThrow();
    expect(() => remap(createBindings(), "mouse", "jump", "KeyG")).toThrow();
  });
});

describe("#328 direction source (R12.2)", () => {
  it("keyboard: W/A/S/D only, or the arrows only", () => {
    const w = applyDirSource(createBindings(), { keyboard: "wasd" });
    expect(w.keyboard.dirUp).toEqual(["KeyW"]);
    const a = applyDirSource(createBindings(), { keyboard: "arrows" });
    expect(a.keyboard.dirLeft).toEqual(["ArrowLeft"]);
    expect(a.keyboard.left).toEqual(["KeyA", "ArrowLeft"]); // steer does not change
  });

  it("gamepad: the stick only, or the d-pad only", () => {
    const sd = (x, y) => stickDir(x, y);
    const stick = applyDirSource(createBindings(), { gamepad: "stick" });
    expect(padDir(pad({ pressed: [12] }), stick, sd)).toBe("n");
    expect(padDir(pad({ axes: [0, -1] }), stick, sd)).toBe("u");
    const dpad = applyDirSource(createBindings(), { gamepad: "dpad" });
    expect(padDir(pad({ axes: [0, -1] }), dpad, sd)).toBe("n");
    expect(padDir(pad({ pressed: [12] }), dpad, sd)).toBe("u");
  });
});

describe("#328 a source change of one device keeps the remaps of the other device", () => {
  it("keyboard Trick up on I stays after the gamepad source goes to the d-pad", () => {
    const both = { keyboard: "both", gamepad: "both" };
    const b = remap(createBindings(), "keyboard", "dirUp", "KeyI").bindings;
    const next = withDirSource(b, { dirSource: { keyboard: "both", gamepad: "dpad" } }, "gamepad");
    expect(next.keyboard.dirUp).toEqual(["KeyI"]);
    expect(next.gamepad.dirStick).toBe(false);
    // The keyboard source change resets the keyboard direction remap only.
    const pad = remap(createBindings(), "gamepad", "dirUp", 3).bindings;
    const mixed = remap(pad, "keyboard", "dirUp", "KeyI").bindings;
    const kb = withDirSource(mixed, { dirSource: { ...both, keyboard: "wasd" } }, "keyboard");
    expect(kb.keyboard.dirUp).toEqual(["KeyW"]);
    expect(kb.gamepad.buttons.dirUp).toEqual([3]);
  });
});

describe("#328 saved controls", () => {
  function memory() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
  }

  it("saves and reads the remaps, the direction source, and the 2 switches", () => {
    const s = memory();
    let b = remap(createBindings(), "keyboard", "grind", "KeyG").bindings;
    b = remap(b, "gamepad", "jump", 5).bindings;
    const c = controlsOf(b, { dirSource: { keyboard: "both", gamepad: "both" }, oneButton: true, relaxed: true });
    expect(c.keyboard).toEqual({ grind: ["KeyG"] });
    expect(c.gamepad).toEqual({ jump: [5] });
    expect(writeControls(s, c)).toBe(true);
    const back = readControls(s);
    expect(back).toMatchObject({ oneButton: true, relaxed: true });
    expect(bindingsOf(back)).toEqual(b);
  });

  it("gives the defaults for a bad save or a failed storage", () => {
    const s = memory();
    s.setItem(CONTROLS_KEY, "{not json");
    expect(readControls(s)).toEqual(normalizeControls(null));
    expect(readControls(null).oneButton).toBe(false);
    expect(writeControls({ setItem() { throw new Error("full"); } }, {})).toBe(false);
    expect(normalizeControls({ keyboard: { jump: [5] }, gamepad: { jump: ["KeyA"] }, dirSource: { keyboard: "x" } })).toEqual(normalizeControls(null));
  });
});

describe("remap names", () => {
  it("names keys and pad buttons", () => {
    expect(keyName("KeyG")).toBe("G");
    expect(keyName("ArrowUp")).toBe("Up arrow");
    expect(keyName("Digit4")).toBe("4");
    expect(padButtonName(7)).toBe("RT");
    expect(padButtonName(30)).toBe("Button 30");
    expect(newPadButton([true, false, false], [true, false, true])).toBe(2);
    expect(newPadButton([true], [true])).toBeNull();
  });
});
