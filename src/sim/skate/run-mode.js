// The run modes of a level (#260). Pure: no DOM, no Three.js.
//
// - "timed": the round of M1-05. A 2:30 timer, the goal list, the results
//   screen and the medals. Landmark spots are found and claimed.
// - "tour": the landmark loop with no timer (#260). Spots are found and
//   claimed, with the rings and the HUD goal line. No goal list, no results
//   screen and no medal, so a claim has no run cap.
// - "free": free skate (?run=free). No timer, no claims (GDD Edge Cases).
//
// The address picks the mode: ?run=tour, ?run=free, or no `run` for timed.
// A level with no goal list plays a timed address as free skate.

export const RUN_MODES = ["timed", "tour", "free"];

// The mode for the `run` value of the address. An unknown value is timed.
export function runMode(param) {
  return param === "tour" || param === "free" ? param : "timed";
}

// What a mode turns on. `hasGoals` is true when the level has a goal list.
// - timer: the round timer, the goal chips and the results screen.
// - claims: a Found spot can be claimed (the rings and the claim line show).
// - capped: the claim points of a run stop at LANDMARKS.runCap (the medal
//   total). A tour has no medal, so it has no cap.
export function modeRules(mode, { hasGoals = true } = {}) {
  if (mode === "tour") return { mode, timer: false, claims: true, capped: false };
  if (mode === "timed" && hasGoals) return { mode, timer: true, claims: true, capped: true };
  return { mode: "free", timer: false, claims: false, capped: true };
}

// The address of the same page in another mode: the other parameters stay.
export function modeHref(href, mode) {
  const url = new URL(href);
  if (mode === "timed") url.searchParams.delete("run");
  else url.searchParams.set("run", mode);
  return url.toString();
}
