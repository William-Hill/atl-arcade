// A deterministic driver: raw device events -> input.js -> sim.js, one 60 Hz
// frame at a time. Pure. The tests, the playtest bots, and the page all use it.

import { DT } from "./constants.js";
import { frameInput, keyDown, keyUp, padSample, touchDown, touchMove, touchUp, touchStick } from "./input.js";
import { stepSim } from "./sim.js";

// Apply one raw event to the input state. `e.t` is in s on the sim clock.
export function applyEvent(inp, e) {
  switch (e.kind) {
    case "key":
      return e.down ? keyDown(inp, e.code, e.t) : keyUp(inp, e.code, e.t);
    case "pad":
      return padSample(inp, e.axes, e.buttons, e.t);
    case "touchDown":
      return touchDown(inp, e.id, e.button, e.x, e.y, e.t);
    case "touchMove":
      return touchMove(inp, e.id, e.x, e.y, e.t);
    case "touchUp":
      return touchUp(inp, e.id, e.t);
    case "stick":
      return touchStick(inp, e.x, e.y);
    default:
      throw new Error(`unknown event ${e.kind}`);
  }
}

// Run `frames` sim frames. `events` is sorted by t; the events with
// t <= the frame time apply before that frame. Returns the frame inputs.
export function run(sim, inp, events, frames, onFrame) {
  const queue = [...events].sort((a, b) => a.t - b.t);
  let i = 0;
  for (let f = 0; f < frames; f++) {
    const t = Math.round((sim.t + DT) * 1e9) / 1e9;
    while (i < queue.length && queue[i].t <= t + 1e-9) applyEvent(inp, queue[i++]);
    const frame = frameInput(inp, t);
    stepSim(sim, frame);
    if (onFrame) onFrame(sim, frame);
  }
  return sim;
}

// Event builders. `f` is a frame number (t = f / 60) or use `at(s)`.
export const T = (frame) => Math.round((frame / 60) * 1e9) / 1e9;
export const key = (code, down, t) => ({ kind: "key", code, down, t });
export const tap = (code, t, len = 0.1) => [key(code, true, t), key(code, false, t + len)];
