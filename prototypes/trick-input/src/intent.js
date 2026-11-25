// The intent log for an agent playtest (Autopilot) of the trick input
// prototype (#326). Pure: it has no DOM.
//
// The agent says the trick it wants with intend(dir) just before it presses
// TRICK, SPIN, or GRIND. The page feeds the log each frame: the frame input
// (the button flags and the direction history) and the sim events. A press
// of TRICK, SPIN, or GRIND takes the newest intention of the last
// INTENT_MAX_AGE s. The trick (grab, dance, or grind) of that button inside
// OUTCOME_WINDOW after the press is the result; with no trick, the result is
// null (a failed trial, as in bots.js). The 3 metrics use the same
// definitions as the synthetic players (bots.js, metrics()), from the time
// of the button press:
//   - tricks as wanted: the result is the intended direction;
//   - unwanted Up from push: of the presses with an "u" start (W) in the
//     1.5 s before and another intended direction, the share that came out Up;
//   - unwanted Left/Right from carves: of the presses with an "l" or "r" start
//     from 1.2 s before to 0.3 s after and an intended n, u, or d, the share
//     that came out Left or Right.
// Also the time to the first banked combo of 3 links or more with a manual.
//
// A page reset starts a new run (restartClock): the sim clock starts at 0
// again, so each intention, press, and direction start keeps its run, and
// the context of a trial reads only its own run.

const DIRS = ["n", "l", "r", "u", "d"];
const BUTTONS = ["trick", "spin", "grind"];
const PAIR_KINDS = new Set(["grab", "dance", "grind"]);
// An intention older than this (s) at the press does not pair.
export const INTENT_MAX_AGE = 2;
// The trick of a press must start inside this (s) after the press.
export const OUTCOME_WINDOW = 1;
const PUSH_BEFORE = 1.5;
const CARVE_BEFORE = 1.2;
const CARVE_AFTER = 0.3;

export function createIntentLog() {
  return { run: 0, intents: [], pending: [], trials: [], dirs: [], seen: new Set(), prev: {}, startT: 0, firstCombo: null };
}

// The agent's intention at sim time t. Returns the stored entry, or an error.
export function intend(log, dir, t, note = "") {
  if (!DIRS.includes(dir)) return { error: `dir must be one of ${DIRS.join(", ")}` };
  const e = { dir, at: t, note: String(note || ""), run: log.run, paired: false };
  log.intents.push(e);
  return e;
}

// A new run (the page reset) at sim time t: the open intentions and presses
// of the old run close, and the combo clock starts again.
export function restartClock(log, t) {
  for (const p of log.pending) log.trials.push({ ...p, result: null, resultAt: null });
  log.pending = [];
  for (const i of log.intents) if (!i.paired) i.closed = true;
  log.run += 1;
  log.seen = new Set();
  log.prev = {};
  log.startT = t;
  log.firstCombo = null;
}

// Feed one frame: `frame` is the sim input of the frame ({ t, trick, spin,
// grind, dirHist }), `events` the sim events of the frame.
export function feed(log, frame, events) {
  const t = frame.t;
  for (const d of frame.dirHist || []) {
    const key = `${d.dir}@${d.at}`;
    if (log.seen.has(key)) continue;
    log.seen.add(key);
    log.dirs.push({ dir: d.dir, at: d.at, run: log.run });
  }
  // Button presses (the frame where the flag goes on).
  for (const b of BUTTONS) {
    const down = Boolean(frame[b]);
    if (down && !log.prev[b]) {
      const open = log.intents.filter((i) => !i.paired && !i.closed && i.run === log.run && i.at <= t + 1e-9 && t - i.at <= INTENT_MAX_AGE);
      if (open.length) {
        const i = open[open.length - 1];
        for (const o of open) o.paired = true;
        log.pending.push({ intended: i.dir, note: i.note, intendAt: i.at, button: b, pressAt: t, run: log.run });
      }
    }
    log.prev[b] = down;
  }
  for (const e of events || []) {
    if (e.type === "bank" && log.firstCombo == null && e.links >= 3 && e.manual) log.firstCombo = { seconds: e.t - log.startT, names: e.names, banked: e.banked };
    if (e.type === "stance-change") {
      // A touch flick after the snap changes the stance of the last grind trial.
      const last = log.trials[log.trials.length - 1];
      if (last && last.kind === "grind" && last.run === log.run) last.result = e.dir;
      continue;
    }
    if (e.type !== "trick" || !PAIR_KINDS.has(e.kind)) continue;
    // The trick pairs with the newest press of its button (TRICK for a grab,
    // the dance button, GRIND for a grind) before it. An older press of the
    // same button with no trick fails at the end of its window.
    const button = e.kind === "grab" ? "trick" : e.kind === "grind" ? "grind" : e.button;
    let i = -1;
    log.pending.forEach((p, j) => {
      if (p.button === button && p.pressAt <= e.t + 1e-9 && e.t - p.pressAt <= OUTCOME_WINDOW + 1e-9 && (i < 0 || p.pressAt >= log.pending[i].pressAt)) i = j;
    });
    if (i < 0) continue;
    const [p] = log.pending.splice(i, 1);
    log.trials.push({ ...p, result: e.dir, resultAt: e.t, kind: e.kind, name: e.name });
  }
  // A press with no trick inside OUTCOME_WINDOW is a failed trial.
  const late = log.pending.filter((p) => t - p.pressAt > OUTCOME_WINDOW + 1e-9);
  for (const p of late) log.trials.push({ ...p, result: null, resultAt: null });
  log.pending = log.pending.filter((p) => !late.includes(p));
}

// The push and carve context of a trial, from the direction starts of its run.
function context(log, tr) {
  const p = tr.pressAt;
  const own = log.dirs.filter((d) => d.run === tr.run);
  const pushed = own.some((d) => d.dir === "u" && d.at >= p - PUSH_BEFORE && d.at <= p + 1e-9);
  const carve = own.some((d) => (d.dir === "l" || d.dir === "r") && d.at >= p - CARVE_BEFORE && d.at <= p + CARVE_AFTER);
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
    noTrick: rows.filter((r) => r.result === null).length,
    pendingPresses: log.pending.length,
    unpairedIntents: log.intents.filter((i) => !i.paired).length,
    firstCombo: log.firstCombo,
    rows,
  };
}
