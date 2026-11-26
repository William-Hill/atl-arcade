// Trick directions and the fresh direction rule (docs/gdd/trick-input.md,
// R2, R3, R3a, Interactions). Pure: no DOM, no clock of its own.
//
// A direction is "n" (neutral), "l", "r", "u", or "d".
//
// The input frame gives the sim these fields (the input-side contract):
//   dir         the held direction now; the newest held key wins, else the
//               gamepad direction, else "n".
//   lastDir     the direction of the newest start event of all devices. It
//               stays after the key is let go.
//   lastDirAt   the time of that event, in s on the sim clock (-Infinity if none).
//   lastDirHeld true while the key or the stick of lastDir is still down.
//   dirHist     the recent start events of all devices, oldest first:
//               { dir, at, up } with `up` the release time, or null while held.
//   balance     -1..1, +1 is up (GDD F1 input s).
//
// The sim applies the rule with resolvePress() at the press frame and with
// resolvePending() on each later frame until the press resolves. The rule
// reads `dirHist`; with the axis rule off (R3 only) it gives the same result
// as a rule on `lastDir` and `lastDirAt` alone.

import { EPS, TRICK_INPUT } from "./trick-constants.js";

export const DIRS = Object.freeze(["n", "l", "r", "u", "d"]);

const HIST_MAX = 8;
const isLR = (d) => d === "l" || d === "r";
const isDir = (d) => d === "l" || d === "r" || d === "u" || d === "d";

function addEvent(hist, e) {
  const out = [...hist, e];
  return out.length > HIST_MAX ? out.slice(out.length - HIST_MAX) : out;
}

// Marks the newest open event of `dir` as let go at time t.
function closeEvent(hist, dir, t) {
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    if (hist[i].dir === dir && hist[i].up == null) {
      const out = [...hist];
      out[i] = { ...hist[i], up: t };
      return out;
    }
  }
  return hist;
}

// --- Keyboard ---------------------------------------------------------------
// The tracker holds the held directions in the order they went down.

export function createKeyDirs() {
  return { held: [], lastDir: "n", lastDirAt: -Infinity, hist: [] };
}

// A direction action goes down at time t. A second down with no up (key
// repeat, or a second key of the same action) is not a new start event.
export function keyDirDown(tr, dir, t) {
  if (!isDir(dir) || tr.held.includes(dir)) return tr;
  return { held: [...tr.held, dir], lastDir: dir, lastDirAt: t, hist: addEvent(tr.hist, { dir, at: t, up: null }) };
}

// A direction action is let go at time t (no key of the action is down now).
export function keyDirUp(tr, dir, t) {
  if (!tr.held.includes(dir)) return tr;
  return { ...tr, held: tr.held.filter((d) => d !== dir), hist: closeEvent(tr.hist, dir, t) };
}

// All keys are let go (window blur, a menu opens).
export function keyDirsClear(tr, t) {
  return tr.held.reduce((acc, d) => keyDirUp(acc, d, t), tr);
}

// The newest held direction, or "n".
export const keyHeldDir = (tr) => (tr.held.length ? tr.held[tr.held.length - 1] : "n");

// The keyboard balance: +1 while up is held, -1 while down is held, the
// newest key wins, else 0.
export function keyBalance(tr) {
  for (let i = tr.held.length - 1; i >= 0; i -= 1) {
    if (tr.held[i] === "u") return 1;
    if (tr.held[i] === "d") return -1;
  }
  return 0;
}

// --- Gamepad ----------------------------------------------------------------

// The stick direction (R2): `threshold` travel on the main axis, no
// diagonals; on a tie the up or down wins. `y` is +1 for up (the caller
// changes the sign of the Gamepad API axis). Raw values, not the deadzone
// rescale.
export function stickDir(x, y, threshold = TRICK_INPUT.stickThreshold) {
  const ax = Math.abs(x || 0);
  const ay = Math.abs(y || 0);
  if (Math.max(ax, ay) < threshold - EPS) return "n";
  if (ay >= ax) return y > 0 ? "u" : "d";
  return x > 0 ? "r" : "l";
}

export function createPadDirs() {
  return { dir: "n", lastDir: "n", lastDirAt: -Infinity, hist: [] };
}

// The gamepad direction at time t. A start event is a change to a new
// direction that is not neutral (a stick crossing on a new axis side, or a
// d-pad press).
export function padDirUpdate(tr, dir, t) {
  if (dir === tr.dir) return tr;
  const hist = tr.dir !== "n" ? closeEvent(tr.hist, tr.dir, t) : tr.hist;
  if (!isDir(dir)) return { ...tr, dir: "n", hist };
  return { dir, lastDir: dir, lastDirAt: t, hist: addEvent(hist, { dir, at: t, up: null }) };
}

// --- All devices ------------------------------------------------------------

// The direction fields of one input frame from the device trackers. `others`
// are more trackers with { lastDir, lastDirAt, hist } (for example touch).
export function dirFields(keys, pad, others = []) {
  const kd = keyHeldDir(keys);
  const dir = kd !== "n" ? kd : pad.dir;
  let lastDir = keys.lastDir;
  let lastDirAt = keys.lastDirAt;
  let lastDirHeld = keys.lastDirAt > -Infinity && keys.held.includes(keys.lastDir);
  if (pad.lastDirAt > lastDirAt) {
    lastDir = pad.lastDir;
    lastDirAt = pad.lastDirAt;
    lastDirHeld = pad.dir === pad.lastDir;
  }
  for (const o of others) {
    if (o.lastDirAt > lastDirAt) {
      lastDir = o.lastDir;
      lastDirAt = o.lastDirAt;
      lastDirHeld = Boolean(o.held);
    }
  }
  const dirHist = [...keys.hist, ...pad.hist, ...others.flatMap((o) => o.hist || [])].sort((a, b) => a.at - b.at);
  return { dir, lastDir, lastDirAt, lastDirHeld, dirHist };
}

// --- R3 and R3a: the fresh direction rule -------------------------------------

// R3: a start time inside the window [pressT - dirBefore, pressT].
export const inWindow = (at, pressT, k = TRICK_INPUT) => at >= pressT - k.dirBefore - EPS && at <= pressT + EPS;

const heldAt = (e, t) => e.up == null || e.up > t + EPS;

// Is the start event `e` fresh for a press at `pressT`? With the axis rule
// (R3a.1), an up or down still held at the press also counts when it started
// inside `udHold`.
export function isFreshEvent(e, pressT, k = TRICK_INPUT) {
  if (!e || !isDir(e.dir) || e.at > pressT + EPS) return false;
  if (k.axisRule && !isLR(e.dir) && heldAt(e, pressT) && k.udHold != null && e.at >= pressT - k.udHold - EPS) return true;
  return inWindow(e.at, pressT, k);
}

// The fresh direction for a press at `pressT`, or "n".
// R3 only: the newest start event at or before the press, if it is in the window.
// R3a: of the fresh events, an up or down wins over a left or right
// (udFirst); on one axis the later event wins.
export function freshDir(hist, pressT, k = TRICK_INPUT) {
  const before = (hist || []).filter((e) => isDir(e.dir) && e.at <= pressT + EPS);
  if (!before.length) return "n";
  if (!k.axisRule) {
    const newest = before.reduce((a, b) => (b.at >= a.at ? b : a));
    return inWindow(newest.at, pressT, k) ? newest.dir : "n";
  }
  const fresh = before.filter((e) => isFreshEvent(e, pressT, k));
  if (!fresh.length) return "n";
  const pool = k.udFirst && fresh.some((e) => !isLR(e.dir)) ? fresh.filter((e) => !isLR(e.dir)) : fresh;
  return pool.reduce((a, b) => (b.at >= a.at ? b : a)).dir;
}

// Call at the press frame. Returns { dir, at } when the trick starts now, or
// { pending: pressT } when the sim must wait up to dirAfter.
export function resolvePress(pressT, hist, k = TRICK_INPUT) {
  const dir = freshDir(hist, pressT, k);
  if (dir !== "n") return { dir, at: pressT };
  if (k.dirAfter <= EPS) return { dir: "n", at: pressT };
  return { pending: pressT };
}

// Call on each frame at time t while a press is pending. The first direction
// that starts after the press sets the trick; a direction that starts in the
// deadline frame still counts (the frame times round to whole frames). Else
// the trick is neutral at the first frame at or past dirAfter.
export function resolvePending(pending, t, hist, k = TRICK_INPUT) {
  if (!pending || pending.pending == null) return pending;
  const p = pending.pending;
  const after = (hist || []).filter((e) => isDir(e.dir) && e.at > p + EPS && e.at <= t + EPS);
  if (after.length) {
    const first = Math.min(...after.map((e) => e.at));
    let group = after.filter((e) => e.at <= first + EPS);
    if (k.axisRule && k.udFirst && group.some((e) => !isLR(e.dir))) group = group.filter((e) => !isLR(e.dir));
    return { dir: group[group.length - 1].dir, at: t };
  }
  if (t >= p + k.dirAfter - EPS) return { dir: "n", at: t };
  return pending;
}

// The direction of a press on this frame, for every device: a touch flick
// that resolved on this frame gives its direction at once (the R3 window
// does not apply to a flick, R11); else the R3 rule. `button` is "style1",
// "style2", or "grind". Returns the same shapes as resolvePress().
export function resolveFramePress(frame, button, k = TRICK_INPUT) {
  const f = frame.flick && frame.flick[button];
  if (f != null) return { dir: f, at: frame.t };
  return resolvePress(frame.t, frame.dirHist, k);
}
