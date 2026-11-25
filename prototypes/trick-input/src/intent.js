// The intent log for an agent playtest (Autopilot) of the trick input
// prototype (#326). Pure: it has no DOM.
//
// The agent says the trick it wants with intend(dir) just before it presses
// TRICK, SPIN, or GRIND. The page feeds the sim events and the input
// direction history to the log each frame. The log pairs each intention with
// the next trick, and gives the 3 metrics of playtest 1 with the same
// definitions as the synthetic players (bots.js, metrics()):
//   - tricks as wanted: the result is the intended direction;
//   - unwanted Up from push: of the presses with an "u" start (W) in the
//     1.5 s before and another intended direction, the share that came out Up;
//   - unwanted Left/Right from carves: of the presses with an "l" or "r" start
//     from 1.2 s before to 0.3 s after and an intended n, u, or d, the share
//     that came out Left or Right.
// Also the time to the first banked combo of 3 links or more with a manual.

const DIRS = ["n", "l", "r", "u", "d"];
const PAIR_KINDS = new Set(["grab", "dance", "grind"]);
// An intention older than this (s) at the trick does not pair.
export const INTENT_MAX_AGE = 2;
const PUSH_BEFORE = 1.5;
const CARVE_BEFORE = 1.2;
const CARVE_AFTER = 0.3;

export function createIntentLog() {
  return { intents: [], trials: [], dirs: [], seen: new Set(), startT: 0, firstCombo: null };
}

// The agent's intention at sim time t. Returns the stored entry, or an error.
export function intend(log, dir, t, note = "") {
  if (!DIRS.includes(dir)) return { error: `dir must be one of ${DIRS.join(", ")}` };
  const e = { dir, at: t, note: String(note || ""), paired: false };
  log.intents.push(e);
  return e;
}

// A new run (the page reset): the combo clock starts again at t.
export function restartClock(log, t) {
  log.startT = t;
  log.firstCombo = null;
}

// Feed one frame: the direction history of the input and the sim events.
export function feed(log, dirHist, events) {
  for (const d of dirHist || []) {
    const key = `${d.dir}@${d.at}`;
    if (log.seen.has(key)) continue;
    log.seen.add(key);
    log.dirs.push({ dir: d.dir, at: d.at });
  }
  for (const e of events || []) {
    if (e.type === "bank" && log.firstCombo == null && e.links >= 3 && e.manual) log.firstCombo = { seconds: e.t - log.startT, names: e.names, banked: e.banked };
    const isTrick = e.type === "trick" && PAIR_KINDS.has(e.kind);
    const isChange = e.type === "stance-change";
    if (!isTrick && !isChange) continue;
    if (isChange) {
      // A touch flick after the snap changes the stance of the last grind trial.
      const last = log.trials[log.trials.length - 1];
      if (last && last.kind === "grind") last.result = e.dir;
      continue;
    }
    const open = log.intents.filter((i) => !i.paired && i.at <= e.t + 1e-9 && e.t - i.at <= INTENT_MAX_AGE);
    if (!open.length) continue;
    const i = open[open.length - 1];
    for (const o of open) o.paired = true;
    log.trials.push({ intended: i.dir, result: e.dir, kind: e.kind, name: e.name, pressAt: e.t, intendAt: i.at, note: i.note });
  }
}

// The push and carve context of a trial, from the direction starts.
function context(log, tr) {
  const p = tr.pressAt;
  const pushed = log.dirs.some((d) => d.dir === "u" && d.at >= p - PUSH_BEFORE && d.at <= p + 1e-9);
  const carve = log.dirs.some((d) => (d.dir === "l" || d.dir === "r") && d.at >= p - CARVE_BEFORE && d.at <= p + CARVE_AFTER);
  return { pushed, carve };
}

export function intentMetrics(log) {
  const rows = log.trials.map((tr) => ({ ...tr, ...context(log, tr), wanted: tr.result === tr.intended }));
  const n = rows.length;
  const notUp = rows.filter((r) => r.intended !== "u" && r.pushed);
  const withCarve = rows.filter((r) => r.carve && r.intended !== "l" && r.intended !== "r");
  const share = (a, f) => (a.length ? a.filter(f).length / a.length : null);
  return {
    trials: n,
    wantedShare: share(rows, (r) => r.wanted),
    unwantedUpFromPush: share(notUp, (r) => r.result === "u"),
    pushTrials: notUp.length,
    unwantedLRFromCarve: share(withCarve, (r) => r.result === "l" || r.result === "r"),
    carveTrials: withCarve.length,
    unpairedIntents: log.intents.filter((i) => !i.paired).length,
    firstCombo: log.firstCombo,
    rows,
  };
}
