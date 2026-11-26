// The manual: balance and points (docs/gdd/trick-input.md R8, F1, F2). Pure.

import { TRICK } from "./constants.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// F1: m_next = clamp(m + dt * (side * d + g * m - c * s), -1, 1).
// `side` is the drift side (-1 or +1), `s` the balance input (+1 is up).
export function manualStep(m, side, s, dt, k = TRICK) {
  const input = clamp(Number.isFinite(s) ? s : 0, -1, 1);
  return clamp(m + dt * (side * k.manualDrift + k.manualGravity * m - k.manualCorrect * input), -1, 1);
}

// F2: manualBase (+ toeRollBonus) + manualPerMeter * min(meters, manualCapMeters).
export function manualPoints(meters, toe = false, k = TRICK) {
  return Math.round(k.manualBase + (toe ? k.toeRollBonus : 0) + k.manualPerMeter * Math.min(Math.max(0, meters), k.manualCapMeters));
}

// A balance out: |m| at the limit ends the manual in a stumble (R10).
export const manualOut = (m) => Math.abs(m) >= 1 - 1e-9;
