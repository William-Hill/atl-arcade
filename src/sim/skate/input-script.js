// A compact way to write an input script: a list of segments, each a duration
// and the input held for it. Expanding it at a fixed dt gives one input per
// simulation step, so Vitest and the browser harness drive the controller with
// exactly the same frames.

import { NO_INPUT } from "./controller.js";

export function expandScript(segments, dt) {
  if (!Array.isArray(segments)) throw new Error("input-script: segments must be an array");
  if (!(dt > 0)) throw new Error("input-script: dt must be positive");

  const frames = [];
  for (const segment of segments) {
    const seconds = segment.for ?? 0;
    if (!(seconds > 0)) throw new Error("input-script: every segment needs a positive `for`");
    const steps = Math.round(seconds / dt);
    const input = { ...NO_INPUT, ...(segment.input ?? {}) };
    // `tap` fires on the first step of the segment only, for one-shot inputs
    // like jump that would otherwise re-fire every frame.
    const tap = segment.tap ?? [];
    for (let i = 0; i < steps; i += 1) {
      const frame = { ...input };
      for (const key of tap) frame[key] = i === 0;
      frames.push(frame);
    }
  }
  return frames;
}

export const scriptSeconds = (segments) => segments.reduce((total, s) => total + (s.for ?? 0), 0);
