// Frame time for the timing tests (#343). The sim steps at 60 Hz. A time in
// a GDD acceptance criterion (docs/gdd/trick-input.md) is the nearest whole
// frame on the sim clock: 100 ms is frame 6, 150 ms is frame 9, 160 ms is
// frame 10. Pure. The tests of R3, R10, and R11 use these helpers, so that a
// test and the GDD use the same frame.
//
// A beat offset (F6) is in ms from the audio clock, not in frames. Do not
// use these helpers for the beat tests: call the pure beat function with the
// offset in ms.

export const FRAME_HZ = 60;
export const FRAME_DT = 1 / FRAME_HZ;

// The nearest whole frame to a time in ms. A negative time (before an event)
// gives a negative frame.
export function msToFrame(ms, hz = FRAME_HZ) {
  if (!Number.isFinite(ms)) throw new Error(`msToFrame needs a finite time in ms, not ${ms}`);
  const f = Math.round((ms * hz) / 1000);
  return f === 0 ? 0 : f; // no -0
}

// The nearest whole frame to a time in s.
export const secToFrame = (s, hz = FRAME_HZ) => msToFrame(s * 1000, hz);

// The time in s of a frame count.
export const frameToSec = (frames, hz = FRAME_HZ) => frames / hz;
