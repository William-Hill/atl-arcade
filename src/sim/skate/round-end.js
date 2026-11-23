// The soft end of a timed round (#260). Pure: no DOM, no Three.js.
//
// The goal module (goals.js) ends a run when the time is out and no combo
// is open, or when the overtime ends. Before #260 the results screen showed
// on that tick, and the input stopped with no message. Now:
// - "overtime": the time is out and a combo is open. The HUD says to land
//   the combo, with the overtime seconds left.
// - "stopping": the run ended. The input is off and the skater rolls on.
//   The HUD says why, for ROUND_END.hold s of sim time.
// - "results": the results screen shows.

export const ROUND_END = {
  hold: 1.5, // s of sim time between the end of the run and the results screen. min 0.8 / typical 1.5 / max 2.5.
};

export const OVERTIME_TEXT = "Time! Land the combo to bank it";
export const STOPPING_TEXT = "Time! The round is over";

// `goals` is the goal state, or null (no timer). `endedFor` is the sim time
// since the run ended.
export function roundPhase(goals, { endedFor = 0 } = {}, k = ROUND_END) {
  if (!goals) return "none";
  if (goals.ended) return endedFor >= k.hold - 1e-9 ? "results" : "stopping";
  if (goals.timeLeft <= 0) return "overtime";
  return "play";
}

// The HUD line of a phase, or null. `def` is the goal definition (its
// `overtime` in s).
export function roundStatus(phase, goals, def = {}) {
  if (phase === "overtime") {
    const limit = (def.time ?? 0) + (def.overtime ?? 10);
    const left = Math.max(0, Math.ceil(limit - goals.time - 1e-9));
    return `${OVERTIME_TEXT}: ${left} s`;
  }
  if (phase === "stopping") return STOPPING_TEXT;
  return null;
}
