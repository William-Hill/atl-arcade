// Touch flick from a trick button (docs/gdd/trick-input.md, R6, R11). Pure.
//
// The touch buttons TRICK (style1), SPIN (style2), and GRIND each take a
// flick. A tap gives the neutral trick. A drag of `flickMin` px or more gives
// the direction of its main axis. The flick resolves when the drag crosses
// `flickMin`, when the finger lifts before that (a tap), or at `flickMaxMs`
// after the touch-down (neutral). The R3 window does not apply to a flick.
//
// The touch layer gives the sim:
// - TRICK and SPIN: the press comes at the resolve frame. A tap is a press of
//   one frame; a flick or a timeout holds the press until the finger lifts.
// - GRIND: the press comes at the touch-down, so the snap buffer starts at
//   once. The stance comes at the resolve frame (`flick.grind`).
// - `flick`: { style1, style2, grind }, the direction on the resolve frame of
//   that button, else null.
// - `grindFlick`: true while a GRIND touch is down and not resolved yet.
// - A start event { dir, at, up } in the direction history for a flick that
//   is not neutral, at the resolve frame (Interactions).
//
// Times are ms. Screen y grows down, so a drag with a negative dy is "u".

import { TRICK_INPUT } from "./trick-constants.js";

export const FLICK_BUTTONS = Object.freeze(["style1", "style2", "grind"]);

export function flickDirOf(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "r" : "l";
  return dy < 0 ? "u" : "d";
}

export function createFlick(button, x, y, tMs) {
  return { button, x0: x, y0: y, t0: tMs, x, y, resolved: null };
}

// The finger moves. A drag of flickMin px or more resolves the flick.
export function flickMove(f, x, y, tMs, k = TRICK_INPUT) {
  if (f.resolved) return { ...f, x, y };
  const dx = x - f.x0;
  const dy = y - f.y0;
  const g = { ...f, x, y };
  if (Math.hypot(dx, dy) >= k.flickMin) g.resolved = { dir: flickDirOf(dx, dy), atMs: tMs, by: "drag" };
  return g;
}

// The finger lifts before the flick resolved: a tap, neutral.
export function flickLift(f, tMs) {
  if (f.resolved) return f;
  return { ...f, resolved: { dir: "n", atMs: tMs, by: "tap" } };
}

// The time goes on: at flickMaxMs the flick resolves neutral. `slackMs` is
// half a frame, so a time rounds to the nearest whole frame (GDD,
// Acceptance Criteria).
export function flickTick(f, tMs, k = TRICK_INPUT, slackMs = 0) {
  if (f.resolved) return f;
  if (tMs - f.t0 >= k.flickMaxMs - slackMs) return { ...f, resolved: { dir: "n", atMs: tMs, by: "timeout" } };
  return f;
}

// The drag of a flick in px, for the ring (0 at rest).
export function flickDrag(f) {
  return { dx: f.x - f.x0, dy: f.y - f.y0 };
}

// --- The touch trick state: the pointers on the 3 flick buttons -------------
//
// Events go in with times in ms; frame() gives the fields of one input frame
// at time tMs and the next state. The DOM layer (src/input/touch.js) calls
// the event functions at the sample time, so every time is a frame time.

export function createTouchTricks() {
  return {
    pointers: {}, // pointerId -> flick
    held: { style1: false, style2: false }, // a resolved press still down
    pulse: { style1: false, style2: false }, // a tap: a press of one frame
    grindDown: new Set(), // pointerIds on GRIND (the press is at the touch-down)
    resolves: [], // { button, dir, atMs } not given to a frame yet
    lastDir: "n",
    lastDirAt: -Infinity,
    hist: [],
  };
}

function noteResolve(st, f) {
  return { ...st, resolves: [...st.resolves, { button: f.button, dir: f.resolved.dir, atMs: f.resolved.atMs }] };
}

export function touchTrickDown(st, button, id, x, y, tMs) {
  if (!FLICK_BUTTONS.includes(button)) return st;
  const pointers = { ...st.pointers, [id]: createFlick(button, x, y, tMs) };
  const grindDown = new Set(st.grindDown);
  if (button === "grind") grindDown.add(id);
  return { ...st, pointers, grindDown };
}

export function touchTrickMove(st, id, x, y, tMs, k = TRICK_INPUT) {
  const f = st.pointers[id];
  if (!f) return st;
  const g = flickMove(f, x, y, tMs, k);
  const next = { ...st, pointers: { ...st.pointers, [id]: g } };
  return !f.resolved && g.resolved ? noteResolve(next, g) : next;
}

export function touchTrickUp(st, id, tMs) {
  const f = st.pointers[id];
  if (!f) return st;
  const pointers = { ...st.pointers };
  delete pointers[id];
  const grindDown = new Set(st.grindDown);
  grindDown.delete(id);
  let next = { ...st, pointers, grindDown };
  if (!f.resolved) next = noteResolve(next, flickLift(f, tMs));
  return next;
}

// One input frame at tMs. Returns { state, out } with out:
// { style1, style2, grind, grindFlick, flick: { style1, style2, grind } }.
export function touchTricksFrame(st, tMs, k = TRICK_INPUT, slackMs = 0) {
  let s = st;
  // Timeouts (flickMaxMs).
  for (const [id, f] of Object.entries(s.pointers)) {
    if (f.resolved) continue;
    const g = flickTick(f, tMs, k, slackMs);
    if (g.resolved) s = noteResolve({ ...s, pointers: { ...s.pointers, [id]: g } }, g);
  }
  const flick = { style1: null, style2: null, grind: null };
  const held = { ...s.held };
  const pulse = { style1: false, style2: false };
  let { lastDir, lastDirAt, hist } = s;
  for (const r of s.resolves) {
    flick[r.button] = r.dir;
    if (r.dir !== "n") {
      lastDir = r.dir;
      lastDirAt = tMs / 1000;
      hist = [...hist, { dir: r.dir, at: tMs / 1000, up: tMs / 1000 }].slice(-8);
    }
    if (r.button === "grind") continue;
    const stillDown = Object.values(s.pointers).some((f) => f.button === r.button && f.resolved);
    held[r.button] = stillDown;
    if (!stillDown) pulse[r.button] = true;
  }
  // A held press ends when no resolved pointer of the button is down.
  for (const b of ["style1", "style2"]) {
    if (held[b] && !Object.values(s.pointers).some((f) => f.button === b && f.resolved)) held[b] = false;
  }
  const grindFlick = Object.values(s.pointers).some((f) => f.button === "grind" && !f.resolved);
  const out = {
    style1: held.style1 || pulse.style1,
    style2: held.style2 || pulse.style2,
    grind: s.grindDown.size > 0 || flick.grind != null,
    grindFlick,
    flick,
  };
  return { state: { ...s, held, pulse, resolves: [], lastDir, lastDirAt, hist }, out };
}

// The flicks of the pointers that are down now, for the ring in the HUD.
export function activeFlicks(st) {
  return Object.values(st.pointers);
}
