// Frame-time governor (#72). It watches the frame times, and when the
// median over a window is above the budget, it steps down one rung of a
// ladder: a lower pixel ratio first, then the post pass off. It only steps
// down. A step up could make the frame rate swing between two rungs.
//
//
// The pbr look on the phone tier ("pbr lite", #246) has one more step at the
// end of its ladder: the toon look. That rung has `look: "toon"`. The look
// builds the scene, so the caller applies it with a reload (look-down.js).
//
// Pure: the caller feeds frame times in ms and applies the rung it gets.

export const GOVERNOR = {
  budgetMs: 25, // a median frame time above this (under 40 FPS) steps down
  window: 90, // frames in one measurement
  warmupMs: 3000, // ignore the frames of the first 3 s (shader compile, loads)
  cooldownMs: 2000, // wait this long after a step before the next measurement
  maxFrameMs: 250, // ignore longer frames (a hidden tab, a debugger pause)
  windowMs: 0, // over 0: a measurement also ends after this much sampled time, with minSamples frames or more
  minSamples: 8,
  longRun: 0, // over 0: this many frames in a row over maxFrameMs are a slow device, not a pause, and they count
  jump: false, // true: a step can skip the rungs that cannot reach the budget
};

// The governor of pbr lite (#246). A phone that cannot hold the pbr look can
// be far over the budget, so: frames over maxFrameMs count when they come in
// a row (a pause is one long frame), a measurement ends after 4 s (90 frames
// at 300 ms are 27 s), and a step skips the pixel ratio rungs that cannot
// reach the budget even if the whole frame cost were pixels.
export const LITE_GOVERNOR = { ...GOVERNOR, windowMs: 4000, minSamples: 8, longRun: 4, jump: true };

// The rungs for a tier, from the best look to the cheapest.
// `lookDown` (pbr lite): the rungs carry the look, the pixel ratio rungs keep
// the post pass (with no post pass the pbr scene draws into the canvas, which
// has MSAA, and that costs more: #195), and the last rung is the toon look.
export function ladderFor(tier, { lookDown = false } = {}) {
  const rungs = [];
  const top = tier.pixelRatio;
  for (const pr of [top, 1.25, 1]) {
    if (pr <= top && !rungs.some((r) => r.pixelRatio === pr)) rungs.push({ pixelRatio: pr, post: tier.post, ...(lookDown ? { look: "pbr" } : {}) });
  }
  if (lookDown) rungs.push({ pixelRatio: top, post: tier.post, look: "toon" });
  else if (tier.post) rungs.push({ pixelRatio: 1, post: null });
  return rungs;
}

// Pure: the rung after a slow measurement with the median `m`. One rung
// down, or with `k.jump` the first lower rung that could reach the budget
// if the whole frame cost were pixels (the frame time times the square of
// the pixel ratio change). No such rung: the last rung.
export function nextRung(ladder, rung, m, k = GOVERNOR) {
  const last = ladder.length - 1;
  if (!k.jump) return Math.min(rung + 1, last);
  const now = ladder[rung];
  for (let i = rung + 1; i < last; i += 1) {
    const r = ladder[i];
    if ((r.look ?? null) !== (now.look ?? null) || r.post !== now.post) return i;
    if (m * (r.pixelRatio / now.pixelRatio) ** 2 <= k.budgetMs) return i;
  }
  return last;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function createGovernor(ladder, k = GOVERNOR) {
  return { ladder, rung: 0, samples: [], elapsed: 0, holdUntil: k.warmupMs, last: null, long: 0, k };
}

// Feeds one frame time (ms). Returns the next governor state. `changed`
// is true when the rung went down on this frame.
export function governorStep(g, frameMs, k = g.k ?? GOVERNOR) {
  const elapsed = g.elapsed + frameMs;
  const base = { ...g, elapsed, changed: false, long: 0 };
  if (!(frameMs > 0)) return base;
  if (frameMs > k.maxFrameMs) {
    // One long frame is a pause. `longRun` of them in a row are a slow device.
    const long = (g.long ?? 0) + 1;
    if (!(k.longRun > 0) || long < k.longRun) return { ...base, long };
    base.long = long;
  }
  if (elapsed < g.holdUntil) return base;
  if (g.rung >= g.ladder.length - 1) return base;
  const samples = [...g.samples, frameMs];
  const timeUp = k.windowMs > 0 && samples.length >= k.minSamples && samples.reduce((a, b) => a + b, 0) >= k.windowMs;
  if (samples.length < k.window && !timeUp) return { ...base, samples };
  const m = median(samples);
  if (m <= k.budgetMs) return { ...base, samples: [], last: m };
  return { ...base, rung: nextRung(g.ladder, g.rung, m, k), samples: [], holdUntil: elapsed + k.cooldownMs, last: m, changed: true };
}

export function currentRung(g) {
  return g.ladder[g.rung];
}
