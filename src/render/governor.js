// Frame-time governor (#72). It watches the frame times, and when the
// median over a window is above the budget, it steps down one rung of a
// ladder: a lower pixel ratio first, then the post pass off. It only steps
// down. A step up could make the frame rate swing between two rungs.
//
// Pure: the caller feeds frame times in ms and applies the rung it gets.

export const GOVERNOR = {
  budgetMs: 25, // a median frame time above this (under 40 FPS) steps down
  window: 90, // frames in one measurement
  warmupMs: 3000, // ignore the frames of the first 3 s (shader compile, loads)
  cooldownMs: 2000, // wait this long after a step before the next measurement
  maxFrameMs: 250, // ignore longer frames (a hidden tab, a debugger pause)
};

// The rungs for a tier, from the best look to the cheapest.
export function ladderFor(tier) {
  const rungs = [];
  const top = tier.pixelRatio;
  for (const pr of [top, 1.25, 1]) {
    if (pr <= top && !rungs.some((r) => r.pixelRatio === pr)) rungs.push({ pixelRatio: pr, post: tier.post });
  }
  if (tier.post) rungs.push({ pixelRatio: 1, post: null });
  return rungs;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function createGovernor(ladder, k = GOVERNOR) {
  return { ladder, rung: 0, samples: [], elapsed: 0, holdUntil: k.warmupMs, last: null, k };
}

// Feeds one frame time (ms). Returns the next governor state. `changed`
// is true when the rung went down on this frame.
export function governorStep(g, frameMs, k = g.k ?? GOVERNOR) {
  const elapsed = g.elapsed + frameMs;
  const base = { ...g, elapsed, changed: false };
  if (!(frameMs > 0) || frameMs > k.maxFrameMs) return base;
  if (elapsed < g.holdUntil) return base;
  if (g.rung >= g.ladder.length - 1) return base;
  const samples = [...g.samples, frameMs];
  if (samples.length < k.window) return { ...base, samples };
  const m = median(samples);
  if (m <= k.budgetMs) return { ...base, samples: [], last: m };
  return { ...base, rung: g.rung + 1, samples: [], holdUntil: elapsed + k.cooldownMs, last: m, changed: true };
}

export function currentRung(g) {
  return g.ladder[g.rung];
}
