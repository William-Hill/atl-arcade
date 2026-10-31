// PROTOTYPE - NOT FOR PRODUCTION
// Question: Does pushing on the beat in the browser feel locked to the music?
// Date: 2026-10-30
//
// One Web Audio clock. Beats are scheduled ahead on audioContext.currentTime.
// Input events (DOM timeStamp, performance.now() origin) are mapped onto the
// audio clock through an anchor pair that the scheduler refreshes every tick.

export class BeatClock {
  constructor({ bpm = 100 } = {}) {
    this.bpm = bpm;
    this.ctx = null;
    this.startTime = 0;
    this.nextBeatTime = 0;
    this.nextBeatIndex = 0;
    this.userOffsetMs = 0;
    this.anchor = { perf: 0, audio: 0 };
    this.timer = null;
    this.noise = null;
  }

  get beatLen() {
    return 60 / this.bpm;
  }

  get running() {
    return Boolean(this.ctx);
  }

  start() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx.resume();
    this.noise = this.makeNoise();
    this.startTime = this.ctx.currentTime + 0.25;
    this.nextBeatTime = this.startTime;
    this.nextBeatIndex = 0;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  setBpm(bpm) {
    // Re-anchor so beat 0 stays at startTime; future beats use the new length.
    const elapsedBeats = this.nextBeatIndex;
    this.bpm = bpm;
    this.nextBeatTime = this.startTime + elapsedBeats * this.beatLen;
  }

  // Output latency: the sound reaches the ear later than the scheduled time.
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
    this.anchor = { perf: performance.now(), audio: c.currentTime };
    while (this.nextBeatTime < c.currentTime + 0.15) {
      const accent = this.nextBeatIndex % 4 === 0;
      this.kick(this.nextBeatTime, accent);
      this.hat(this.nextBeatTime + this.beatLen / 2);
      this.nextBeatTime += this.beatLen;
      this.nextBeatIndex += 1;
    }
  }

  // Audio-clock time of an input event, in seconds since beat 0, corrected for
  // output latency and the user calibration offset.
  inputTime(domTimeStamp) {
    const audio = this.anchor.audio + (domTimeStamp - this.anchor.perf) / 1000;
    return audio - this.startTime - this.totalOffsetSec;
  }

  // Seconds since beat 0 right now (perceived).
  now() {
    return this.ctx.currentTime - this.startTime - this.totalOffsetSec;
  }

  // Nearest beat to a time, and the signed offset in ms (positive = late).
  judge(t) {
    const index = Math.round(t / this.beatLen);
    const offsetMs = (t - index * this.beatLen) * 1000;
    return { index, offsetMs };
  }

  phase() {
    const t = this.now();
    const p = (t / this.beatLen) % 1;
    return p < 0 ? p + 1 : p;
  }

  kick(time, accent) {
    const c = this.ctx;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(accent ? 180 : 150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    gain.gain.setValueAtTime(accent ? 1.0 : 0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    osc.connect(gain).connect(c.destination);
    osc.start(time);
    osc.stop(time + 0.2);
    if (accent) {
      const click = c.createOscillator();
      const cg = c.createGain();
      click.type = "square";
      click.frequency.setValueAtTime(1200, time);
      cg.gain.setValueAtTime(0.15, time);
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
    g.gain.setValueAtTime(0.12, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.connect(hp).connect(g).connect(c.destination);
    src.start(time);
    src.stop(time + 0.05);
  }

  makeNoise() {
    const c = this.ctx;
    const buf = c.createBuffer(1, c.sampleRate * 0.1, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    return buf;
  }
}
