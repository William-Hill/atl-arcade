// Goals and the run timer (M1-05). Pure, immutable: every function returns a
// new object. The goal list is data per level (src/level/goals.js).
//
// A run lasts `def.time` seconds of sim time (THPS style, 2:30). When the
// time is out, a combo that is still open can finish: the run ends when the
// combo banks or bails, or after `def.overtime` more seconds.
//
// Goal types:
// - "score": the banked score is `target` or more.
// - "combo": one banked combo is `target` points or more (combo.best).
// - "cards": the skater collected `target` fact cards. The count comes from
//   the caller (the fact cards of #17), so this module does not know the cards.
// - "gap": a named gap. The skater is in the air inside `zone` and lands
//   with no bail. `from` (optional) is the list of take-off kinds that count
//   ("jump", "ramp", "edge", "grind"). `landing` (optional) is a second zone:
//   the skater must land inside it (for a gap over stairs, the far side).
//
// This module reads the run; it does not change the score or the combo rules.

import { COMBO } from "./constants.js";

export const RUN_TIME = 150; // s, 2:30

export function createGoals(def) {
  return {
    time: 0,
    timeLeft: def.time ?? RUN_TIME,
    ended: false,
    score: 0,
    best: 0,
    cards: 0,
    gaps: [], // ids of the cleared gaps, in order
    air: null, // { time, from, zones } while the skater is in the air
    justCleared: [], // gap ids cleared this tick
  };
}

export function inZone(zone, position) {
  const dx = position[0] - zone.x;
  const dz = position[2] - zone.z;
  return dx * dx + dz * dz <= zone.r * zone.r;
}

function gapGoals(def) {
  return def.goals.filter((g) => g.type === "gap");
}

// One sim tick, after stepRun. `cards` is the count of collected fact cards.
export function stepGoals(g, run, def, dt, { cards = g.cards, minAirTime = COMBO.minAirTime } = {}) {
  if (g.ended) return g.justCleared.length ? { ...g, justCleared: [] } : g;
  const s = run.skater;
  const time = g.time + dt;
  const limit = def.time ?? RUN_TIME;
  let air = g.air;
  let gaps = g.gaps;
  const justCleared = [];

  if (s.justFell || s.respawned) {
    air = null;
  } else if (s.state === "air") {
    const from = air ? air.from : s.airFrom;
    const zones = air ? [...air.zones] : [];
    for (const gap of gapGoals(def)) {
      if (gaps.includes(gap.id) || zones.includes(gap.id)) continue;
      if (gap.from && !gap.from.includes(from)) continue;
      if (inZone(gap.zone, s.position)) zones.push(gap.id);
    }
    air = { time: (air ? air.time : 0) + dt, from, zones };
  } else if (air && s.state !== "grind") {
    // A landing ends the air. A grind from the air keeps it until the
    // skater is back on the ground.
    if (s.justLanded && air.time >= minAirTime) {
      const landed = air.zones.filter((id) => {
        const gap = def.goals.find((x) => x.id === id);
        return !gap.landing || inZone(gap.landing, s.position);
      });
      justCleared.push(...landed);
      gaps = [...gaps, ...landed];
    }
    air = null;
  }

  const over = time >= limit;
  const ended = over && (!run.combo.active || time >= limit + (def.overtime ?? 10));
  return {
    time,
    timeLeft: Math.max(0, limit - time),
    ended,
    score: run.combo.score,
    best: run.combo.best,
    cards,
    gaps,
    air,
    justCleared,
  };
}

// The run JSON: the record that the results screen reads.
export function goalsJson(g, def) {
  return {
    level: def.level,
    time: Math.round(g.time * 100) / 100,
    ended: g.ended,
    score: g.score,
    bestCombo: g.best,
    cards: g.cards,
    gaps: [...g.gaps],
  };
}

const MEDALS = ["gold", "silver", "bronze"];

// The goal list and the medal, from the run JSON only.
export function computeResults(json, def) {
  const goals = def.goals.map((goal) => {
    let value;
    let target = goal.target ?? 1;
    if (goal.type === "score") value = json.score;
    else if (goal.type === "combo") value = json.bestCombo;
    else if (goal.type === "cards") value = json.cards;
    else if (goal.type === "gap") {
      value = json.gaps.includes(goal.id) ? 1 : 0;
      target = 1;
    } else throw new Error(`unknown goal type "${goal.type}"`);
    return { id: goal.id, type: goal.type, label: goal.label, value, target, done: value >= target };
  });
  const medals = def.medals ?? {};
  const medal = MEDALS.find((m) => medals[m] !== undefined && json.score >= medals[m]) ?? null;
  const next = [...MEDALS].reverse().find((m) => medals[m] !== undefined && json.score < medals[m]) ?? null;
  return {
    level: json.level,
    score: json.score,
    bestCombo: json.bestCombo,
    goals,
    completed: goals.filter((g) => g.done).length,
    total: goals.length,
    medal,
    next: next ? { medal: next, score: medals[next] } : null,
  };
}

// "2:30" for 150 s. Rounds up, so the clock shows 0:00 only at the end.
export function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds - 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Checks a goal definition. Returns a list of problems (empty when valid).
export function checkGoalDef(def) {
  const problems = [];
  if (!(def.time > 0)) problems.push("time must be more than 0");
  const ids = new Set();
  for (const g of def.goals ?? []) {
    if (ids.has(g.id)) problems.push(`duplicate goal id "${g.id}"`);
    ids.add(g.id);
    if (!g.label) problems.push(`goal "${g.id}" has no label`);
    if (!["score", "combo", "cards", "gap"].includes(g.type)) problems.push(`goal "${g.id}" has unknown type "${g.type}"`);
    if (g.type === "gap" && !(g.zone && Number.isFinite(g.zone.x) && Number.isFinite(g.zone.z) && g.zone.r > 0)) problems.push(`gap "${g.id}" has no valid zone`);
    if (g.landing && !(Number.isFinite(g.landing.x) && Number.isFinite(g.landing.z) && g.landing.r > 0)) problems.push(`gap "${g.id}" has no valid landing zone`);
    if (g.type !== "gap" && !(g.target > 0)) problems.push(`goal "${g.id}" has no target`);
  }
  const m = def.medals ?? {};
  if (!(m.bronze < m.silver && m.silver < m.gold)) problems.push("medals must be bronze < silver < gold");
  return problems;
}
