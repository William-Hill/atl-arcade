// Remapping (docs/gdd/trick-input.md, R12.2). Pure.
//
// The actions are in 2 groups: the movement and button group (MOVE_ACTIONS)
// and the direction group (DIR_ACTIONS). The game refuses two actions of one
// group on one key or pad button. One key can hold one action of each group:
// the default W is `push` and `dirUp`. A bind replaces the keys of the action,
// so after "G to grind" F does nothing for grind. A reset to the defaults is
// always possible. The direction source is a choice too.

import { DIR_ACTIONS, MOVE_ACTIONS, createBindings } from "./bindings.js";

export const groupOf = (action) => (DIR_ACTIONS.includes(action) ? DIR_ACTIONS : MOVE_ACTIONS.includes(action) ? MOVE_ACTIONS : null);

function codesOf(bindings, device, action) {
  if (device === "keyboard") return bindings.keyboard[action] ?? [];
  return bindings.gamepad.buttons[action] ?? [];
}

// The other actions of the group of `action` that use `code` on `device`.
export function findClash(bindings, device, action, code) {
  const group = groupOf(action);
  if (!group) throw new Error(`remap: unknown action ${action}`);
  return group.filter((a) => a !== action && codesOf(bindings, device, a).includes(code));
}

// Binds `code` (a KeyboardEvent.code, or a pad button index) to `action`.
// Returns { ok: true, bindings } or { ok: false, clash, bindings } with the
// bindings not changed.
export function remap(bindings, device, action, code) {
  if (device !== "keyboard" && device !== "gamepad") throw new Error(`remap: unknown device ${device}`);
  const clash = findClash(bindings, device, action, code);
  if (clash.length) return { ok: false, clash, bindings };
  if (device === "keyboard") return { ok: true, bindings: { ...bindings, keyboard: { ...bindings.keyboard, [action]: [code] } } };
  return { ok: true, bindings: { ...bindings, gamepad: { ...bindings.gamepad, buttons: { ...bindings.gamepad.buttons, [action]: [code] } } } };
}

export const resetBindings = () => createBindings();

// The direction source (R12.2): keyboard "both" (W/A/S/D and the arrows),
// "wasd", or "arrows"; gamepad "both" (the stick and the d-pad), "stick", or
// "dpad".
export const DIR_SOURCES = Object.freeze({ keyboard: ["both", "wasd", "arrows"], gamepad: ["both", "stick", "dpad"] });
const WASD = { dirLeft: "KeyA", dirRight: "KeyD", dirUp: "KeyW", dirDown: "KeyS" };
const ARROWS = { dirLeft: "ArrowLeft", dirRight: "ArrowRight", dirUp: "ArrowUp", dirDown: "ArrowDown" };
const DPAD = { dirLeft: 14, dirRight: 15, dirUp: 12, dirDown: 13 };

export function applyDirSource(bindings, { keyboard = "both", gamepad = "both" } = {}) {
  const kb = { ...bindings.keyboard };
  for (const a of DIR_ACTIONS) kb[a] = keyboard === "wasd" ? [WASD[a]] : keyboard === "arrows" ? [ARROWS[a]] : [WASD[a], ARROWS[a]];
  const buttons = { ...bindings.gamepad.buttons };
  for (const a of DIR_ACTIONS) buttons[a] = gamepad === "stick" ? [] : [DPAD[a]];
  return { ...bindings, keyboard: kb, gamepad: { ...bindings.gamepad, buttons, dirStick: gamepad !== "dpad" } };
}

// --- Names for the screen -----------------------------------------------------

export const ACTION_NAMES = Object.freeze({
  left: "Steer left",
  right: "Steer right",
  push: "Push",
  brake: "Brake",
  jump: "Jump",
  grind: "Grind",
  style1: "Trick",
  style2: "Spin",
  switch: "Switch",
  dirLeft: "Trick left",
  dirRight: "Trick right",
  dirUp: "Trick up",
  dirDown: "Trick down",
});

const KEY_NAMES = { Space: "Space", ShiftLeft: "Left Shift", ShiftRight: "Right Shift", ArrowUp: "Up arrow", ArrowDown: "Down arrow", ArrowLeft: "Left arrow", ArrowRight: "Right arrow", ControlLeft: "Left Ctrl", ControlRight: "Right Ctrl", AltLeft: "Left Alt", AltRight: "Right Alt", Enter: "Enter", Tab: "Tab", Backspace: "Backspace" };

export function keyName(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

const PAD_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "Left stick", "Right stick", "D-pad up", "D-pad down", "D-pad left", "D-pad right", "Home"];
export const padButtonName = (i) => PAD_NAMES[i] ?? `Button ${i}`;

// Keys the remap screen does not take: Escape cancels; O, P, M, H, and T open
// the settings, the photo mode, the map, the debug panel, and the trick list
// (#330).
export const RESERVED_KEYS = Object.freeze(["Escape", "KeyO", "KeyP", "KeyM", "KeyH", "KeyT"]);

// The first pad button that is down in `now` and was up in `before`, or null.
export function newPadButton(before, now) {
  for (let i = 0; i < now.length; i += 1) if (now[i] && !before[i]) return i;
  return null;
}
