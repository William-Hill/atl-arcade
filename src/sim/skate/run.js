// A run: the skater plus the combo. Pure. Turns skater events (grind exit,
// landing, style move, fall) into combo moves, and ticks the link window.
// `beat` is an optional { judge(t) } from the beat clock (M0-07); when a
// move lands within the window it earns the on-beat bonus.

import { COMBO } from "./constants.js";
import { comboBail, comboMove, comboTick, createCombo } from "./combo.js";
import { createSkater, stepSkater } from "./skater.js";
import { FLAT_GROUND } from "./controller.js";

export function createRun(level, opts = {}) {
  // `moves` holds this tick's scored moves only. `lastMove` and `moveSeq`
  // persist, so a HUD that reads once per frame sees a move even when the
  // frame ran several ticks. `banked` is the points banked this tick (0 if none).
  return { skater: createSkater(level, opts), combo: createCombo(), tick: 0, time: 0, moves: [], lastMove: null, moveSeq: 0, banked: 0 };
}

function grindName(id, seconds) {
  const what = id.startsWith("ledge") ? "Ledge Grind" : "Rail Grind";
  return seconds >= 1.5 ? `Long ${what}` : what;
}

export function stepRun(run, input, dt, env = FLAT_GROUND, skaterEnv = { grindables: [] }, beat = null) {
  const prev = run.skater;
  const skater = stepSkater(prev, input, dt, env, skaterEnv);
  const time = run.time + dt;
  let combo = run.combo;
  const moves = [];
  const judge = (points, move, name) => {
    // `beat.judgeNow()` judges the audio clock at this tick; `beat.judge(t)`
    // judges a sim time (tests). Either may return null when no clock runs.
    const b = beat ? (beat.judgeNow ? beat.judgeNow() : beat.judge(time)) : null;
    const onBeat = Boolean(b && b.onBeat);
    combo = comboMove(combo, { move, name, points, onBeat, beat: b });
    moves.push({ tick: run.tick + 1, move, name, points, onBeat, beatTag: b ? b.tag : null, offsetMs: b ? b.offsetMs : null });
  };

  if (skater.justExited && prev.grind) {
    judge(COMBO.grindBase + COMBO.grindPerSecond * prev.grind.time, "grind", grindName(prev.grind.id, prev.grind.time));
  }
  if (skater.justLanded && prev.airTime >= COMBO.minAirTime) {
    if (prev.airFrom === "ramp") judge(COMBO.vertAirPoints, "air", "Vert Air");
    else if (prev.airFrom === "jump" || prev.airFrom === "grind") judge(COMBO.hopPoints, "air", "Hop");
  }
  if (skater.justStyled) judge(skater.justStyled.points, "style", skater.justStyled.name);
  if (skater.justFell || skater.respawned) combo = comboBail(combo);

  const open = skater.state === "grind" || skater.state === "air" || Boolean(skater.style);
  const before = combo;
  combo = comboTick(combo, dt, open);
  const banked = before.active && !combo.active ? combo.lastBanked : 0;
  return {
    skater,
    combo,
    tick: run.tick + 1,
    time,
    moves,
    lastMove: moves.length ? moves[moves.length - 1] : run.lastMove,
    moveSeq: run.moveSeq + moves.length,
    banked,
  };
}

export function runScriptOnRun(run, script, { dt = 1 / 60, env = FLAT_GROUND, skaterEnv, beat = null, trace = false } = {}) {
  let r = run;
  const states = [];
  for (const entry of script) {
    for (let i = 0; i < entry.frames; i += 1) {
      r = stepRun(r, entry.input ?? {}, dt, env, skaterEnv, beat);
      if (trace) states.push(r);
    }
  }
  return trace ? { run: r, states } : { run: r };
}
