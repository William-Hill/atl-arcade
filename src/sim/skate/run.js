// A run: the skater plus the combo. Pure. Turns skater events (grind exit,
// landing, style move, fall) into combo moves, and ticks the link window.
// `beat` is an optional { judge(t) } from the beat clock (M0-07); when a
// move lands within the window it earns the on-beat bonus.

import { COMBO, TRICK } from "./constants.js";
import { comboBail, comboMove, comboStumble, comboTick, createCombo } from "./combo.js";
import { manualPoints } from "./manual.js";
import { trickOptions } from "./trick-step.js";
import { MANUALS, airBase, airName, airPoints, grindName as trickGrindName, stanceBonus } from "./tricks.js";
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

// [Long] [edge] [stance] Grind (GDD R6). With no stance: "Ledge Grind", "Long Rail Grind".
export function grindName(id, meters, stance = "n") {
  return trickGrindName(id, meters, stance);
}

// The points of a grind (#262): a base plus the meters on the rail, plus the
// stance bonus of a direction stance (F4, trick input).
export function grindPoints(grind, k = COMBO, tk = TRICK) {
  return k.grindBase + k.grindPerMeter * (grind.distance ?? 0) + stanceBonus(grind.stance, tk);
}

// Fast travel (src/level/geo/travel.js): the same run with the skater at a
// new place, at rest. The combo ends, so a jump does not carry points; the
// score, the time, and the fact cards stay.
export function teleportRun(run, level, { position, yaw }) {
  // The sim clock (`skater.time`) goes on: the input sends its times on it.
  return { ...run, skater: { ...createSkater(level, { position, yaw }), time: run.skater.time ?? run.time }, combo: createCombo(), moves: [], banked: 0 };
}

export function stepRun(run, input, dt, env = FLAT_GROUND, skaterEnv = { grindables: [] }, beat = null) {
  const prev = run.skater;
  // Style moves last a whole number of beats at the clock's BPM (per track, #110).
  const moveEnv = beat && beat.bpm ? { ...skaterEnv, bpm: beat.bpm } : skaterEnv;
  const skater = stepSkater(prev, input, dt, env, moveEnv);
  const time = run.time + dt;
  let combo = run.combo;
  const moves = [];
  const T = trickOptions(skaterEnv.tricks);
  // `beat.judgeNow()` judges the audio clock at this tick; `beat.judge(t)`
  // judges a sim time (tests). Either may return null when no clock runs.
  const judgeAt = (t) => (beat ? (beat.judgeNow ? beat.judgeNow() : beat.judge(t)) : null);
  // The judged moment (F6): air, the touchdown; grind, the snap; manual, the
  // GRIND press; dance, its end. `b` is the judge result of that moment.
  const judge = (points, move, name, { b = judgeAt(time), landing = "clean" } = {}) => {
    const onBeat = Boolean(b && b.onBeat) && landing !== "stumble";
    combo = comboMove(combo, { move, name, points: Math.round(points), onBeat, beat: b, landing }, T ? T.c : COMBO);
    const link = combo.links[combo.links.length - 1];
    moves.push({ tick: run.tick + 1, move, name, points: Math.round(points), earned: link.points, onBeat: link.onBeat, beatTag: link.tag, offsetMs: b ? b.offsetMs : null, landing });
  };
  // The beat at the grind snap and at the GRIND press, kept for the link.
  let snapBeat = run.snapBeat ?? null;
  let grindBeat = run.grindBeat ?? null;
  let manualBeat = run.manualBeat ?? null;
  if (skater.justSnapped) snapBeat = judgeAt(time);
  if (T && skater.grindPressed) grindBeat = judgeAt(time);
  if (T && skater.justManual) manualBeat = skater.justManual.link ? judgeAt(time) : grindBeat;

  if (skater.justExited && prev.grind) {
    const g = skater.endedGrind ?? prev.grind;
    judge(grindPoints(g), "grind", grindName(g.id, g.distance ?? 0, g.stance), { b: T ? snapBeat : judgeAt(time) });
  }
  if (T) {
    // F3: the air at the touchdown (#327, #334, #339).
    const l = skater.landing;
    if (l) {
      const name = l.grab ? l.grab.name : airName(l.airFrom);
      if (name && l.airTime >= COMBO.minAirTime) {
        const grab = l.grab ? (l.grab.dir === "n" ? "neutral" : "dir") : null;
        judge(airPoints({ base: airBase(l.airFrom), grab, tHold: l.hold, airYaw: l.airYaw }, T.k), "air", name, { landing: l.result });
      } else if (l.result === "stumble") combo = comboStumble(combo, T.c);
    }
    // F2: the manual link at the cap, or at the end.
    const manualName = (m) => (m.toe ? MANUALS.toe.name : MANUALS.manual.name);
    if (skater.manualCap) judge(manualPoints(skater.manualCap.meters, skater.manualCap.toe, T.k), "manual", manualName(skater.manualCap), { b: manualBeat });
    const end = skater.manualEnd;
    if (end && !end.capped) judge(manualPoints(end.meters, end.toe, T.k), "manual", manualName(end), { b: manualBeat, landing: end.result });
    else if (end && end.result === "stumble") combo = comboStumble(combo, T.c);
  } else if (skater.justLanded && prev.airTime >= COMBO.minAirTime) {
    if (prev.airFrom === "ramp") judge(COMBO.vertAirPoints, "air", "Vert Air");
    else if (prev.airFrom === "launch") judge(COMBO.rampAirPoints, "air", "Ramp Air");
    else if (prev.airFrom === "jump" || prev.airFrom === "grind") judge(COMBO.hopPoints, "air", "Hop");
  }
  if (skater.justStyled) judge(skater.justStyled.points, "style", skater.justStyled.name);
  // A bail banks bailBank of the pending points (F7); report it in `banked` too.
  let bailBanked = 0;
  if (skater.justFell || skater.respawned) {
    const wasActive = combo.active;
    combo = comboBail(combo, T ? T.c : COMBO);
    if (wasActive) bailBanked = combo.lastBanked;
  }

  // A manual keeps the combo open until its link is added at the cap (R8).
  const open = skater.state === "grind" || skater.state === "air" || Boolean(skater.style) || Boolean(skater.manual && !skater.manual.capped) || Boolean(skater.trickPend);
  const before = combo;
  combo = comboTick(combo, dt, open, T ? T.c : COMBO);
  const banked = (before.active && !combo.active ? combo.lastBanked : 0) + bailBanked;
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
    snapBeat,
    grindBeat,
    manualBeat,
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
