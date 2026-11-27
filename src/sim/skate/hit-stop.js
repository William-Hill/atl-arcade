// The PERFECT hit stop (#338, docs/ux/trick-hud.md 6.4). Pure.
//
// At a PERFECT link the sim and the skater stop for `perfectHitStopMs` of
// wall time. The HUD keeps its frame rate and its wall clock times, so a tag
// does not show longer or shorter. A stumble has no beat tag (F6), so it
// never starts a hit stop. 0 turns the hit stop off.

import { COMBO } from "./constants.js";

// The ms of hit stop that the moves of one tick start: perfectHitStopMs when
// one of them is a PERFECT link, else 0.
export function hitStopFor(moves, k = COMBO) {
  const ms = Math.max(0, k.perfectHitStopMs ?? 0);
  if (!ms || !moves) return 0;
  return moves.some((m) => m.beatTag === "PERFECT" && m.landing !== "stumble") ? ms : 0;
}

// One frame of wall time `elapsedMs` with `leftMs` of hit stop to go.
// Returns { left, simMs }: the hit stop that is left, and the wall time that
// the sim may step on this frame (the part after the hit stop ends).
export function stepHitStop(leftMs, elapsedMs) {
  const left = Math.max(0, leftMs || 0);
  const e = Math.max(0, elapsedMs || 0);
  if (left <= 0) return { left: 0, simMs: e };
  if (e <= left) return { left: left - e, simMs: 0 };
  return { left: 0, simMs: e - left };
}

// A new hit stop does not add to one that runs: the longer one wins.
export const startHitStop = (leftMs, ms) => Math.max(Math.max(0, leftMs || 0), Math.max(0, ms || 0));
