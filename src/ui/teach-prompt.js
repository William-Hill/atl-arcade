// Teach prompts (#76): one prompt at a time at the bottom middle of the
// screen, with the icon of the active input (keyboard, gamepad, or touch).
// On the grind step a pin shows the rail or ledge in the world, or an arrow
// on the screen edge when it is off the screen; the stance and the manual
// link steps (#331) show the same pin. On touch, the button of the
// step glows. Plain DOM; the step logic is pure (src/ui/teach-steps.js).
// Nothing here draws in WebGL, so the prompts add no draw call.

import { Vector3 } from "three";
import "./teach.css";
import { PIN_STEPS, TEACH, TEACH_DONE, TEACH_SPOTS, TEACH_STEPS, TEACH_STORAGE_KEY, createTeach, inputKind, pinLabel, pinPlacement, promptFor, stepTeach, teachMode, teachStart, teachTarget, touchButtonFor } from "./teach-steps.js";

const MOVES = TEACH_STEPS.filter((s) => s !== "combo");

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function readStored(storage) {
  try {
    return storage?.getItem(TEACH_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStored(storage, value) {
  try {
    if (value === null) storage?.removeItem(TEACH_STORAGE_KEY);
    else storage?.setItem(TEACH_STORAGE_KEY, value);
  } catch {
    // Private mode: the prompts show again next time.
  }
}

// `param` is ?teach. `geo` is true on a geodata level. `grindables` are the
// skater env grindables. `gamepad()` is true when a gamepad is connected.
// `oneButton()` is true when the "One-button tricks" switch is on (R12.1).
export function createTeachPrompts({ parent = document.body, levelName = "", geo = true, param = null, storage = null, grindables = [], touch = false, gamepad = () => false, oneButton = () => false, reducedMotion = () => false } = {}) {
  const stored = readStored(storage);
  const mode = teachMode(param, stored, geo);
  if (param === "1") writeStored(storage, null);
  let state = createTeach(teachStart(param, stored));
  let started = false;
  let doneStep = null;
  let doneUntil = 0;
  let target = null;
  let kind = touch ? "touch" : "keyboard";
  let shownKey = "";
  let visible = false;

  if (mode === "off") {
    return {
      enabled: false,
      observe() {},
      update() {},
      hook: { enabled: false, step: null, finished: true, done: {}, kind: null, target: null, visible: false, prompt: null },
    };
  }

  const root = el("div", "teach", parent);
  root.id = "teach";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.hidden = true;
  const card = el("div", "teach-card", root);
  const icons = el("div", "teach-icons", card);
  const text = el("div", "teach-text", card);
  const title = el("div", "teach-title", text);
  const hint = el("div", "teach-hint", text);
  const count = el("div", "teach-count", card);

  const pin = el("div", "teach-pin", parent);
  pin.id = "teach-pin";
  pin.hidden = true;
  pin.setAttribute("aria-hidden", "true");
  const pinArrow = el("div", "teach-pin-arrow", pin);
  const pinText = el("div", "teach-pin-label", pin);

  const spots = TEACH_SPOTS[levelName] ?? null;
  const v = new Vector3();
  let litButton = null;

  function iconNode(icon) {
    const node = el("span", `teach-icon teach-icon-${icon.type}`);
    node.textContent = icon.label;
    return node;
  }

  function render(prompt, done) {
    const key = done ? `done:${done}` : `${prompt.step}:${kind}:${prompt.title}:${prompt.hint}:${prompt.icons.map((i) => i.label).join(",")}`;
    if (key === shownKey) return;
    shownKey = key;
    root.dataset.done = done ? "1" : "0";
    root.dataset.step = done ?? prompt.step;
    root.dataset.kind = kind;
    icons.replaceChildren();
    if (done) {
      const check = el("span", "teach-icon teach-icon-check", icons);
      check.textContent = "✓";
      title.textContent = "Good";
      hint.textContent = "";
      hint.hidden = true;
    } else {
      for (const i of prompt.icons) icons.appendChild(iconNode(i));
      icons.hidden = prompt.icons.length === 0;
      title.textContent = prompt.title;
      hint.textContent = prompt.hint;
      hint.hidden = !prompt.hint;
    }
    if (done) icons.hidden = false;
    const n = MOVES.indexOf(done ?? prompt.step);
    count.textContent = n >= 0 ? `${n + 1} of ${MOVES.length}` : "Tip";
  }

  function light(action) {
    if (litButton === action) return;
    if (litButton) document.querySelector(`.touch-btn.touch-${litButton}`)?.removeAttribute("data-teach");
    litButton = action;
    if (action) document.querySelector(`.touch-btn.touch-${action}`)?.setAttribute("data-teach", "1");
  }

  function hideAll() {
    if (!root.hidden) root.hidden = true;
    if (!pin.hidden) pin.hidden = true;
    light(null);
    visible = false;
  }

  return {
    enabled: true,
    // One fixed tick, after the run step.
    observe(prev, s, input = {}, combo = null, dt = 1 / 60) {
      if (state.finished) return;
      if (!started && (input.push || input.jump || input.grind || input.style1 || input.style2 || input.brake || Math.abs(input.steer ?? 0) > 0.3)) started = true;
      state = stepTeach(state, prev, s, input, combo, dt, TEACH, { oneButton: oneButton() });
      if (state.justDone.length) {
        doneStep = state.justDone[state.justDone.length - 1];
        doneUntil = performance.now() + TEACH.doneMs;
      }
      if (state.finished) writeStored(storage, TEACH_DONE);
    },
    // Once per frame. `hidden` is true while a menu, the photo mode, or the
    // results cover the game.
    update({ nowMs = performance.now(), camera = null, source = "keyboard", bindings = null, position = [0, 0, 0], hidden = false } = {}) {
      const flashing = doneStep && nowMs < doneUntil;
      if (hidden || (state.finished && !flashing)) {
        hideAll();
        return;
      }
      kind = inputKind(source, { touch, gamepad: gamepad(), started });
      const ob = { oneButton: oneButton() };
      const prompt = promptFor(state.step, kind, bindings, ob);
      render(prompt, flashing ? doneStep : null);
      root.dataset.rm = reducedMotion() ? "1" : "0";
      if (root.hidden) root.hidden = false;
      visible = true;
      light(!flashing && kind === "touch" ? touchButtonFor(state.step, ob) : null);

      // The rail pin: the grind, the stance, and the manual link need a rail.
      target = PIN_STEPS.includes(state.step) && !flashing ? teachTarget(grindables, position, spots) : null;
      if (!target || !camera) {
        if (!pin.hidden) pin.hidden = true;
        return;
      }
      v.set(target.point[0], target.point[1] + 0.6, target.point[2]).project(camera);
      const w = window.innerWidth;
      const h = window.innerHeight;
      const place = pinPlacement({ x: v.x, y: v.y, z: v.z }, w, h, 48);
      pin.hidden = false;
      pin.dataset.edge = place.onScreen ? "0" : "1";
      pin.style.transform = `translate(${Math.round(place.x)}px, ${Math.round(place.y)}px)`;
      pinArrow.style.transform = `rotate(${place.angle}rad)`;
      const label = pinLabel(target);
      if (pinText.textContent !== label) pinText.textContent = label;
    },
    // For the tests (window.__atl.teach).
    hook: {
      enabled: true,
      get step() {
        return state.step;
      },
      get finished() {
        return state.finished;
      },
      get done() {
        return { ...state.done };
      },
      get kind() {
        return kind;
      },
      get target() {
        return target ? { ...target } : null;
      },
      get visible() {
        return visible;
      },
      get prompt() {
        return visible ? { title: title.textContent, hint: hint.textContent, icons: [...icons.children].map((n) => ({ type: n.className.replace(/.*teach-icon-/, ""), label: n.textContent })), count: count.textContent } : null;
      },
    },
  };
}
