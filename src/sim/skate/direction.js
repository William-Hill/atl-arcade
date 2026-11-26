// The fresh direction of a trick press (docs/gdd/trick-input.md R2, R3, R3a).
// Pure. A direction is "n" (neutral), "l", "r", "u", or "d".
//
// The input layer (src/input/, #328, #341) sends these fields per frame, on
// the sim clock (`skater.time`, s):
//   dir        the held direction (the newest key wins)
//   lastDir    the newest direction start event, kept after the key is let go
//   lastDirAt  the time of that event
//   dirHist    the recent start events { dir, at, up } of all devices (`up` is
//              the release time, or null while the key is down). Needed for
//              the axis rule (R3a).
//   flick      { style1, style2, grind }: the touch flick direction of a
//              press (R11). A flick wins over R3.
// With no `dirHist`, the sim makes a history of one event from `lastDir`,
// `lastDirAt`, and `dir`.

import { TRICK } from "./constants.js";

export const DIRS = ["n", "l", "r", "u", "d"];
const EPS = 1e-6; // float slack for frame time compares

const isLR = (d) => d === "l" || d === "r";
const heldAt = (e, t) => e.up == null || e.up > t + EPS;

// The start events of a frame input.
export function dirHistory(input = {}) {
  if (Array.isArray(input.dirHist)) return input.dirHist;
  const d = input.lastDir;
  if (!d || d === "n" || !Number.isFinite(input.lastDirAt)) return [];
  return [{ dir: d, at: input.lastDirAt, up: input.dir === d ? null : input.lastDirAt }];
}

// R3: a start event is fresh if it started from dirBefore before the press up
// to the press. R3a: an up or down still held at the press is fresh if it
// started inside udHold.
export function isFreshEvent(e, pressT, k = TRICK) {
  if (!e || !e.dir || e.dir === "n") return false;
  if (e.at > pressT + EPS) return false;
  if (k.axisRule && !isLR(e.dir) && heldAt(e, pressT) && e.at >= pressT - k.udHold - EPS) return true;
  return e.at >= pressT - k.dirBefore - EPS;
}

// The fresh direction at a press, or "n". Two fresh directions: the later one
// wins (R3); with the axis rule, an up or down wins over a left or right (R3a).
export function freshDir(hist, pressT, k = TRICK) {
  const fresh = (hist ?? []).filter((e) => isFreshEvent(e, pressT, k));
  if (!fresh.length) return "n";
  const pool = k.axisRule && k.udFirst && fresh.some((e) => !isLR(e.dir)) ? fresh.filter((e) => !isLR(e.dir)) : fresh;
  return pool.reduce((a, b) => (b.at >= a.at ? b : a)).dir;
}

// R3 at the press frame. Returns { dir } when the trick starts now, or
// { pending: pressT } when the game must wait up to dirAfter. `button` names
// the flick field of a touch press.
export function resolvePress(pressT, input = {}, button = null, k = TRICK) {
  const flick = button && input.flick ? input.flick[button] : null;
  if (flick && DIRS.includes(flick)) return { dir: flick };
  const dir = freshDir(dirHistory(input), pressT, k);
  if (dir !== "n" || k.dirAfter <= EPS) return { dir };
  return { pending: pressT };
}

// R3 on each frame while a press waits. The first direction that starts after
// the press sets the trick; else it is neutral at the first frame at or past
// dirAfter.
export function resolvePending(pending, t, input = {}, button = null, k = TRICK) {
  const flick = button && input.flick ? input.flick[button] : null;
  if (flick && DIRS.includes(flick)) return { dir: flick };
  const p = pending.pending;
  const after = dirHistory(input).filter((e) => e.dir && e.dir !== "n" && e.at > p + EPS && e.at <= t + EPS);
  if (after.length) return { dir: after.reduce((a, b) => (b.at < a.at ? b : a)).dir };
  if (t >= p + k.dirAfter - EPS) return { dir: "n" };
  return pending;
}
