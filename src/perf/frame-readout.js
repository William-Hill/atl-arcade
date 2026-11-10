// The on-screen frame-time readout (?fps=1, #246): the median frame time of
// the last 2 minutes, so a person can read it on a real phone. Pure: main.js
// feeds the frame times and writes the text into the page.
//
// The readout keeps the frames of a time window (120 s by default). The
// median and the 95th percentile come from the frames in the window. A frame
// over `maxFrameMs` (a hidden tab, a screen lock) is left out and counted.

export const READOUT = { windowMs: 120000, maxFrameMs: 1000, refreshMs: 500 };

export function createFrameReadout(k = READOUT) {
  return { k, frames: [], sum: 0, total: 0, dropped: 0, sinceText: Infinity };
}

// Feeds one frame time (ms). Changes and returns the same state: this runs
// once per frame, and a new array per frame would cost on the phone it measures.
export function readoutPush(r, frameMs) {
  r.sinceText += frameMs > 0 ? frameMs : 0;
  if (!(frameMs > 0)) return r;
  if (frameMs > r.k.maxFrameMs) {
    r.dropped += 1;
    return r;
  }
  r.frames.push(frameMs);
  r.sum += frameMs;
  r.total += 1;
  while (r.frames.length > 1 && r.sum - r.frames[0] >= r.k.windowMs) r.sum -= r.frames.shift();
  return r;
}

// Pure: the numbers now: { frames, seconds, medianMs, p95Ms, fps, full }.
// `full` is true once the window holds its whole time.
export function readoutStats(r) {
  const s = [...r.frames].sort((a, b) => a - b);
  if (s.length === 0) return { frames: 0, seconds: 0, medianMs: null, p95Ms: null, fps: null, full: false, dropped: r.dropped };
  const at = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const m = s.length >> 1;
  const medianMs = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return { frames: s.length, seconds: r.sum / 1000, medianMs, p95Ms: at(0.95), fps: 1000 / medianMs, full: r.sum >= r.k.windowMs - 50, dropped: r.dropped };
}

const one = (v) => (Math.round(v * 10) / 10).toFixed(1);

// Pure: the lines of the readout, each short enough for a 360 px wide
// phone. `render` is { look, lite, quality, pixelRatio, rung } (what draws now).
export function readoutText(stats, render = {}) {
  const look = render.look ? `${render.look}${render.lite ? " lite" : ""}` : "";
  const what = [look, render.quality, render.pixelRatio ? `x${render.pixelRatio}` : "", render.rung != null ? `rung ${render.rung}` : ""].filter(Boolean).join(" · ");
  if (stats.medianMs == null) return ["frame: wait", what];
  const span = stats.full ? "2 min" : `${Math.floor(stats.seconds)} s of 120`;
  return [`median ${one(stats.medianMs)} ms · ${Math.round(stats.fps)} fps`, `p95 ${one(stats.p95Ms)} ms · ${span}`, what];
}

// True when the text is due (twice per second, not on every frame).
export function readoutDue(r) {
  if (r.sinceText < r.k.refreshMs) return false;
  r.sinceText = 0;
  return true;
}
