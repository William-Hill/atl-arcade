// Web Audio beat clock. A rewrite of the beat-lock prototype's idea: one
// audio clock, sound scheduled ahead on audioContext.currentTime, and an
// anchor pair refreshed every scheduler tick that maps DOM timestamps onto
// the audio clock. The beat never gates input; it only tags moves and pays a
// bonus.
//
// With a music track (assets/music/tracks.json, #110) the clock plays the
// track on its own AudioContext, the track's first downbeat on beat 0, at
// the track's BPM. The synthesized 4/4 click is the fallback: it plays when
// there is no track (?music=0, or the "click" choice) or the track fails to
// load. The timing math is in beat-math.js and music-math.js.

import { BEAT } from "../sim/skate/constants.js";
import { beatLength, envelopeAnchor, inputTime, judge, phase } from "./beat-math.js";
import { pickTrack, switchTime, trackPosition } from "./music-math.js";

// Seconds between the end of a decode or a track change and the bar line
// the new music starts on, so the start is never in the past.
const MUSIC_LEAD_SEC = 0.1;

// The scheduler's clock readings kept for the anchor (envelopeAnchor).
const ANCHOR_WINDOW_MS = 500;

// The tracks are 48 kHz. A 48 kHz context decodes them with no resampling,
// so the loop points fall on exact samples; the browser resamples the output.
function defaultContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  try {
    return new Ctx({ sampleRate: 48000, latencyHint: "interactive" });
  } catch {
    return new Ctx();
  }
}

export class BeatClock {
  constructor({ bpm = BEAT.bpm, k = BEAT, audioContextFactory = null, tracks = [], trackId = null, loadTrack = null, musicGain = 0.8 } = {}) {
    this.k = k;
    this.ctx = null;
    this.startTime = 0;
    this.userOffsetMs = 0;
    this.anchor = { perf: 0, audio: 0 };
    this.anchorSamples = [];
    this.timer = null;
    this.noise = null;
    this.muted = false;
    this.factory = audioContextFactory ?? defaultContext;
    this.tracks = tracks;
    this.track = pickTrack(tracks, trackId);
    this.bpm = this.track ? this.track.bpm : bpm;
    this.clickBpm = bpm;
    this.loadTrack = loadTrack;
    this.musicGainValue = musicGain;
    // "off" (click), "loading", "playing", or "failed" (click again).
    this.musicState = "off";
    this.music = null; // { source, gain, track, at, offset } of the playing track
    this.buffers = new Map();
    this.pending = null; // a grid change at a bar line: { at, bpm }
    this.sched = null; // the scheduler's own grid: { time, index, bpm, click }
  }

  get beatLen() {
    return beatLength(this.bpm);
  }

  // Running means the audio clock moves. A context made before a user
  // gesture stays "suspended", and its currentTime does not advance.
  get running() {
    return Boolean(this.ctx) && this.ctx.state === "running";
  }

  get wantsMusic() {
    return Boolean(this.track) && !this.muted && Boolean(this.loadTrack);
  }

  // Fetches the chosen track's bytes before the first gesture, so start()
  // only has to decode. Safe to skip.
  preload() {
    if (this.wantsMusic) this.bytes(this.track).catch(() => {});
  }

  // Caches the fetch; a failed one is dropped so a later choice retries it.
  bytes(track) {
    let p = this.buffers.get(track.id);
    if (!p) {
      p = Promise.resolve().then(() => this.loadTrack(track));
      this.buffers.set(track.id, p);
      p.catch(() => {
        if (this.buffers.get(track.id) === p) this.buffers.delete(track.id);
      });
    }
    return p;
  }

  async decode(track) {
    const data = await this.bytes(track);
    // decodeAudioData detaches its input; keep the fetched copy for a later context.
    return this.ctx.decodeAudioData(data.slice(0));
  }

  // Safe to call on every gesture: the first call makes the context and the
  // scheduler, every call asks the browser to resume it.
  async start() {
    if (!this.ctx) {
      this.ctx = this.factory();
      this.noise = this.makeNoise();
      this.startTime = this.ctx.currentTime + this.k.startDelaySec;
      const music = this.wantsMusic;
      this.sched = { time: this.startTime, index: 0, bpm: this.bpm, click: !music };
      this.schedule();
      this.timer = setInterval(() => this.schedule(), this.k.schedulerMs);
      if (music) this.playTrack(this.track, this.startTime);
    }
    await this.ctx.resume();
  }

  // Decodes `track` and starts it at audio time `at`, or on the next bar
  // line when the decode ends after `at`. Falls back to the click on error.
  async playTrack(track, at) {
    this.musicState = "loading";
    let buffer;
    try {
      buffer = await this.decode(track);
    } catch (err) {
      if (this.track === track) this.fallBackToClick(err);
      return;
    }
    const c = this.ctx;
    if (!c || this.track !== track) return;
    const when = Math.max(at, switchTime(c.currentTime, this.startTime, this.bpm, MUSIC_LEAD_SEC));
    this.startSource(buffer, track, when, when - this.startTime);
  }

  startSource(buffer, track, when, beatTime) {
    const c = this.ctx;
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = track.loopStart;
    source.loopEnd = track.loopEnd;
    const gain = c.createGain();
    gain.gain.value = this.musicGainValue;
    source.connect(gain).connect(c.destination);
    const offset = trackPosition(beatTime, track);
    source.start(when, offset);
    this.music = { source, gain, track, at: when, offset };
    this.musicState = "playing";
  }

  fallBackToClick(err) {
    this.musicState = "failed";
    this.error = String(err);
    if (this.sched) {
      this.sched.click = true;
    }
  }

  // Changes the track (or `"click"`) at the next bar line. Before start()
  // it only records the choice. With a new BPM the grid changes at that bar
  // line too: beat 0 moves to it.
  async setTrack(id) {
    const next = pickTrack(this.tracks, id);
    if (next === this.track && this.musicState !== "failed") return;
    this.track = next;
    if (!this.ctx) {
      this.bpm = next ? next.bpm : this.clickBpm;
      return;
    }
    let buffer = null;
    let failed = null;
    if (next && this.wantsMusic) {
      this.musicState = "loading";
      try {
        buffer = await this.decode(next);
      } catch (err) {
        failed = err;
      }
      if (this.track !== next || !this.ctx) return;
    }
    const c = this.ctx;
    this.applyPending();
    const at = switchTime(c.currentTime, this.startTime, this.bpm, Math.max(MUSIC_LEAD_SEC, this.k.scheduleAheadSec));
    const bpm = next ? next.bpm : this.clickBpm;
    if (this.music) this.music.source.stop(at);
    this.music = null;
    this.pending = { at, bpm, click: !buffer };
    if (buffer) this.startSource(buffer, next, at, 0);
    else if (failed) {
      // The old music stops at the bar line and the click takes over there.
      this.musicState = "failed";
      this.error = String(failed);
    } else this.musicState = "off";
  }

  // The public grid (startTime, bpm) moves at the pending bar line.
  applyPending() {
    const p = this.pending;
    if (p && this.ctx && this.ctx.currentTime >= p.at) {
      this.schedulePending(p);
      this.startTime = p.at;
      this.bpm = p.bpm;
      this.pending = null;
    }
  }

  // Moves the click scheduler onto the pending grid. A late tick (stalled
  // main thread, throttled tab) skips the beats already in the past.
  schedulePending(p) {
    const s = this.sched;
    if (!s || p.scheduled) return;
    Object.assign(s, { time: p.at, index: 0, bpm: p.bpm, click: p.click });
    p.scheduled = true;
    const len = beatLength(s.bpm);
    const late = this.ctx.currentTime - s.time;
    if (late > 0) {
      const n = Math.ceil(late / len - 1e-9);
      s.time += n * len;
      s.index += n;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.music) {
      try {
        this.music.source.stop();
      } catch {
        /* not started */
      }
    }
    this.music = null;
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.anchorSamples = [];
  }

  get outputLatencySec() {
    const c = this.ctx;
    if (!c) return 0;
    return (c.outputLatency || 0) + (c.baseLatency || 0);
  }

  get totalOffsetSec() {
    return this.outputLatencySec + this.userOffsetMs / 1000;
  }

  schedule() {
    const c = this.ctx;
    if (!c) return;
    this.applyPending();
    const perf = performance.now();
    const samples = this.anchorSamples;
    const prev = samples[samples.length - 1];
    // A clock that has not moved yet (the output stream is still starting)
    // or that jumped back (a new context) starts the readings over.
    if (!prev || c.currentTime < prev.audio || c.currentTime === 0) samples.length = 0;
    samples.push({ perf, audio: c.currentTime });
    while (samples.length > 1 && perf - samples[0].perf > ANCHOR_WINDOW_MS) samples.shift();
    this.anchor = envelopeAnchor(samples);
    const s = this.sched;
    while (s.time < c.currentTime + this.k.scheduleAheadSec) {
      const p = this.pending;
      // The pending change is on a bar line of the old grid, at least one
      // schedule-ahead window away, so the loop lands on it exactly.
      if (p && !p.scheduled && s.time >= p.at - 1e-6) this.schedulePending(p);
      const len = beatLength(s.bpm);
      if (!this.muted && s.click) {
        this.kick(s.time, s.index % 4 === 0);
        this.hat(s.time + len / 2);
      }
      s.time += len;
      s.index += 1;
    }
  }

  // Seconds since beat 0 (perceived) for a DOM event timestamp.
  inputTime(domTimeStamp) {
    return inputTime(domTimeStamp, this.anchor, this.startTime, this.totalOffsetSec);
  }

  // Seconds since beat 0 right now (perceived).
  now() {
    if (!this.ctx) return 0;
    this.applyPending();
    return this.ctx.currentTime - this.startTime - this.totalOffsetSec;
  }

  judge(t) {
    return judge(t, this.bpm, this.k);
  }

  judgeNow() {
    if (!this.running || this.now() < 0) return null;
    return this.judge(this.now());
  }

  phase() {
    return this.ctx ? phase(this.now(), this.bpm) : 0;
  }

  kick(time, accent) {
    const c = this.ctx;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(accent ? 180 : 150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    gain.gain.setValueAtTime(accent ? 0.9 : 0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    osc.connect(gain).connect(c.destination);
    osc.start(time);
    osc.stop(time + 0.2);
    if (accent) {
      const click = c.createOscillator();
      const cg = c.createGain();
      click.type = "square";
      click.frequency.setValueAtTime(1200, time);
      cg.gain.setValueAtTime(0.12, time);
      cg.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
      click.connect(cg).connect(c.destination);
      click.start(time);
      click.stop(time + 0.04);
    }
  }

  hat(time) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.1, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.connect(hp).connect(g).connect(c.destination);
    src.start(time);
    src.stop(time + 0.05);
  }

  makeNoise() {
    const c = this.ctx;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.1), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    return buf;
  }
}
