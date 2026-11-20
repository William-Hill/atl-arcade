// Landmark discovery in play (#219): the pure glue between the game loop and
// the landmark module (src/sim/landmarks.js). No DOM, no Three.js.
//
// Design: design/gdd/landmark-discovery.md (Core Rules 2 to 5 and 7, Edge
// Cases). The rules of the challenges are in the landmark module; this file
// only says when a step runs, and what the HUD goal line reads.

import { LANDMARKS, landmarkObs } from "../sim/landmarks.js";

export const CLAIM_PREFIX = "Claim it: ";
// A free run (?run=free) has no results screen and no medals, so it has no
// claims: the hint asks for a timed run.
export const FREE_RUN_HINT = "Start a timed run to claim it";
// The goal line after a return to ring 1 restarts a line (#269).
export const LINE_RESTART = "Ring line restarted";

// The arguments of one landmark step, from the run after stepRun.
// - `timed` is true when the level runs with a run timer (a goal list).
//   `goals` is its goal state. The timer starts on the first tick of the
//   run, so the find checks start there; they stop when the run ends (the
//   overtime is part of the run).
// - A free run finds spots from its first tick and never claims: its
//   observation is a travel step on every tick, and the landmark module
//   ignores a travel step in every challenge.
// - `teleported` is true on the first tick after "Travel here".
export function landmarkStepArgs(run, { timed = true, goals = null, teleported = false } = {}) {
  if (!timed) return { obs: landmarkObs(run, { teleported: true }), active: true };
  return { obs: landmarkObs(run, { teleported }), active: Boolean(goals) && !goals.ended };
}

// The goal state with the gap goal `id` cleared in this run. A `gap` claim
// at the zone of a gap goal marks that goal (GDD, Interactions). The goal
// module clears it by the same rule on the same tick, so this changes the
// state only when the two rules differ (a goal with a `from` list).
export function withGapGoal(goals, id, def) {
  if (!goals || !id || goals.ended) return goals;
  if (!(def?.goals ?? []).some((g) => g.id === id && g.type === "gap")) return goals;
  if (goals.gaps.includes(id)) return goals;
  return { ...goals, gaps: [...goals.gaps, id], justCleared: [...goals.justCleared, id] };
}

const MEDALS = ["gold", "silver", "bronze"];

// The results with the medal from the medal total (banked score + the claim
// points of the run). The score and the score goal keep the banked score, so
// the results hold 2 totals: `score` and `medalScore`.
export function withClaimMedal(results, medals = {}, claimSum = 0) {
  const total = results.score + claimSum;
  const medal = MEDALS.find((m) => medals[m] !== undefined && total >= medals[m]) ?? null;
  const next = [...MEDALS].reverse().find((m) => medals[m] !== undefined && total < medals[m]) ?? null;
  return { ...results, claimPoints: claimSum, medalScore: total, medal, next: next ? { medal: next, score: medals[next] } : null };
}

// The point a player rides to for a challenge: the zone center, or the
// first checkpoint of a line that has not started (the next one after that).
function targetOf(spot) {
  const c = spot.challenge;
  if (c.type === "line") return c.checkpoints[Math.min(spot.attempt ? spot.attempt.next : 0, c.checkpoints.length - 1)];
  return [c.zone.x, c.zone.z];
}

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

// The HUD goal line: the challenge of the nearest Found spot, or null when
// no claim spot is Found. `view` is landmarkView(); `position` is the
// skater's [x, y, z]. A line in progress shows the next ring and the time
// left. Returns { id, text }.
export function goalLine(view, position, { timed = true } = {}) {
  let best = null;
  for (const s of view.spots) {
    if (!s.ring) continue;
    const [x, z] = targetOf(s);
    const d = Math.hypot(x - position[0], z - position[2]);
    if (!best || d < best.d) best = { s, d };
  }
  if (!best) return null;
  const { s } = best;
  if (!timed) return { id: s.id, text: FREE_RUN_HINT };
  const c = s.challenge;
  if (c.type === "line" && s.attempt) {
    const left = Math.max(0, Math.ceil(c.seconds - s.attempt.t - 1e-9));
    const ring = `Ring ${s.attempt.next + 1} of ${c.checkpoints.length}: ${left} s left`;
    const restarted = s.attempt.restarted && s.attempt.t < LANDMARKS.lineRestartShow;
    return { id: s.id, text: restarted ? `${LINE_RESTART}\n${ring}` : ring };
  }
  return { id: s.id, text: `${CLAIM_PREFIX}${lowerFirst(s.hint)}` };
}
