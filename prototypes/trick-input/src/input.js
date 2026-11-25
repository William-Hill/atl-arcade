// The input layer of the prototype (GDD R1, R2, R11). Pure: it has no DOM.
// main.js feeds it DOM events; the playtest bots feed it scripted events.
// Both paths give the same per-frame sim input.
//
// Sim input per frame:
//   steer -1..1, push, brake, jump, grind, trick, spin (held flags),
//   dir, lastDir, lastDirAt (R2, R3), dirHist (the recent start events, for
//   the axis rule), balance -1..1 (F1 s),
//   flick: { trick, spin, grind } a direction on the frame a touch flick resolves,
//   touchGrind: true while the GRIND press comes from a touch.

import { TRICK } from "./constants.js";
import { createDirTracker, dirDown, dirUp, heldDir, stickDir, createPadTracker, padUpdate } from "./direction.js";
import { createFlick, flickMove, flickUp, flickTick } from "./flick.js";

export const DEFAULT_KEYS = {
  steerLeft: ["KeyA", "ArrowLeft"],
  steerRight: ["KeyD", "ArrowRight"],
  push: ["KeyW", "ArrowUp", "ShiftLeft", "ShiftRight"],
  brake: ["KeyS", "ArrowDown"],
  jump: ["Space"],
  grind: ["KeyF"],
  style1: ["KeyQ"], // TRICK
  style2: ["KeyE"], // SPIN
  // R2: 4 direction actions read the keys, not push or brake. Shift gives no direction.
  dirLeft: ["KeyA", "ArrowLeft"],
  dirRight: ["KeyD", "ArrowRight"],
  dirUp: ["KeyW", "ArrowUp"],
  dirDown: ["KeyS", "ArrowDown"],
};

const DIR_ACTION = { dirLeft: "l", dirRight: "r", dirUp: "u", dirDown: "d" };

// Gamepad (standard mapping): A 0 jump, B 1 SPIN, X 2 push, Y 3 TRICK, LT 6 brake, RT 7 grind, d-pad 12-15.
export const PAD = { jump: 0, spin: 1, push: 2, trick: 3, brake: 6, grind: 7, up: 12, down: 13, left: 14, right: 15, deadzone: 0.15 };

export function createInput({ keys = DEFAULT_KEYS, k = TRICK } = {}) {
  return {
    keys,
    k,
    down: new Set(), // key codes held
    dirs: createDirTracker(),
    pad: createPadTracker(),
    padState: null, // { axes, buttons }
    stick: { x: 0, y: 0 }, // touch stick, y +1 up
    touch: {}, // pointerId -> { button, flick }
    touchHeld: { jump: false, grind: false, trick: false, spin: false },
    touchPulse: { trick: false, spin: false }, // a tap: held for one frame
    touchFlickDir: { lastDir: "n", lastDirAt: -Infinity },
    resolves: [], // flick resolves not yet given to the sim: { button, dir, at }
    lastDevice: "keyboard",
  };
}

const actionsOf = (inp, code) => Object.keys(inp.keys).filter((a) => inp.keys[a].includes(code));
const actionHeld = (inp, action) => inp.keys[action].some((c) => inp.down.has(c));

// Rebind (R12.2): the game blocks two actions on one key, except the pairs
// that share a key by design (a steer key is also a direction key).
const SHARED = new Set([["steerLeft", "dirLeft"], ["steerRight", "dirRight"], ["push", "dirUp"], ["brake", "dirDown"]].map((p) => p.sort().join("|")));
export function rebind(inp, action, code) {
  const clash = actionsOf(inp, code).filter((a) => a !== action && !SHARED.has([a, action].sort().join("|")));
  if (clash.length) return { ok: false, clash };
  inp.keys = { ...inp.keys, [action]: [code] };
  return { ok: true };
}

// --- Keyboard -----------------------------------------------------------

export function keyDown(inp, code, t) {
  if (inp.down.has(code)) return; // key repeat
  inp.down.add(code);
  inp.lastDevice = "keyboard";
  for (const a of actionsOf(inp, code)) if (DIR_ACTION[a]) inp.dirs = dirDown(inp.dirs, DIR_ACTION[a], t);
}

export function keyUp(inp, code, t = null) {
  if (!inp.down.has(code)) return;
  inp.down.delete(code);
  for (const a of actionsOf(inp, code)) {
    if (!DIR_ACTION[a]) continue;
    if (!actionHeld(inp, a)) inp.dirs = dirUp(inp.dirs, DIR_ACTION[a], t);
  }
}

// --- Gamepad ------------------------------------------------------------

// `axes` and `buttons` as numbers (Gamepad API: axis 1 is +1 down).
export function padSample(inp, axes, buttons, t) {
  inp.padState = { axes: [...axes], buttons: [...buttons] };
  const b = (i) => (buttons[i] ?? 0) > 0.5;
  let dir = stickDir(axes[0] ?? 0, -(axes[1] ?? 0), inp.k.stickThreshold);
  if (b(PAD.up)) dir = "u";
  else if (b(PAD.down)) dir = "d";
  else if (b(PAD.left)) dir = "l";
  else if (b(PAD.right)) dir = "r";
  inp.pad = padUpdate(inp.pad, dir, t);
  if (buttons.some((v) => v > 0.5) || Math.abs(axes[0] ?? 0) > 0.3 || Math.abs(axes[1] ?? 0) > 0.3) inp.lastDevice = "gamepad";
}

// The controller disconnects: clear the cached sample and the held stick
// direction, so a lost controller does not steer or hold a button.
export function padDisconnect(inp, t) {
  if (!inp.padState) return;
  inp.padState = null;
  inp.pad = padUpdate(inp.pad, "n", t);
}

// --- Touch --------------------------------------------------------------

// `button` is one of jump, grind, trick, spin, switch. Coordinates in px.
export function touchDown(inp, id, button, x, y, t) {
  inp.lastDevice = "touch";
  if (button === "trick" || button === "spin" || button === "grind") {
    inp.touch[id] = { button, flick: createFlick(button, x, y, t * 1000) };
    if (button === "grind") inp.touchHeld.grind = true; // R6: GRIND press at the touch-down
  } else {
    inp.touch[id] = { button };
    if (button === "jump") inp.touchHeld.jump = true;
  }
}

function noteResolve(inp, entry) {
  const r = entry.flick.resolved;
  inp.resolves.push({ button: entry.button, dir: r.dir, at: r.atMs / 1000, by: r.by });
}

export function touchMove(inp, id, x, y, t) {
  const e = inp.touch[id];
  if (!e || !e.flick || e.flick.resolved) return;
  e.flick = flickMove(e.flick, x, y, t * 1000, inp.k);
  if (e.flick.resolved) noteResolve(inp, e);
}

export function touchUp(inp, id, t) {
  const e = inp.touch[id];
  if (!e) return;
  delete inp.touch[id];
  if (e.button === "jump") inp.touchHeld.jump = false;
  if (!e.flick) return;
  if (e.button === "grind") inp.touchHeld.grind = false;
  if (!e.flick.resolved) {
    e.flick = flickUp(e.flick, t * 1000);
    noteResolve(inp, e);
    if (e.button !== "grind") inp.touchPulse[e.button] = true;
  } else if (e.button !== "grind") inp.touchHeld[e.button] = false;
}

// The touch stick: x -1..1 (right +), y -1..1 (up +).
export function touchStick(inp, x, y) {
  inp.stick = { x, y };
  if (x || y) inp.lastDevice = "touch";
}

// The flick of the touch now down on a button, for the ring in the HUD.
export function activeFlicks(inp) {
  return Object.values(inp.touch).filter((e) => e.flick).map((e) => e.flick);
}

// --- Compose one sim frame ------------------------------------------------

export function frameInput(inp, t) {
  // Flick timeouts (flickMaxMs).
  for (const e of Object.values(inp.touch)) {
    if (!e.flick || e.flick.resolved) continue;
    e.flick = flickTick(e.flick, t * 1000, inp.k);
    if (e.flick.resolved) noteResolve(inp, e);
  }
  const flick = { trick: null, spin: null, grind: null };
  const keep = [];
  for (const r of inp.resolves) {
    if (r.at > t + 1e-6) {
      keep.push(r);
      continue;
    }
    flick[r.button] = r.dir;
    if (r.button !== "grind") {
      inp.touchFlickDir = { lastDir: r.dir === "n" ? inp.touchFlickDir.lastDir : r.dir, lastDirAt: r.dir === "n" ? inp.touchFlickDir.lastDirAt : t };
      if (r.dir !== "n") inp.touchHist = [...(inp.touchHist || []), { dir: r.dir, at: t, up: t }].slice(-8);
      const stillDown = Object.values(inp.touch).some((e) => e.button === r.button);
      inp.touchHeld[r.button] = stillDown;
      if (!stillDown) inp.touchPulse[r.button] = true;
    }
  }
  inp.resolves = keep;

  const kb = (a) => actionHeld(inp, a);
  const ps = inp.padState;
  const pb = (i) => (ps ? (ps.buttons[i] ?? 0) > 0.5 : false);
  const ax = ps ? ps.axes[0] ?? 0 : 0;
  const ay = ps ? -(ps.axes[1] ?? 0) : 0;
  const dz = (v) => (Math.abs(v) < PAD.deadzone ? 0 : v);

  const steer = Math.max(-1, Math.min(1, (kb("steerRight") ? 1 : 0) - (kb("steerLeft") ? 1 : 0) + dz(ax) + inp.stick.x));
  const pulse = { ...inp.touchPulse };
  inp.touchPulse = { trick: false, spin: false };

  // The newest direction event of all devices (R2).
  const cands = [
    { lastDir: inp.dirs.lastDir, lastDirAt: inp.dirs.lastDirAt },
    { lastDir: inp.pad.lastDir, lastDirAt: inp.pad.lastDirAt },
    inp.touchFlickDir,
  ];
  const newest = cands.reduce((a, b) => (b.lastDirAt > a.lastDirAt ? b : a));
  const lastDirHeld = newest === cands[0] ? inp.dirs.held.includes(newest.lastDir) : newest === cands[1] ? inp.pad.dir === newest.lastDir : false;
  const kd = heldDir(inp.dirs);
  const dir = kd !== "n" ? kd : inp.pad.dir;
  const balance = Math.max(-1, Math.min(1, (inp.dirs.held.includes("u") ? 1 : 0) - (inp.dirs.held.includes("d") ? 1 : 0) + dz(ay) + inp.stick.y));

  return {
    t,
    steer,
    push: kb("push") || pb(PAD.push) || inp.stick.y > 0.5,
    brake: kb("brake") || pb(PAD.brake) || inp.stick.y < -0.5,
    jump: kb("jump") || pb(PAD.jump) || inp.touchHeld.jump,
    grind: kb("grind") || pb(PAD.grind) || inp.touchHeld.grind,
    trick: kb("style1") || pb(PAD.trick) || inp.touchHeld.trick || pulse.trick,
    spin: kb("style2") || pb(PAD.spin) || inp.touchHeld.spin || pulse.spin,
    dir,
    lastDir: newest.lastDir,
    lastDirAt: newest.lastDirAt,
    lastDirHeld,
    // The recent start events of all devices, oldest first (the axis rule).
    dirHist: [...(inp.dirs.hist || []), ...(inp.pad.hist || []), ...(inp.touchHist || [])].sort((a, b) => a.at - b.at),
    balance,
    flick,
    touchGrind: inp.touchHeld.grind && !kb("grind") && !pb(PAD.grind),
  };
}

// A neutral frame, for tests.
export function blankFrame(t = 0) {
  return { t, steer: 0, push: false, brake: false, jump: false, grind: false, trick: false, spin: false, dir: "n", lastDir: "n", lastDirAt: -Infinity, lastDirHeld: false, dirHist: [], balance: 0, flick: { trick: null, spin: null, grind: null }, touchGrind: false };
}
