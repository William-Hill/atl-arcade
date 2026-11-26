// Frame-sampled input from the keyboard and the first connected gamepad.
// `sample(t)` is called once per fixed tick and returns the controller input
// shape. The gamepad is used when connected; the keyboard always works.
// Tests drive the controller with src/input/scripted.js instead.
//
// Trick directions (docs/gdd/trick-input.md, R2, R3): the frame also has the
// fields of the direction contract in src/input/direction.js (`t`, `dir`,
// `lastDir`, `lastDirAt`, `lastDirHeld`, `dirHist`, `balance`), the touch
// flick fields (`flick`, `grindFlick`, src/input/flick.js), and the trick
// modes (`oneButton`, `relaxed`, GDD R12). `t` is the
// sim time of the step that reads the frame (s); a key event gets the time
// of the first sample after it. With no `t`, the input counts 1/60 s per sample.

import { DIR_OF_ACTION, createBindings } from "./bindings.js";
import { createKeyDirs, createPadDirs, dirFields, keyBalance, keyDirDown, keyDirUp, keyDirsClear, padDirUpdate, stickDir } from "./direction.js";
import { EMPTY_INPUT, isActive, mapGamepad, mapKeyboard, mergeBalance, mergeInputs, padBalance, padDir } from "./mapping.js";
import { EPS, TRICK_INPUT, trickKnobs } from "./trick-constants.js";

const STEP = 1 / 60;
const LOG_MAX = 600;
const NO_FLICK = Object.freeze({ style1: null, style2: null, grind: null });

// `touch` is an optional touch overlay from src/input/touch.js. Its input
// merges with the keyboard and the gamepad.
export function createInput({ target = window, bindings = createBindings(), getGamepads = () => (navigator.getGamepads ? navigator.getGamepads() : []), touch = null, knobs = TRICK_INPUT } = {}) {
  const down = new Set();
  let current = bindings;
  let source = "keyboard";
  let padId = null;
  let k = knobs;
  let mode = { oneButton: false, relaxed: false, r3Only: false };
  // Direction key events wait in order for the next sample, which gives them
  // its time. `dirCodes` is the held keys as the events give them.
  const queue = [];
  const dirCodes = new Set();
  let keyDirs = createKeyDirs();
  let padDirs = createPadDirs();
  let clock = 0;
  let lastFrame = null;
  let log = null;

  function applyQueue(t) {
    for (const ev of queue) {
      if (ev.clear) {
        dirCodes.clear();
        keyDirs = keyDirsClear(keyDirs, t);
        continue;
      }
      const actions = Object.keys(DIR_OF_ACTION).filter((a) => (current.keyboard[a] || []).includes(ev.code));
      if (ev.down) {
        dirCodes.add(ev.code);
        for (const a of actions) keyDirs = keyDirDown(keyDirs, DIR_OF_ACTION[a], t);
      } else {
        dirCodes.delete(ev.code);
        for (const a of actions) if (!(current.keyboard[a] || []).some((c) => dirCodes.has(c))) keyDirs = keyDirUp(keyDirs, DIR_OF_ACTION[a], t);
      }
    }
    queue.length = 0;
  }

  // Every bound key prevents its browser default (page scroll, Space, and
  // the like), so play never triggers a browser action.
  let bound = new Set(Object.values(bindings.keyboard).flat());
  const onDown = (e) => {
    if (!down.has(e.code)) queue.push({ down: true, code: e.code });
    down.add(e.code);
    if (bound.has(e.code)) e.preventDefault();
  };
  const onUp = (e) => {
    if (down.has(e.code)) queue.push({ down: false, code: e.code });
    down.delete(e.code);
  };
  const onBlur = () => {
    down.clear();
    queue.push({ clear: true });
  };
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
    sample(time) {
      const t = Number.isFinite(time) ? time : clock + STEP;
      // The sim clock went back (a new run): the old start events are not
      // fresh in the new clock. The held directions stay held.
      if (t < clock - EPS) {
        keyDirs = { ...keyDirs, lastDir: "n", lastDirAt: -Infinity, hist: keyDirs.hist.filter((e) => e.up == null).map((e) => ({ ...e, at: -Infinity })) };
        padDirs = { ...padDirs, lastDir: "n", lastDirAt: -Infinity, hist: padDirs.hist.filter((e) => e.up == null).map((e) => ({ ...e, at: -Infinity })) };
      }
      clock = t;
      applyQueue(t);
      const keyboard = mapKeyboard(down, current);
      const pad = firstPad();
      padId = pad ? pad.id ?? "gamepad" : null;
      let out = keyboard;
      let padBal = 0;
      let touchDirs = null;
      let touchBal = 0;
      let flick = NO_FLICK;
      let grindFlick = false;
      if (!pad) {
        if (source === "gamepad") source = "keyboard";
        padDirs = padDirUpdate(padDirs, "n", t);
      } else {
        const snap = { axes: Array.from(pad.axes ?? []), buttons: Array.from(pad.buttons ?? []) };
        const gamepad = mapGamepad(snap, current);
        if (isActive(gamepad)) source = "gamepad";
        else if (isActive(keyboard)) source = "keyboard";
        out = mergeInputs(keyboard, gamepad);
        padDirs = padDirUpdate(padDirs, padDir(snap, current, (x, y) => stickDir(x, y, k.stickThreshold)), t);
        padBal = padBalance(snap, current);
      }
      if (touch) {
        const tf = touch.sample(t);
        if (tf.dirs) touchDirs = tf.dirs;
        if (tf.flick) flick = tf.flick;
        grindFlick = Boolean(tf.grindFlick);
        touchBal = tf.balance || 0;
        if (touch.touching) source = "touch";
        // A key after a touch gives the source back to the keyboard. An
        // active gamepad keeps the source that the gamepad step set.
        else if (source === "touch" && isActive(keyboard)) source = "keyboard";
        out = mergeInputs(out, tf);
      }
      lastFrame = {
        ...out,
        t,
        ...dirFields(keyDirs, padDirs, touchDirs ? [touchDirs] : []),
        balance: mergeBalance(keyBalance(keyDirs), padBal, touchBal),
        flick,
        grindFlick,
        oneButton: mode.oneButton,
        relaxed: mode.relaxed,
      };
      if (log) {
        log.push(lastFrame);
        if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
      }
      return lastFrame;
    },
    // The last frame that sample() gave (for the test hook), or null.
    get frame() {
      return lastFrame;
    },
    // The frame log for the tests: log(true) starts it (empty), log(false)
    // stops it. `frames` is the list since the start (the last LOG_MAX).
    log(on) {
      log = on ? [] : null;
    },
    get frames() {
      return log ? [...log] : [];
    },
    // The trick knobs (src/input/trick-constants.js): the stick threshold.
    get knobs() {
      return k;
    },
    set knobs(v) {
      k = v;
      if (touch) touch.knobs = v;
    },
    // The trick modes of R12 (the Controls screen): { oneButton, relaxed }.
    // Relaxed timing also sets the knobs (src/input/trick-constants.js).
    get mode() {
      return { ...mode };
    },
    set mode(m) {
      mode = { oneButton: Boolean(m?.oneButton), relaxed: Boolean(m?.relaxed), r3Only: Boolean(m?.r3Only) };
      this.knobs = trickKnobs(mode);
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
    // Releases every held key. Photo mode calls it when it opens and closes,
    // so a key from one mode does not reach the other mode.
    reset() {
      down.clear();
      queue.push({ clear: true });
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
