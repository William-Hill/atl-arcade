// Fixed-timestep accumulator. Pure: no Three.js, no DOM, no timers.
// The simulation always advances in whole steps of `dt` so a given input
// script produces the same result on any machine and inside Vitest.

export const FIXED_DT = 1 / 60;

// maxStepsPerFrame caps catch-up work after a stall (a tab in the background,
// a long GC). Past the cap we drop simulation time instead of freezing the
// frame; the skater slows for a moment, which is better than a lock-up.
export function createStepper({ dt = FIXED_DT, maxStepsPerFrame = 5 } = {}) {
  if (!(dt > 0)) throw new Error("fixed-step: dt must be positive");
  if (!(maxStepsPerFrame >= 1)) throw new Error("fixed-step: maxStepsPerFrame must be at least 1");
  return { dt, maxStepsPerFrame, leftover: 0 };
}

// Returns how many fixed steps this frame owes, the new stepper, and how much
// simulation time was dropped because of the cap.
export function advance(stepper, frameSeconds) {
  const elapsed = Number.isFinite(frameSeconds) && frameSeconds > 0 ? frameSeconds : 0;
  const pending = stepper.leftover + elapsed;
  const wanted = Math.floor(pending / stepper.dt);
  const steps = Math.min(wanted, stepper.maxStepsPerFrame);
  const dropped = (wanted - steps) * stepper.dt;
  return {
    stepper: { ...stepper, leftover: pending - wanted * stepper.dt },
    steps,
    dropped,
  };
}

// Fraction of the way into the next step, for interpolating render poses.
export function blend(stepper) {
  return stepper.leftover / stepper.dt;
}
