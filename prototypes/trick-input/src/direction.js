// Directions and the fresh-direction rule (GDD R2, R3). Pure.
//
// A direction is "n" (neutral), "l", "r", "u", or "d".
// The input layer keeps three fields per frame (GDD, Interactions):
//   dir       the held direction; the newest held key wins
//   lastDir   the newest direction start event (kept after the key is let go)
//   lastDirAt the time of that event (s, sim clock)
// The sim applies R3 with lastDir and lastDirAt only. With the axis rule on
// (#326 fix, `axisRule`), the trackers also keep `hist`, the recent start
// events { dir, at, up } (`up` is the release time, or null while held), and
// the sim reads them through freshDir().

import { EPS, TRICK } from "./constants.js";

export const DIRS = ["n", "l", "r", "u", "d"];

// --- Keyboard direction tracker ---------------------------------------

const HIST_MAX = 8;
const pushHist = (hist, e) => [...hist, e].slice(-HIST_MAX);
// Mark the newest open event of `dir` as let go at t.
const closeHist = (hist, dir, t) => {
  const i = hist.map((e) => e.dir === dir && e.up == null).lastIndexOf(true);
  if (i < 0) return hist;
  const out = [...hist];
  out[i] = { ...out[i], up: t };
  return out;
};

export function createDirTracker() {
  return { held: [], lastDir: "n", lastDirAt: -Infinity, hist: [] };
}

// A direction key goes down at time t. Key repeat (a second down with no up)
// is not a new start event.
export function dirDown(tr, dir, t) {
  if (tr.held.includes(dir)) return tr;
  return { held: [...tr.held, dir], lastDir: dir, lastDirAt: t, hist: pushHist(tr.hist || [], { dir, at: t, up: null }) };
}

// `t` (s, sim clock) is required: the axis rule reads the release time.
export function dirUp(tr, dir, t) {
  if (!Number.isFinite(t)) throw new Error("dirUp needs the release time t");
  if (!tr.held.includes(dir)) return tr;
  return { ...tr, held: tr.held.filter((d) => d !== dir), hist: closeHist(tr.hist || [], dir, t) };
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
  return { dir: "n", lastDir: "n", lastDirAt: -Infinity, hist: [] };
}

export function padUpdate(tr, dir, t) {
  if (dir === tr.dir) return tr;
  const hist = tr.dir !== "n" ? closeHist(tr.hist || [], tr.dir, t) : tr.hist || [];
  if (dir === "n") return { ...tr, dir, hist };
  return { dir, lastDir: dir, lastDirAt: t, hist: pushHist(hist, { dir, at: t, up: null }) };
}

// --- R3: the fresh-direction rule ---------------------------------------

// Is the newest direction event fresh for a press at `pressT`?
// `held` is true when the key (or stick) of lastDir is still down. With the
// carveGuard toggle on, a held left or right that started more than
// carveGuard before the press is a carve, so it does not count.
export function isFresh(lastDir, lastDirAt, pressT, k = TRICK, held = false) {
  if (!lastDir || lastDir === "n") return false;
  if (k.carveGuard != null && held && (lastDir === "l" || lastDir === "r") && pressT - lastDirAt > k.carveGuard + EPS) return false;
  return lastDirAt >= pressT - k.dirBefore - EPS && lastDirAt <= pressT + EPS;
}

// Call at the press frame. Returns { dir } when the trick starts now, or
// { pending: pressT } when the game must wait up to dirAfter.
export function resolvePress(pressT, lastDir, lastDirAt, k = TRICK, held = false) {
  if (isFresh(lastDir, lastDirAt, pressT, k, held)) return { dir: lastDir, at: pressT };
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

// --- The axis rule (#326 fix for the keyboard misses) ---------------------
//
// Off when k.axisRule is false: the sim then uses the rule above (the newest
// event only). On, the sim reads the recent start events (`hist`):
//   1. Up/down hold: an up or down that is still held at the press counts if
//      it started inside `udHold` (longer than dirBefore). A held W to push
//      started long before, so it still does not count.
//   2. Up/down first: when an up/down and a left/right are both fresh at the
//      press, the up/down wins. Left and right are also the steer keys, so a
//      carve that starts near the press does not take the trick from an
//      intended up or down.
// Left and right keep the R3 window (and the carve guard, if on).

const isLR = (d) => d === "l" || d === "r";
const heldAt = (e, t) => e.up == null || e.up > t + EPS;

// Is the start event `e` fresh for a press at `pressT` with the axis rule?
export function freshEvent(e, pressT, k = TRICK) {
  if (!e || !e.dir || e.dir === "n") return false;
  if (e.at > pressT + EPS) return false;
  const held = heldAt(e, pressT);
  if (isLR(e.dir) && k.lrBefore != null) return isFresh(e.dir, e.at, pressT, { ...k, dirBefore: k.lrBefore }, held);
  if (!isLR(e.dir) && held && k.udHold != null && e.at >= pressT - k.udHold - EPS) return true;
  return isFresh(e.dir, e.at, pressT, k, held);
}

// The direction for a press at `pressT` from the history, or "n".
export function freshDir(hist, pressT, k = TRICK) {
  const fresh = (hist || []).filter((e) => freshEvent(e, pressT, k));
  if (!fresh.length) return "n";
  const pool = k.udFirst && fresh.some((e) => !isLR(e.dir)) ? fresh.filter((e) => !isLR(e.dir)) : fresh;
  return pool.reduce((a, b) => (b.at >= a.at ? b : a)).dir;
}

// R3 with the axis rule. With udHold null, udFirst false, and lrBefore and
// lrAfter null, it gives the same results as resolvePress and
// resolvePending.
export function resolvePressHist(pressT, hist, k = TRICK) {
  const dir = freshDir(hist, pressT, k);
  if (dir !== "n") return { dir, at: pressT };
  if (k.dirAfter <= EPS) return { dir: "n", at: pressT };
  return { pending: pressT };
}

export function resolvePendingHist(pending, t, hist, k = TRICK) {
  const p = pending.pending;
  // A left/right after the press counts up to lrAfter (when set); else every
  // start event up to the frame that resolves the press counts (R3).
  const lrCap = k.lrAfter != null ? p + k.lrAfter + EPS : Infinity;
  const after = (hist || []).filter((e) => e.dir !== "n" && e.at > p + EPS && e.at <= t + EPS && (!isLR(e.dir) || e.at <= lrCap));
  if (after.length) return { dir: after.reduce((a, b) => (b.at >= a.at ? b : a)).dir, at: t };
  if (t >= p + k.dirAfter - EPS) return { dir: "n", at: t };
  return pending;
}
