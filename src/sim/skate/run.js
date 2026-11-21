// A run: the skater plus the combo. Pure. Turns skater events (grind exit,
// landing, style move, fall) into combo moves, and ticks the link window.
// `beat` is an optional { judge(t) } from the beat clock (M0-07); when a
// move lands within the window it earns the on-beat bonus.

import { COMBO } from "./constants.js";
import { comboBail, comboMove, comboTick, createCombo } from "./combo.js";
import { createSkater, stepSkater } from "./skater.js";
import { FLAT_GROUND } from "./controller.js";
import { FACT_CARDS, createCardState, stepCards } from "../fact-cards.js";

export function createRun(level, opts = {}) {
  // `moves` holds this tick's scored moves only. `lastMove` and `moveSeq`
  // persist, so a HUD that reads once per frame sees a move even when the
  // frame ran several ticks. `banked` is the points banked this tick (0 if none).
  // `cards` is the fact card state (M1-07): `cards.count` is the number of
  // cards collected in this run. `factsCollected` holds this tick's card ids.
  return { skater: createSkater(level, opts), combo: createCombo(), tick: 0, time: 0, moves: [], lastMove: null, moveSeq: 0, banked: 0, cards: createCardState(opts.cards ?? []), factsCollected: [] };
}

function grindName(id, seconds) {
  const what = id.startsWith("ledge") ? "Ledge Grind" : "Rail Grind";
  return seconds >= 1.5 ? `Long ${what}` : what;
}

// Fast travel (src/level/geo/travel.js): the same run with the skater at a
// new place, at rest. The combo ends, so a jump does not carry points; the
// score, the time, and the fact cards stay.
export function teleportRun(run, level, { position, yaw }) {
  return { ...run, skater: createSkater(level, { position, yaw }), combo: createCombo(), moves: [], banked: 0 };
}

export function stepRun(run, input, dt, env = FLAT_GROUND, skaterEnv = { grindables: [] }, beat = null) {
  const prev = run.skater;
  // Style moves last a whole number of beats at the clock's BPM (per track, #110).
  const moveEnv = beat && beat.bpm ? { ...skaterEnv, bpm: beat.bpm } : skaterEnv;
  const skater = stepSkater(prev, input, dt, env, moveEnv);
  const time = run.time + dt;
  let combo = run.combo;
  const moves = [];
  const judge = (points, move, name) => {
    // `beat.judgeNow()` judges the audio clock at this tick; `beat.judge(t)`
    // judges a sim time (tests). Either may return null when no clock runs.
    const b = beat ? (beat.judgeNow ? beat.judgeNow() : beat.judge(time)) : null;
    const onBeat = Boolean(b && b.onBeat);
    combo = comboMove(combo, { move, name, points: Math.round(points), onBeat, beat: b });
    moves.push({ tick: run.tick + 1, move, name, points: Math.round(points), onBeat, beatTag: b ? b.tag : null, offsetMs: b ? b.offsetMs : null });
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
  // A fact card adds its points straight to the banked score, outside the
  // combo, so a bail does not lose them.
  const cardStep = stepCards(run.cards ?? createCardState(), skater.position);
  if (cardStep.collected.length) combo = { ...combo, score: combo.score + FACT_CARDS.points * cardStep.collected.length };
  return {
    skater,
    combo,
    tick: run.tick + 1,
    time,
    moves,
    lastMove: moves.length ? moves[moves.length - 1] : run.lastMove,
    moveSeq: run.moveSeq + moves.length,
    banked,
    cards: cardStep.state,
    factsCollected: cardStep.collected,
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
