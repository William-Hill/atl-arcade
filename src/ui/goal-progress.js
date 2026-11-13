// The round goals on the HUD (#268). Pure: no DOM. The HUD reads these
// rows once per frame. The goal state comes from src/sim/skate/goals.js, and
// the status of each goal comes from computeResults, so the HUD and the
// results screen always agree.
//
// The HUD groups the goals by type: one row for the score, one for the
// combo, one for the fact cards, and one for all the named gaps. The
// results screen still lists each gap by name.

import { computeResults, goalsJson } from "../sim/skate/goals.js";

// The short label of each row. The order of the rows is this order.
export const GOAL_ROWS = [
  { key: "score", short: "Score" },
  { key: "combo", short: "Combo" },
  { key: "cards", short: "Cards" },
  { key: "gap", short: "Gaps" },
];

export const DONE_MARK = "✓";

// The status of each goal of the level, from the goal state.
export function goalStatus(def, state) {
  return computeResults(goalsJson(state, def), def).goals;
}

// One row per goal type that the level has. A row is done when every goal in
// it is done. The value never goes over the target.
export function goalRows(status) {
  const rows = [];
  for (const { key, short } of GOAL_ROWS) {
    const list = status.filter((g) => g.type === key);
    if (!list.length) continue;
    if (key === "gap") {
      const value = list.filter((g) => g.done).length;
      rows.push({ key, short, value, target: list.length, done: value >= list.length });
    } else {
      // With two goals of one type, the row shows the first open goal.
      const g = list.find((x) => !x.done) ?? list[list.length - 1];
      rows.push({ key, short, value: Math.min(g.value, g.target), target: g.target, done: g.done });
    }
  }
  return rows;
}

// A number for the HUD. `compact` gives "2.3K" for 2,340 on a phone.
export function shortNumber(n, compact = false) {
  if (!compact || n < 1000) return n.toLocaleString("en-US");
  const k = Math.floor(n / 100) / 10;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
}

// The text of one row: "Score 2,340/6,000", or "Score 2.3K/6K" on a phone.
// A done row starts with a check mark, so the cue does not need color.
export function rowText(row, compact = false) {
  const text = `${row.short} ${shortNumber(row.value, compact)}/${shortNumber(row.target, compact)}`;
  return row.done ? `${DONE_MARK} ${text}` : text;
}

// The goals that are done now and were not done before, in level order.
// `before` is null at the start of a run: nothing is new then.
export function newlyMet(before, now) {
  if (!before) return [];
  const was = new Map(before.map((g) => [g.id, g.done]));
  return now.filter((g) => g.done && was.get(g.id) === false);
}

// The confirmation line for a met goal: "Goal met: Score 6,000 points".
export function metText(goal) {
  return `${DONE_MARK} Goal met: ${goal.label}`;
}
