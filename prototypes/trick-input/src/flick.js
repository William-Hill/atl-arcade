// Touch flick from a trick button (GDD R11). Pure.
//
// A tap gives the neutral trick. A drag of flickMin px or more gives the
// direction of its main axis. The trick starts when the drag crosses flickMin,
// when the finger lifts before that (a tap), or at flickMaxMs after the touch.
// Screen y grows down, so a drag with negative dy is "u".

import { TRICK } from "./constants.js";

export function createFlick(button, x, y, tMs) {
  return { button, x0: x, y0: y, t0: tMs, x, y, resolved: null };
}

export function flickDirOf(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "r" : "l";
  return dy < 0 ? "u" : "d";
}

export function flickMove(f, x, y, tMs, k = TRICK) {
  const g = { ...f, x, y };
  if (f.resolved) return g;
  const dx = x - f.x0;
  const dy = y - f.y0;
  if (Math.hypot(dx, dy) >= k.flickMin) g.resolved = { dir: flickDirOf(dx, dy), atMs: tMs, by: "drag" };
  return g;
}

export function flickUp(f, tMs) {
  if (f.resolved) return f;
  return { ...f, resolved: { dir: "n", atMs: tMs, by: "tap" } };
}

export function flickTick(f, tMs, k = TRICK) {
  if (f.resolved) return f;
  if (tMs - f.t0 >= k.flickMaxMs) return { ...f, resolved: { dir: "n", atMs: f.t0 + k.flickMaxMs, by: "timeout" } };
  return f;
}
