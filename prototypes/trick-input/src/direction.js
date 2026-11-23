// Directions and the fresh-direction rule (GDD R2, R3). Pure.
//
// A direction is "n" (neutral), "l", "r", "u", or "d".
// The input layer keeps three fields per frame (GDD, Interactions):
//   dir       the held direction; the newest held key wins
//   lastDir   the newest direction start event (kept after the key is let go)
//   lastDirAt the time of that event (s, sim clock)
// The sim applies R3 with lastDir and lastDirAt only.

import { EPS, TRICK } from "./constants.js";

export const DIRS = ["n", "l", "r", "u", "d"];

// --- Keyboard direction tracker ---------------------------------------

export function createDirTracker() {
  return { held: [], lastDir: "n", lastDirAt: -Infinity };
}

// A direction key goes down at time t. Key repeat (a second down with no up)
// is not a new start event.
export function dirDown(tr, dir, t) {
  if (tr.held.includes(dir)) return tr;
  return { held: [...tr.held, dir], lastDir: dir, lastDirAt: t };
}

export function dirUp(tr, dir) {
  if (!tr.held.includes(dir)) return tr;
  return { ...tr, held: tr.held.filter((d) => d !== dir) };
}

export const heldDir = (tr) => (tr.held.length ? tr.held[tr.held.length - 1] : "n");

// --- Gamepad ------------------------------------------------------------

// The stick direction (R2): 0.5 travel, and the main axis wins (no diagonals).
// `y` is +1 for up here (the caller flips the Gamepad API axis).
export function stickDir(x, y, threshold = TRICK.stickThreshold) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax < threshold - EPS && ay < threshold - EPS) return "n";
  if (ay >= ax) return ay >= threshold - EPS ? (y > 0 ? "u" : "d") : "n";
  return x > 0 ? "r" : "l";
}

// A gamepad start event is a change of the stick (or d-pad) direction to a
// non-neutral direction.
export function createPadTracker() {
  return { dir: "n", lastDir: "n", lastDirAt: -Infinity };
}

export function padUpdate(tr, dir, t) {
  if (dir === tr.dir) return tr;
  if (dir === "n") return { ...tr, dir };
  return { dir, lastDir: dir, lastDirAt: t };
}

// --- R3: the fresh-direction rule ---------------------------------------

// Is the newest direction event fresh for a press at `pressT`?
export function isFresh(lastDir, lastDirAt, pressT, k = TRICK) {
  if (!lastDir || lastDir === "n") return false;
  return lastDirAt >= pressT - k.dirBefore - EPS && lastDirAt <= pressT + EPS;
}

// Call at the press frame. Returns { dir } when the trick starts now, or
// { pending: pressT } when the game must wait up to dirAfter.
export function resolvePress(pressT, lastDir, lastDirAt, k = TRICK) {
  if (isFresh(lastDir, lastDirAt, pressT, k)) return { dir: lastDir, at: pressT };
  if (k.dirAfter <= EPS) return { dir: "n", at: pressT };
  return { pending: pressT };
}

// Call each frame while a press is pending. The first direction that starts
// after the press and inside dirAfter sets the trick; else it is neutral at
// the first frame at or past dirAfter. A frame time is rounded to the nearest
// whole frame (GDD, Acceptance Criteria), so a direction that starts in the
// deadline frame still counts.
export function resolvePending(pending, t, lastDir, lastDirAt, k = TRICK) {
  const p = pending.pending;
  if (lastDir && lastDir !== "n" && lastDirAt > p + EPS && lastDirAt <= t + EPS) return { dir: lastDir, at: t };
  if (t >= p + k.dirAfter - EPS) return { dir: "n", at: t };
  return pending;
}
