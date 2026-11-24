// Manual balance and points (GDD F1, F2). Pure.

import { TRICK } from "./constants.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// F1: m_next = clamp(m + dt * (side * d + g * m - c * s), -1, 1)
// side is -1 or +1; s is the balance input, +1 is up (W).
// The drift pushes the lean toward `side`. Up (W) moves the lean toward -1
// and down (S) toward +1, so the player pushes against the marker.
export function manualStep(m, side, s, dt, k = TRICK) {
  return clamp(m + dt * (side * k.manualDrift + k.manualGravity * m - k.manualCorrect * s), -1, 1);
}

// F2.
export function manualPoints(meters, toe = false, k = TRICK) {
  return Math.round(k.manualBase + (toe ? k.toeRollBonus : 0) + k.manualPerMeter * Math.min(Math.max(0, meters), k.manualCapMeters));
}

export const manualOut = (m) => Math.abs(m) >= 1;
