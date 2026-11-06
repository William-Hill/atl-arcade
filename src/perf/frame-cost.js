// Per-system frame cost (?perf=1). Pure: the clock is passed in, so Vitest
// can test it with a fake clock. Off by default: with ?perf=1 off, main.js
// uses NO_PERF, whose calls do nothing.
//
// Usage per frame:
//   perf.begin("walkers"); stepPeds(...); perf.end("walkers");
//   perf.frame();          // once at the end of the frame
// perf.report() gives, for each system, the mean and the p95 cost per frame
// (ms) over the frames since the last reset().

export const PERF_SYSTEMS = ["skater", "walkers", "walkersView", "crowd", "crowdView", "traffic", "trafficView", "npcSkaters", "npcSkatersView", "views", "render"];

// The systems that run once per fixed step (1/60 s), not once per frame.
export const STEP_SYSTEMS = ["skater", "walkers", "crowd", "traffic", "npcSkaters"];

export function createFrameCost(now, systems = PERF_SYSTEMS) {
  const open = new Map();
  let current = Object.fromEntries(systems.map((s) => [s, 0]));
  let steps = 0;
  let frames = [];
  return {
    enabled: true,
    begin(name) {
      open.set(name, now());
    },
    end(name) {
      const t0 = open.get(name);
      if (t0 === undefined) return;
      open.delete(name);
      current[name] = (current[name] ?? 0) + (now() - t0);
    },
    // The fixed steps of this frame.
    steps(n) {
      steps += n;
    },
    // Closes one frame. A system that ran several times in the frame (several
    // fixed steps) adds up.
    frame() {
      frames.push({ ...current, steps });
      current = Object.fromEntries(systems.map((s) => [s, 0]));
      steps = 0;
    },
    reset() {
      frames = [];
      current = Object.fromEntries(systems.map((s) => [s, 0]));
      steps = 0;
      open.clear();
    },
    report() {
      return summarize(frames);
    },
  };
}

// The no-op version, for a page without ?perf=1.
export const NO_PERF = Object.freeze({ enabled: false, begin() {}, end() {}, steps() {}, frame() {}, reset() {}, report: () => null });

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

const round = (v) => Math.round(v * 1000) / 1000;

// Pure: { frames, stepsPerFrame, systems: { name: { meanMs, p95Ms, perStepMs? } } }.
// meanMs and p95Ms are per frame. perStepMs (a step system only) is the cost
// of one 1/60 s step: the cost per frame at 60 FPS.
export function summarize(frames) {
  const names = [...new Set(frames.flatMap((f) => Object.keys(f)))].filter((n) => n !== "steps");
  const totalSteps = frames.reduce((a, f) => a + (f.steps ?? 0), 0);
  const systems = {};
  for (const name of names) {
    const ms = frames.map((f) => f[name] ?? 0);
    const sorted = [...ms].sort((a, b) => a - b);
    const sum = ms.reduce((a, b) => a + b, 0);
    systems[name] = { meanMs: round(sum / (ms.length || 1)), p95Ms: round(percentile(sorted, 0.95)) };
    if (STEP_SYSTEMS.includes(name) && totalSteps > 0) systems[name].perStepMs = round(sum / totalSteps);
  }
  return { frames: frames.length, stepsPerFrame: round(totalSteps / (frames.length || 1)), systems };
}
