// Tuning knobs of the trick input (docs/gdd/trick-input.md, R2, R3, R3a,
// R11, R12.3, Tuning Knobs). The input layer owns these knobs: the sim
// (src/sim/skate/) reads them through the pure rule in ./direction.js.
// Times are in seconds on the sim clock, except the flick (px, ms).

export const EPS = 1e-6; // float slack for frame time compares

export const TRICK_INPUT = Object.freeze({
  dirBefore: 0.15, // s a direction may start before the press (R3). 0.10 / 0.15 / 0.25
  dirAfter: 0.06, // s the game waits after the press when no fresh direction exists (R3). 0 / 0.06 / 0.10
  stickThreshold: 0.5, // gamepad stick travel for a direction (R2). 0.35 / 0.5 / 0.7
  flickMin: 24, // px of drag for a touch flick (R11). 16 / 24 / 40
  flickMaxMs: 120, // ms before a touch with no flick resolves neutral (R11). 80 / 120 / 250
  // R3a, the axis rule (owner choice 2026-11-25, #326). On by default.
  axisRule: true,
  udHold: 0.3, // s: an up or down still held at the press counts if it started inside this. 0.25 / 0.3 / 0.4
  udFirst: true, // an up or down beats a left or right when both are fresh
});

// Toggle 7 (`?gddRule`): the R3 rule only (the newest start event), no R3a.
export const R3_ONLY = Object.freeze({ axisRule: false, udHold: null, udFirst: false });

// R12.3 "Relaxed timing". `landingGrace` is a sim knob; the input keeps the
// value here so that one switch sets all 4 windows.
export const RELAXED = Object.freeze({ dirBefore: 0.25, dirAfter: 0.1, flickMaxMs: 250, landingGrace: 0.2 });

// The knobs for a choice of the switches.
export function trickKnobs({ relaxed = false, r3Only = false } = {}) {
  return { ...TRICK_INPUT, ...(r3Only ? R3_ONLY : {}), ...(relaxed ? RELAXED : {}) };
}

// The trick switch of the sim (`skaterEnv.tricks`, src/sim/skate/trick-step.js)
// for a choice of the switches. The sim takes Relaxed timing from `relaxed`
// and toggle 7 (`?gddRule`, the R3 rule only) from `k`. A new object for each
// change: the sim caches its options per object.
export function simTricks({ oneButton = false, relaxed = false, r3Only = false } = {}) {
  return { oneButton: Boolean(oneButton), relaxed: Boolean(relaxed), ...(r3Only ? { k: { axisRule: false, udFirst: false } } : {}) };
}
