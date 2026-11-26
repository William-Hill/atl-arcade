// Test helper for the trick input tests (#327, #334, #339). Not game code.
// A rig steps a run with the trick input on, one 60 Hz frame at a time. All
// the times of the GDD criteria go through the frame helper of #343
// (frames.js): a time in ms is the nearest whole frame.

import { FRAME_DT, msToFrame } from "./frames.js";
import { FLAT_GROUND } from "./controller.js";
import { createRun, stepRun } from "./run.js";
import { polylineLength } from "../../level/splines.js";

export const DT = FRAME_DT;
export const at = (frame) => frame * DT; // the sim time of a frame
export const fr = msToFrame;

// A straight rail or ledge on flat ground, along +x at z = 0.
export function straightGrindable(id, x0, x1, h = 0.4) {
  const points = [];
  for (let i = 0; i <= 16; i += 1) points.push([x0 + ((x1 - x0) * i) / 16, h, 0]);
  return { id, kind: id.split(":")[0], points, total: polylineLength(points) };
}

// Keyboard key events [{ dir, down, up }] in frames (up: null while held)
// as the input field dirHist (times in s on the sim clock).
export const keys = (events) => events.map((e) => ({ dir: e.dir, at: at(e.down), up: e.up == null ? null : at(e.up) }));

export function rig({ tricks = true, grindables = [], env = FLAT_GROUND, skater = "nia", beat = null, speed = 0, position = [0, 0, 0], yaw = 0, bpm } = {}) {
  let run = createRun(null, { position, yaw });
  run.skater.speed = speed;
  const skaterEnv = { grindables, tricks, skater, ...(bpm ? { bpm } : {}) };
  const r = {
    get run() {
      return run;
    },
    get s() {
      return run.skater;
    },
    get frame() {
      return Math.round(run.skater.time / DT);
    },
    moves: [],
    states: [],
    // One frame. `input` is an object or a function of (frame, rig).
    step(input = {}) {
      const next = Math.round(run.skater.time / DT) + 1;
      const inp = typeof input === "function" ? input(next, r) : input;
      run = stepRun(run, inp, DT, env, skaterEnv, beat);
      r.moves.push(...run.moves);
      r.states.push(run);
      return run;
    },
    // n frames; stops early when `until(run)` is true.
    steps(n, input = {}, until = null) {
      for (let i = 0; i < n; i += 1) {
        r.step(input);
        if (until && until(run)) break;
      }
      return run;
    },
    // Put the skater in the air, going up at `vy` (an air of 2 vy / g s on flat ground).
    air({ airFrom = "launch", vy = 5, vx = 6, y = 0.01 } = {}) {
      const s = run.skater;
      run = { ...run, skater: { ...s, state: "air", airFrom, airTime: 0, airYaw: 0, position: [s.position[0], y, s.position[2]], velocity: [vx, vy, 0], speed: Math.hypot(vx, vy) } };
      return r;
    },
    set(fields) {
      run = { ...run, skater: { ...run.skater, ...fields } };
      return r;
    },
    setRun(fields) {
      run = { ...run, ...fields };
      return r;
    },
  };
  return r;
}

// The vertical speed for an air of `sec` s on flat ground (gravity 20 m/s^2).
export const vyFor = (sec, g = 20) => (g * sec) / 2;
