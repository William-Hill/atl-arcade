// The Controls screen (docs/gdd/trick-input.md, R12; #328): the remap of the
// keyboard and the gamepad, the direction source, "One-button tricks", and
// "Relaxed timing". The settings menu opens it. The pure logic is in
// src/input/remap.js and src/input/controls-store.js.
//
// A native <dialog> with showModal(). A click on a key cell waits for the
// next key; a click on a pad cell waits for the next pad button. The game
// refuses two actions of one group on one key and says which action has it.
// Escape cancels a wait; with no wait, Escape closes the screen. Each change
// saves at once.

import { DIR_ACTIONS, MOVE_ACTIONS } from "../input/bindings.js";
import { bindingsOf, controlsOf, withDirSource } from "../input/controls-store.js";
import { ACTION_NAMES, RESERVED_KEYS, keyName, newPadButton, padButtonName, remap } from "../input/remap.js";

// Colors as the settings menu: paper #f3f3f7 on #14141c is 17:1, the pink
// #ff5fb2 is 6.9:1, the muted #c4c4d0 is 11:1, the yellow #ffd166 is 12:1.
const STYLE = `
#controls-menu {
  width: min(560px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; box-sizing: border-box;
  padding: 16px 18px; border: 2px solid rgba(255, 255, 255, 0.25); border-radius: 12px;
  background: #14141c; color: #f3f3f7; font: 15px/1.4 system-ui, sans-serif;
}
#controls-menu::backdrop { background: rgba(0, 0, 0, 0.55); }
#controls-menu h2 { margin: 0 0 8px; font-size: 18px; letter-spacing: 0.1em; color: #ff5fb2; }
#controls-menu fieldset { margin: 0 0 12px; padding: 8px 10px 10px; border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 8px; }
#controls-menu legend { padding: 0 4px; font-weight: 700; }
#controls-menu :focus-visible { outline: 3px solid #ff5fb2; outline-offset: 2px; }
#controls-menu .controls-option { display: flex; align-items: flex-start; gap: 10px; min-height: 32px; padding: 4px 0; cursor: pointer; }
#controls-menu .controls-option input { width: 20px; height: 20px; margin: 2px 0 0; flex: none; accent-color: #ff5fb2; }
#controls-menu .controls-option small, #controls-menu .controls-note { display: block; color: #c4c4d0; font-size: 13px; }
#controls-menu .controls-field { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 4px 0; }
#controls-menu select { min-height: 36px; padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.4); background: #22222e; color: #f3f3f7; font: inherit; }
#controls-menu table { width: 100%; border-collapse: collapse; }
#controls-menu th { text-align: left; font-size: 13px; color: #c4c4d0; font-weight: 600; padding: 2px 4px; }
#controls-menu td { padding: 2px 4px; }
#controls-menu td button {
  width: 100%; min-height: 36px; padding: 4px 8px; border: 2px solid rgba(255, 255, 255, 0.35); border-radius: 6px;
  background: #22222e; color: #f3f3f7; font: 600 14px system-ui, sans-serif; cursor: pointer; text-align: left;
}
#controls-menu td button[data-waiting="1"] { border-style: dashed; border-color: #ff5fb2; }
#controls-menu .controls-status { min-height: 1.4em; margin: 0 0 10px; font-size: 14px; }
#controls-menu .controls-status[data-kind="refused"] { color: #ffd166; font-weight: 700; }
#controls-menu .controls-status[data-kind="refused"]::before { content: "\\26A0  "; }
#controls-menu .controls-row { display: flex; gap: 8px; }
#controls-menu .controls-row button {
  flex: 1; min-height: 44px; padding: 8px 12px; border: 2px solid rgba(255, 255, 255, 0.4); border-radius: 8px;
  background: #22222e; color: #f3f3f7; font: 600 15px system-ui, sans-serif; cursor: pointer;
}
`;

function el(tag, parent, props = {}) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  parent.appendChild(node);
  return node;
}

function checkbox(parent, id, title, hint) {
  const label = el("label", parent, { className: "controls-option", htmlFor: id });
  const input = el("input", label, { type: "checkbox", id });
  const span = el("span", label, { textContent: title });
  el("small", span, { textContent: hint });
  return input;
}

const listName = (codes, name) => (codes && codes.length ? codes.map(name).join(", ") : "None");

// `controls`: the saved controls (src/input/controls-store.js).
// `onApply(controls, bindings)`: a change, to save and to give to the input.
// `getGamepads()`: the Gamepad API list. `onChange(open)`: the screen opens or closes.
export function createRemapScreen({ root = document.body, controls, onApply = () => {}, onChange = () => {}, getGamepads = () => (navigator.getGamepads ? navigator.getGamepads() : []) } = {}) {
  if (!document.getElementById("controls-menu-style")) el("style", document.head, { id: "controls-menu-style", textContent: STYLE });

  let state = { ...controls };
  let bindings = bindingsOf(state);
  let waiting = null; // { device, action, button, padBefore }
  let raf = 0;

  const dialog = el("dialog", root, { id: "controls-menu" });
  dialog.setAttribute("aria-labelledby", "controls-title");
  el("h2", dialog, { id: "controls-title", textContent: "CONTROLS" });

  const trickSet = el("fieldset", dialog, { id: "controls-tricks" });
  el("legend", trickSet, { textContent: "Tricks" });
  const oneButton = checkbox(trickSet, "controls-one-button", "One-button tricks", "TRICK picks the trick from the place: a rail, the ground, or the air. A hold on the ground starts a manual.");
  const relaxed = checkbox(trickSet, "controls-relaxed", "Relaxed timing", "Longer windows for the trick direction, the flick, and the landing.");

  const sourceSet = el("fieldset", dialog, { id: "controls-source" });
  el("legend", sourceSet, { textContent: "Trick direction" });
  const kbField = el("div", sourceSet, { className: "controls-field" });
  el("label", kbField, { htmlFor: "controls-source-keyboard", textContent: "Keyboard" });
  const kbSource = el("select", kbField, { id: "controls-source-keyboard" });
  for (const [v, t] of [["both", "W A S D and arrows"], ["wasd", "W A S D"], ["arrows", "Arrows"]]) el("option", kbSource, { value: v, textContent: t });
  const padField = el("div", sourceSet, { className: "controls-field" });
  el("label", padField, { htmlFor: "controls-source-gamepad", textContent: "Gamepad" });
  const padSource = el("select", padField, { id: "controls-source-gamepad" });
  for (const [v, t] of [["both", "Stick and d-pad"], ["stick", "Stick"], ["dpad", "D-pad"]]) el("option", padSource, { value: v, textContent: t });

  const status = el("p", dialog, { className: "controls-status", id: "controls-status" });
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const cells = {};
  function table(legend, id, actions, note) {
    const set = el("fieldset", dialog, { id });
    el("legend", set, { textContent: legend });
    if (note) el("p", set, { className: "controls-note", textContent: note });
    const t = el("table", set);
    const head = el("tr", el("thead", t));
    for (const h of ["Action", "Keyboard", "Gamepad"]) el("th", head, { textContent: h, scope: "col" });
    const body = el("tbody", t);
    for (const a of actions) {
      const tr = el("tr", body);
      el("th", tr, { textContent: ACTION_NAMES[a], scope: "row" });
      const kb = el("button", el("td", tr), { type: "button", id: `controls-key-${a}` });
      const pad = el("button", el("td", tr), { type: "button", id: `controls-pad-${a}` });
      kb.dataset.action = a;
      pad.dataset.action = a;
      kb.addEventListener("click", () => wait("keyboard", a, kb));
      pad.addEventListener("click", () => wait("gamepad", a, pad));
      cells[a] = { kb, pad };
    }
  }
  table("Movement and buttons", "controls-move", MOVE_ACTIONS);
  table("Trick directions", "controls-dirs", DIR_ACTIONS, "A key can hold one movement action and one direction: W pushes and gives up.");

  const row = el("div", dialog, { className: "controls-row" });
  const resetButton = el("button", row, { type: "button", id: "controls-reset", textContent: "Reset to defaults" });
  const doneButton = el("button", row, { type: "button", id: "controls-done", textContent: "Done" });

  function show() {
    oneButton.checked = state.oneButton;
    relaxed.checked = state.relaxed;
    kbSource.value = state.dirSource.keyboard;
    padSource.value = state.dirSource.gamepad;
    for (const [a, { kb, pad }] of Object.entries(cells)) {
      const kw = waiting && waiting.action === a && waiting.device === "keyboard";
      const pw = waiting && waiting.action === a && waiting.device === "gamepad";
      kb.textContent = kw ? "Press a key" : listName(bindings.keyboard[a], keyName);
      pad.textContent = pw ? "Press a button" : listName(bindings.gamepad.buttons[a], padButtonName);
      kb.dataset.waiting = kw ? "1" : "0";
      pad.dataset.waiting = pw ? "1" : "0";
      kb.setAttribute("aria-label", `${ACTION_NAMES[a]}, keyboard: ${kb.textContent}. Select to change.`);
      pad.setAttribute("aria-label", `${ACTION_NAMES[a]}, gamepad: ${pad.textContent}. Select to change.`);
    }
  }
  function say(text, kind = "info") {
    status.textContent = text;
    status.dataset.kind = kind;
  }
  function apply() {
    state = controlsOf(bindings, { dirSource: state.dirSource, oneButton: state.oneButton, relaxed: state.relaxed });
    onApply(state, bindings);
    show();
  }

  function padButtons() {
    let pads = [];
    try {
      pads = getGamepads() || [];
    } catch {
      pads = [];
    }
    const p = [...pads].find((x) => x && x.connected !== false);
    return p ? Array.from(p.buttons ?? [], (b) => Boolean(b && (b.pressed || b.value > 0.5))) : [];
  }
  function stopWait() {
    waiting = null;
    cancelAnimationFrame(raf);
    show();
  }
  function wait(device, action, button) {
    waiting = { device, action, button, padBefore: padButtons() };
    say(device === "keyboard" ? `Press a key for ${ACTION_NAMES[action]}. Escape cancels.` : `Press a gamepad button for ${ACTION_NAMES[action]}. Escape cancels.`);
    show();
    if (device === "gamepad") {
      const poll = () => {
        if (!waiting || waiting.device !== "gamepad") return;
        const now = padButtons();
        const i = newPadButton(waiting.padBefore, now);
        waiting.padBefore = now;
        if (i !== null) take(i);
        else raf = requestAnimationFrame(poll);
      };
      raf = requestAnimationFrame(poll);
    }
  }
  function take(code) {
    const { device, action, button } = waiting;
    const name = device === "keyboard" ? keyName(code) : padButtonName(code);
    const r = remap(bindings, device, action, code);
    stopWait();
    if (!r.ok) {
      say(`${name} is on ${r.clash.map((a) => ACTION_NAMES[a]).join(", ")}. ${ACTION_NAMES[action]} did not change.`, "refused");
    } else {
      bindings = r.bindings;
      apply();
      say(`${ACTION_NAMES[action]} is now ${name}.`);
    }
    button.focus();
  }

  dialog.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (!waiting) return;
    // Escape cancels a keyboard wait and a gamepad wait.
    if (e.code === "Escape") {
      e.preventDefault();
      const b = waiting.button;
      stopWait();
      say("No change.");
      b.focus();
      return;
    }
    if (waiting.device !== "keyboard") return;
    e.preventDefault();
    if (e.repeat) return;
    if (RESERVED_KEYS.includes(e.code)) {
      say(`${keyName(e.code)} opens a menu. Pick another key.`, "refused");
      return;
    }
    take(e.code);
  });
  dialog.addEventListener("keyup", (e) => e.stopPropagation());
  // Escape during a wait cancels the wait, not the screen.
  dialog.addEventListener("cancel", (e) => {
    if (waiting) e.preventDefault();
  });
  dialog.addEventListener("close", () => {
    stopWait();
    onChange(false);
  });

  oneButton.addEventListener("change", () => {
    state = { ...state, oneButton: oneButton.checked };
    apply();
    say(oneButton.checked ? "One-button tricks on." : "One-button tricks off.");
  });
  relaxed.addEventListener("change", () => {
    state = { ...state, relaxed: relaxed.checked };
    apply();
    say(relaxed.checked ? "Relaxed timing on." : "Relaxed timing off.");
  });
  // A new source sets the direction keys of that device only; the other
  // remaps stay, also the direction remaps of the other device.
  const source = (device) => {
    state = { ...state, dirSource: { keyboard: kbSource.value, gamepad: padSource.value } };
    bindings = withDirSource(bindings, state, device);
    apply();
    say("Trick direction changed.");
  };
  kbSource.addEventListener("change", () => source("keyboard"));
  padSource.addEventListener("change", () => source("gamepad"));
  resetButton.addEventListener("click", () => {
    stopWait();
    state = { ...state, keyboard: {}, gamepad: {}, dirSource: { keyboard: "both", gamepad: "both" } };
    bindings = bindingsOf(state);
    apply();
    say("All keys and buttons are back to the defaults.");
  });
  doneButton.addEventListener("click", () => dialog.close());
  show();

  return {
    get isOpen() {
      return dialog.open;
    },
    get state() {
      return { ...state };
    },
    get bindings() {
      return bindings;
    },
    open() {
      if (dialog.open) return;
      say("");
      show();
      dialog.showModal();
      onChange(true);
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
