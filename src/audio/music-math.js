// Pure music timing math for the beat clock. No Web Audio here.
//
// A track (assets/music/tracks.json) is an audio file whose bar lines sit on
// a fixed grid: `firstDownbeat` seconds into the file is beat 0, every beat
// is 60 / bpm seconds, and [loopStart, loopEnd) is a whole number of bars
// that repeats with no gap. Beat time t (seconds since beat 0, the same t the
// judge uses) maps to one position in the file.

export const barLength = (bpm) => 240 / bpm;

// Times within EPS of a bar line count as on it (float round-off).
const EPS = 1e-9;

// The file position (seconds) that plays at beat time t >= 0.
export function trackPosition(t, track) {
  const pos = track.firstDownbeat + Math.max(0, t);
  if (pos < track.loopEnd - EPS) return pos;
  const len = track.loopEnd - track.loopStart;
  let into = (pos - track.loopStart) % len;
  if (len - into < EPS) into = 0;
  return track.loopStart + into;
}

// The first bar line at or after beat time t (seconds since beat 0).
export function nextBarTime(t, bpm) {
  const bar = barLength(bpm);
  return Math.max(0, Math.ceil(t / bar - EPS) * bar);
}

// Problems with a track entry, as strings; [] means the beat clock can use it.
// `sampleRate` sets the tolerance (one sample) for the loop length.
export function trackErrors(track, sampleRate = 48000) {
  const errors = [];
  const need = ["id", "title", "file", "bpm", "firstDownbeat", "bars", "loopStart", "loopEnd", "license"];
  for (const k of need) if (track[k] === undefined || track[k] === null || track[k] === "") errors.push(`missing ${k}`);
  if (errors.length) return errors;
  if (!(track.bpm >= 60 && track.bpm <= 200)) errors.push(`bpm ${track.bpm} out of range`);
  if (!Number.isInteger(track.bars) || track.bars < 1) errors.push(`bars ${track.bars} is not a whole number`);
  const tol = 1 / sampleRate;
  const bar = barLength(track.bpm);
  const len = track.loopEnd - track.loopStart;
  if (Math.abs(len - track.bars * bar) > tol) errors.push(`loop is ${len} s, not ${track.bars} bars (${track.bars * bar} s)`);
  if (track.loopStart < track.firstDownbeat - tol) errors.push("loopStart is before the first downbeat");
  const k = (track.loopStart - track.firstDownbeat) / bar;
  if (Math.abs(k - Math.round(k)) * bar > tol) errors.push("loopStart is not on a bar line");
  return errors;
}

// The track to play: the stored choice when it exists, else the first one.
// `null` (no tracks, or the stored choice is "click") plays the click.
export function pickTrack(tracks, id) {
  if (!tracks.length || id === CLICK_ID) return null;
  return tracks.find((t) => t.id === id) ?? tracks[0];
}

export const CLICK_ID = "click";

// A switch to a new grid at the next bar line of the old one, so no beat is
// cut short: returns the audio-clock time of the switch.
export function switchTime(audioNow, startTime, bpm, minLeadSec = 0) {
  const t = audioNow + minLeadSec - startTime;
  return startTime + nextBarTime(t, bpm);
}
