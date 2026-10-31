// The three scripted playtest sessions. Pure data, shared by the Playwright
// harness (scripts/playtest.mjs) and the node test that validates them.
// Each session starts the skater at `start` and plays `script` one entry per
// fixed tick. Scripts are { frames, input } entries (src/input/scripted.js).

import { GRIND } from "../sim/skate/constants.js";

const BAL = GRIND.balanceDrift / GRIND.balanceCorrect;
const P = (frames) => ({ frames, input: { push: true } });
const S = (frames, steer) => ({ frames, input: { steer } });
const C = (frames) => ({ frames, input: {} });
const G = (frames, steer = 0) => ({ frames, input: { grind: true, steer } });

export const SESSIONS = [
  {
    id: "lap",
    title: "Free-skate lap",
    description: "East along the street, a U-turn onto the north sidewalk, west, a U-turn, east. No tricks. The FPS baseline.",
    start: { position: [-24, 0, 0], yaw: 0 },
    script: [P(140), C(70), S(80, 1), P(70), C(60), S(80, 1), P(40), C(40)],
    expect: { falls: 0, snaps: 0 },
  },
  {
    id: "rails",
    title: "Rail approaches",
    description: "Three approaches to the straight rail: one with no balance input (a fall), one balanced, one more. Measures falls per minute.",
    start: { position: [-26, 0, -2], yaw: 0 },
    script: [P(90), G(120), C(60), S(80, 1), P(60), C(30), S(80, 1), P(30), G(150, BAL), C(60), S(80, 1), P(60), C(30), S(80, 1), { frames: 60, input: { push: true, grind: true } }, G(120), C(60), S(80, 1), P(60), C(60)],
    expect: { minFalls: 1, minSnaps: 2 },
  },
  {
    id: "combo",
    title: "Combo line",
    description: "Grind the straight rail, hop off, shuffle on the roll-out (a 3-link combo), then push east and launch off the quarter pipe for a Vert Air.",
    start: { position: [-26, 0, -2], yaw: 0 },
    script: [P(90), G(40, BAL), { frames: 1, input: { grind: true, steer: BAL, jump: true } }, C(45), { frames: 1, input: { style1: true } }, C(40), P(260), C(180)],
    expect: { minMaxCombo: 3, vertAir: true },
  },
];

// Derives the combo metrics from a run's ordered event list.
// Events: { type: "move" | "bank" | "bail" | "snap" | "exit" | "fall" | "land" | "jump", tick }.
export function comboMetrics(events, ticksPerSecond = 60) {
  let links = 0;
  let maxCombo = 0;
  let comboCount = 0;
  let firstThreeLinkTick = null;
  let vertAirs = 0;
  for (const e of events) {
    if (e.type === "move") {
      links += 1;
      if (links > maxCombo) maxCombo = links;
      if (links >= 3 && firstThreeLinkTick === null) firstThreeLinkTick = e.tick;
      if (e.name === "Vert Air") vertAirs += 1;
    } else if (e.type === "bank") {
      comboCount += 1;
      links = 0;
    } else if (e.type === "bail") {
      links = 0;
    }
  }
  return {
    comboCount,
    maxCombo,
    timeToFirstThreeLinkSec: firstThreeLinkTick === null ? null : Number((firstThreeLinkTick / ticksPerSecond).toFixed(2)),
    vertAirs,
  };
}

export function fpsMetrics(frameMs) {
  if (!frameMs.length) return { frames: 0, medianFps: 0, averageFps: 0, p5Fps: 0 };
  const sorted = [...frameMs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const avg = frameMs.reduce((a, b) => a + b, 0) / frameMs.length;
  return {
    frames: frameMs.length,
    medianFps: Number((1000 / median).toFixed(1)),
    averageFps: Number((1000 / avg).toFixed(1)),
    p5Fps: Number((1000 / p95).toFixed(1)),
  };
}
