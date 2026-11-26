// The saved controls (docs/gdd/trick-input.md, R12): the remapped keys and
// pad buttons, the direction source, "One-button tricks", and "Relaxed
// timing". Pure except for the storage object that the caller gives
// (`getItem`, `setItem`, as localStorage; it can be null or fail).

import { ACTIONS, DIR_ACTIONS, createBindings } from "./bindings.js";
import { DIR_SOURCES, applyDirSource } from "./remap.js";

export const CONTROLS_KEY = "atl.controls.v1";

export const DEFAULT_CONTROLS = Object.freeze({
  keyboard: {}, // action -> [code], only the changed actions
  gamepad: {}, // action -> [button index]
  dirSource: { keyboard: "both", gamepad: "both" },
  oneButton: false,
  relaxed: false,
});

const isCodeList = (v) => Array.isArray(v) && v.every((c) => typeof c === "string" && c.length > 0 && c.length < 40);
const isPadList = (v) => Array.isArray(v) && v.every((c) => Number.isInteger(c) && c >= 0 && c < 32);

// A clean controls object from anything (a bad or old save gives the defaults).
export function normalizeControls(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const keyboard = {};
  const gamepad = {};
  for (const a of ACTIONS) {
    if (isCodeList(r.keyboard?.[a])) keyboard[a] = [...r.keyboard[a]];
    if (isPadList(r.gamepad?.[a])) gamepad[a] = [...r.gamepad[a]];
  }
  const ks = DIR_SOURCES.keyboard.includes(r.dirSource?.keyboard) ? r.dirSource.keyboard : "both";
  const gs = DIR_SOURCES.gamepad.includes(r.dirSource?.gamepad) ? r.dirSource.gamepad : "both";
  return { keyboard, gamepad, dirSource: { keyboard: ks, gamepad: gs }, oneButton: r.oneButton === true, relaxed: r.relaxed === true };
}

// The bindings of a controls object: the defaults, then the direction
// source, then the remapped actions.
export function bindingsOf(controls) {
  const c = normalizeControls(controls);
  const b = applyDirSource(createBindings(), c.dirSource);
  return {
    ...b,
    keyboard: { ...b.keyboard, ...c.keyboard },
    gamepad: { ...b.gamepad, buttons: { ...b.gamepad.buttons, ...c.gamepad } },
  };
}

// The controls object of a bindings object: the actions that differ from
// the defaults with the direction source.
export function controlsOf(bindings, { dirSource, oneButton = false, relaxed = false }) {
  const base = applyDirSource(createBindings(), dirSource);
  const same = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  const keyboard = {};
  const gamepad = {};
  for (const a of ACTIONS) {
    if (!same(bindings.keyboard[a], base.keyboard[a])) keyboard[a] = [...(bindings.keyboard[a] ?? [])];
    if (!same(bindings.gamepad.buttons[a], base.gamepad.buttons[a])) gamepad[a] = [...(bindings.gamepad.buttons[a] ?? [])];
  }
  return normalizeControls({ keyboard, gamepad, dirSource, oneButton, relaxed });
}

export function readControls(storage) {
  try {
    const s = storage?.getItem(CONTROLS_KEY);
    return normalizeControls(s ? JSON.parse(s) : null);
  } catch {
    return normalizeControls(null);
  }
}

// Returns true when the save worked.
export function writeControls(storage, controls) {
  try {
    if (!storage) return false;
    storage.setItem(CONTROLS_KEY, JSON.stringify(normalizeControls(controls)));
    return true;
  } catch {
    return false;
  }
}

// The bindings after a change of the direction source of one device
// ("keyboard" or "gamepad"): the direction remaps of that device go back to
// the new source; all other remaps stay, also the direction remaps of the
// other device. `controls` has the new dirSource.
export function withDirSource(bindings, controls, device) {
  const keep = controlsOf(bindings, controls);
  for (const a of DIR_ACTIONS) delete keep[device][a];
  return bindingsOf({ ...keep, dirSource: controls.dirSource });
}
