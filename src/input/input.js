// Frame-sampled input from the keyboard and the first connected gamepad.
// `sample()` is called once per fixed tick and returns the controller input
// shape. The gamepad is used when connected; the keyboard always works.
// Tests drive the controller with src/input/scripted.js instead.

import { createBindings } from "./bindings.js";
import { EMPTY_INPUT, isActive, mapGamepad, mapKeyboard, mergeInputs } from "./mapping.js";

// `touch` is an optional touch overlay from src/input/touch.js. Its input
// merges with the keyboard and the gamepad.
export function createInput({ target = window, bindings = createBindings(), getGamepads = () => (navigator.getGamepads ? navigator.getGamepads() : []), touch = null } = {}) {
  const down = new Set();
  let current = bindings;
  let source = "keyboard";
  let padId = null;

  // Every bound key prevents its browser default (page scroll, Space, and
  // the like), so play never triggers a browser action.
  let bound = new Set(Object.values(bindings.keyboard).flat());
  const onDown = (e) => {
    down.add(e.code);
    if (bound.has(e.code)) e.preventDefault();
  };
  const onUp = (e) => down.delete(e.code);
  const onBlur = () => down.clear();
  target.addEventListener("keydown", onDown);
  target.addEventListener("keyup", onUp);
  target.addEventListener("blur", onBlur);

  function firstPad() {
    let pads = [];
    try {
      pads = getGamepads() || [];
    } catch {
      pads = [];
    }
    for (const p of pads) if (p && p.connected !== false) return p;
    return null;
  }

  return {
    sample() {
      const keyboard = mapKeyboard(down, current);
      const pad = firstPad();
      padId = pad ? pad.id ?? "gamepad" : null;
      let out = keyboard;
      if (!pad) {
        if (source === "gamepad") source = "keyboard";
      } else {
        const gamepad = mapGamepad({ axes: Array.from(pad.axes ?? []), buttons: Array.from(pad.buttons ?? []) }, current);
        if (isActive(gamepad)) source = "gamepad";
        else if (isActive(keyboard)) source = "keyboard";
        out = mergeInputs(keyboard, gamepad);
      }
      if (touch) {
        const t = touch.sample();
        if (touch.touching) source = "touch";
        // A key after a touch gives the source back to the keyboard. An
        // active gamepad keeps the source that the gamepad step set.
        else if (source === "touch" && isActive(keyboard)) source = "keyboard";
        out = mergeInputs(out, t);
      }
      return out;
    },
    get source() {
      return source;
    },
    get gamepadId() {
      return padId;
    },
    get bindings() {
      return current;
    },
    set bindings(b) {
      current = b;
      bound = new Set(Object.values(b.keyboard).flat());
    },
    dispose() {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur);
    },
    empty: EMPTY_INPUT,
  };
}
