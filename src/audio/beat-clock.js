// Web Audio beat clock. A rewrite of the beat-lock prototype's idea: one
// audio clock, clicks scheduled ahead on audioContext.currentTime, and an
// anchor pair refreshed every scheduler tick that maps DOM timestamps onto
// the audio clock. Synthesized 4/4 click at 100 BPM; music comes in M2.
// The beat never gates input; it only tags moves and pays a bonus.

import { BEAT } from "../sim/skate/constants.js";
import { beatLength, inputTime, judge, phase } from "./beat-math.js";

export class BeatClock {
  constructor({ bpm = BEAT.bpm, k = BEAT, audioContextFactory = null } = {}) {
    this.bpm = bpm;
    this.k = k;
    this.ctx = null;
    this.startTime = 0;
    this.nextBeatTime = 0;
    this.nextBeatIndex = 0;
    this.userOffsetMs = 0;
    this.anchor = { perf: 0, audio: 0 };
    this.timer = null;
    this.noise = null;
    this.muted = false;
    this.factory = audioContextFactory ?? (() => new (window.AudioContext || window.webkitAudioContext)());
  }

  get beatLen() {
    return beatLength(this.bpm);
  }

  // Running means the audio clock moves. A context made before a user
  // gesture stays "suspended", and its currentTime does not advance.
  get running() {
    return Boolean(this.ctx) && this.ctx.state === "running";
  }

  // Safe to call on every gesture: the first call makes the context and the
  // scheduler, every call asks the browser to resume it.
  async start() {
    if (!this.ctx) {
      this.ctx = this.factory();
      this.noise = this.makeNoise();
      this.startTime = this.ctx.currentTime + this.k.startDelaySec;
      this.nextBeatTime = this.startTime;
      this.nextBeatIndex = 0;
      this.schedule();
      this.timer = setInterval(() => this.schedule(), this.k.schedulerMs);
    }
    await this.ctx.resume();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.ctx) this.ctx.close();
    this.ctx = null;
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
    this.anchor = { perf: performance.now(), audio: c.currentTime };
    while (this.nextBeatTime < c.currentTime + this.k.scheduleAheadSec) {
      const accent = this.nextBeatIndex % 4 === 0;
      if (!this.muted) {
        this.kick(this.nextBeatTime, accent);
        this.hat(this.nextBeatTime + this.beatLen / 2);
      }
      this.nextBeatTime += this.beatLen;
      this.nextBeatIndex += 1;
    }
  }

  // Seconds since beat 0 (perceived) for a DOM event timestamp.
  inputTime(domTimeStamp) {
    return inputTime(domTimeStamp, this.anchor, this.startTime, this.totalOffsetSec);
  }

  // Seconds since beat 0 right now (perceived).
  now() {
    if (!this.ctx) return 0;
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
