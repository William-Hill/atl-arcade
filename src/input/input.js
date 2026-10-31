// Frame-sampled input from the keyboard and the first connected gamepad.
// `sample()` is called once per fixed tick and returns the controller input
// shape. The gamepad is used when connected; the keyboard always works.
// Tests drive the controller with src/input/scripted.js instead.

import { createBindings } from "./bindings.js";
import { EMPTY_INPUT, isActive, mapGamepad, mapKeyboard, mergeInputs } from "./mapping.js";

const PREVENT = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function createInput({ target = window, bindings = createBindings(), getGamepads = () => (navigator.getGamepads ? navigator.getGamepads() : []) } = {}) {
  const down = new Set();
  let current = bindings;
  let source = "keyboard";
  let padId = null;

  const onDown = (e) => {
    down.add(e.code);
    if (PREVENT.has(e.code)) e.preventDefault();
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
      if (!pad) {
        source = "keyboard";
        return keyboard;
      }
      const gamepad = mapGamepad({ axes: Array.from(pad.axes ?? []), buttons: Array.from(pad.buttons ?? []) }, current);
      if (isActive(gamepad)) source = "gamepad";
      else if (isActive(keyboard)) source = "keyboard";
      return mergeInputs(keyboard, gamepad);
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
    },
    dispose() {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur);
    },
    empty: EMPTY_INPUT,
  };
}
