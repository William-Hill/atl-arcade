// The landmark chimes (#219): the pure part. The sounds are synthesized in
// chimes.js (no sample files), so they need no license and no
// provenance.json. Times are seconds; `at` is from the start of the chime.
//
// Design: design/gdd/landmark-discovery.md, Audio.
// - Found: a soft 2-note rising chime, under 0.4 s.
// - Claimed: a 3-note major arpeggio and a short wheel sound, under 0.9 s.
// - A chime starts on the next beat or half beat of the beat clock, less
//   than 1 beat away, or at once when the clock is off.
// - The music gain goes to 0.5 of its value in 80 ms, holds for the chime,
//   and returns in 300 ms. One chime plays at a time; Claimed goes first.

export const CHIMES = {
  found: {
    // E5 to A5: a rising fourth.
    notes: [
      { freq: 659.25, at: 0, length: 0.2, gain: 0.16 },
      { freq: 880, at: 0.13, length: 0.25, gain: 0.18 },
    ],
    wheel: null,
  },
  claimed: {
    // C5, E5, G5: a major arpeggio, then the wheels.
    notes: [
      { freq: 523.25, at: 0, length: 0.2, gain: 0.18 },
      { freq: 659.25, at: 0.11, length: 0.2, gain: 0.18 },
      { freq: 783.99, at: 0.22, length: 0.38, gain: 0.2 },
    ],
    // A short roll of the wheels: band-passed noise that falls in pitch.
    wheel: { at: 0.34, length: 0.5, gain: 0.07, band: [2400, 900] },
  },
  max: { found: 0.4, claimed: 0.9 }, // s, the GDD limits
  division: 2, // a chime can start on a beat or a half beat
  lead: 0.02, // s, the shortest time from now to a scheduled start
  duck: { to: 0.5, attack: 0.08, release: 0.3 },
  foundMax: 2, // Found chimes that can wait (LANDMARKS.banner.foundQueueMax)
};

// The length of a chime (s): the end of its last sound.
export function chimeLength(type, k = CHIMES) {
  const c = k[type];
  if (!c) return 0;
  const ends = c.notes.map((n) => n.at + n.length);
  if (c.wheel) ends.push(c.wheel.at + c.wheel.length);
  return Math.max(...ends);
}

// When a chime starts, on the audio clock. `now` is the audio time now,
// `startTime` the audio time of beat 0 and `bpm` the tempo of the beat
// clock. Returns { at, delay, onGrid }. With the clock off (`running`
// false) the chime starts at once. The start is the next beat or half beat
// at least `lead` away, so the delay is under 1 beat; before beat 0 (the
// clock has just started) the chime also starts at once.
export function chimeStart({ now, startTime = 0, bpm = 0, running = true }, k = CHIMES) {
  if (!running || !(bpm > 0) || now + k.lead < startTime) return { at: now, delay: 0, onGrid: false };
  const step = 60 / bpm / k.division;
  const n = Math.ceil((now + k.lead - startTime) / step - 1e-9);
  const at = startTime + Math.max(0, n) * step;
  return { at, delay: at - now, onGrid: true };
}

// The music gain around a chime that starts at `at` and lasts `length`:
// the points [{ t, value }] of a line through time. `base` is the gain of
// the music. The gain is at `base * to` when the chime starts.
export function duckPoints(at, length, base, now = at, k = CHIMES) {
  const down = Math.max(now, at - k.duck.attack);
  return [
    { t: down, value: base },
    { t: Math.max(down, at), value: base * k.duck.to },
    { t: at + length, value: base * k.duck.to },
    { t: at + length + k.duck.release, value: base },
  ];
}

// The chimes that wait, in play order: Claimed before Found, then the
// order they came in. At most `foundMax` Found chimes wait, as the Found
// banners (a third Found banner is dropped, so its chime is too). Returns a
// new list.
export function queueChime(queue, type, foundMax = CHIMES.foundMax) {
  if (type !== "claimed") return queue.filter((t) => t !== "claimed").length >= foundMax ? queue : [...queue, type];
  const at = queue.findIndex((t) => t !== "claimed");
  return at < 0 ? [...queue, type] : [...queue.slice(0, at), type, ...queue.slice(at)];
}
