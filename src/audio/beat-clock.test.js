import { afterEach, describe, expect, it } from "vitest";
import { BeatClock } from "./beat-clock.js";

// A fake AudioContext. Like Chrome without a user gesture, the first
// resume() resolves but leaves the context suspended; a later one runs it.
function fakeContext({ unlockOnCall = 2 } = {}) {
  let calls = 0;
  return {
    state: "suspended",
    currentTime: 0,
    sampleRate: 48000,
    outputLatency: 0,
    baseLatency: 0,
    resume() {
      calls += 1;
      if (calls >= unlockOnCall) this.state = "running";
      return Promise.resolve();
    },
    close() {
      this.state = "closed";
      return Promise.resolve();
    },
    createBuffer: (ch, n) => ({ getChannelData: () => new Float32Array(n) }),
  };
}

let clock = null;
afterEach(() => {
  if (clock) clock.stop();
  clock = null;
});

describe("BeatClock start", () => {
  it("is not running while the audio context stays suspended", async () => {
    const ctx = fakeContext();
    clock = new BeatClock({ audioContextFactory: () => ctx });
    clock.muted = true;
    await clock.start();
    expect(ctx.state).toBe("suspended");
    expect(clock.running).toBe(false);
    expect(clock.judgeNow()).toBeNull();
  });

  it("resumes the same context on a later start and then runs", async () => {
    const ctx = fakeContext();
    let made = 0;
    clock = new BeatClock({ audioContextFactory: () => { made += 1; return ctx; } });
    clock.muted = true;
    await clock.start();
    await clock.start();
    expect(made).toBe(1);
    expect(clock.running).toBe(true);
  });
});

// A fake context that records the music source it plays.
function musicContext() {
  const sources = [];
  const node = () => ({ connect: (n) => n ?? node(), gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} } });
  const ctx = {
    ...fakeContext({ unlockOnCall: 1 }),
    destination: {},
    sources,
    decodeAudioData: (data) => Promise.resolve({ duration: 60, bytes: data.byteLength }),
    createGain: node,
    createBufferSource() {
      const s = { ...node(), started: null, stopped: null, start(when, offset) { this.started = { when, offset }; }, stop(when) { this.stopped = when ?? 0; } };
      sources.push(s);
      return s;
    },
    createOscillator: () => ({ ...node(), type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, start() {}, stop() {} }),
    createBiquadFilter: () => ({ ...node(), type: "", frequency: { value: 0 } }),
  };
  return ctx;
}

const TRACKS = [
  { id: "day", title: "Day", file: "day.ogg", bpm: 100, firstDownbeat: 0, bars: 24, loopStart: 0, loopEnd: 57.6, license: "MIT" },
  { id: "house", title: "House", file: "house.ogg", bpm: 125, firstDownbeat: 0, bars: 32, loopStart: 0, loopEnd: 61.44, license: "MIT" },
];

describe("BeatClock with a music track", () => {
  it("takes the BPM from the track and starts the music with its first downbeat on beat 0", async () => {
    const ctx = musicContext();
    let loads = 0;
    clock = new BeatClock({ audioContextFactory: () => ctx, tracks: TRACKS, trackId: "house", loadTrack: async () => { loads += 1; return new ArrayBuffer(8); } });
    expect(clock.bpm).toBe(125);
    await clock.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(loads).toBe(1);
    expect(clock.musicState).toBe("playing");
    const music = ctx.sources.find((s) => s.loop);
    expect(music.started.when).toBeCloseTo(clock.startTime, 9);
    expect(music.started.offset).toBe(0);
    expect(music.loopStart).toBe(0);
    expect(music.loopEnd).toBe(61.44);
    expect(clock.sched.click).toBe(false);
  });

  it("joins on the next bar line when the decode ends after beat 0", async () => {
    const ctx = musicContext();
    let release;
    clock = new BeatClock({ audioContextFactory: () => ctx, tracks: TRACKS, trackId: "day", loadTrack: () => new Promise((r) => { release = r; }) });
    await clock.start();
    ctx.currentTime = clock.startTime + 3; // decode took longer than beat 0
    release(new ArrayBuffer(8));
    await new Promise((r) => setTimeout(r, 0));
    const music = ctx.sources.find((s) => s.loop);
    expect(music.started.when).toBeCloseTo(clock.startTime + 4.8, 9);
    expect(music.started.offset).toBeCloseTo(4.8, 9);
  });

  it("falls back to the click when the track fails to load", async () => {
    const ctx = musicContext();
    clock = new BeatClock({ audioContextFactory: () => ctx, tracks: TRACKS, trackId: "day", loadTrack: () => Promise.reject(new Error("404")) });
    await clock.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(clock.musicState).toBe("failed");
    expect(clock.sched.click).toBe(true);
    expect(clock.bpm).toBe(100);
  });

  it("plays only the click with no tracks (?music=0) and stays at 100 BPM", async () => {
    const ctx = musicContext();
    clock = new BeatClock({ audioContextFactory: () => ctx, tracks: [], loadTrack: async () => new ArrayBuffer(8) });
    await clock.start();
    expect(clock.musicState).toBe("off");
    expect(clock.sched.click).toBe(true);
    expect(ctx.sources.some((s) => s.loop)).toBe(false);
  });

  it("changes the track and the BPM on a bar line of the old grid", async () => {
    const ctx = musicContext();
    clock = new BeatClock({ audioContextFactory: () => ctx, tracks: TRACKS, trackId: "day", loadTrack: async () => new ArrayBuffer(8) });
    await clock.start();
    await new Promise((r) => setTimeout(r, 0));
    const old = ctx.sources.find((s) => s.loop);
    const start0 = clock.startTime;
    ctx.currentTime = start0 + 10; // bar 4 of the old grid is at 9.6 s, bar 5 at 12 s
    await clock.setTrack("house");
    const at = start0 + 12;
    expect(old.stopped).toBeCloseTo(at, 9);
    const fresh = ctx.sources.filter((s) => s.loop)[1];
    expect(fresh.started.when).toBeCloseTo(at, 9);
    expect(fresh.started.offset).toBe(0);
    // The judge keeps the old grid until the bar line, then beat 0 is there at 125 BPM.
    expect(clock.bpm).toBe(100);
    ctx.currentTime = at + 0.48;
    expect(clock.now()).toBeCloseTo(0.48, 9);
    expect(clock.bpm).toBe(125);
    expect(clock.judge(clock.now()).index).toBe(1);
  });

  it("records a choice made before start", async () => {
    clock = new BeatClock({ tracks: TRACKS, trackId: "day", loadTrack: async () => new ArrayBuffer(8) });
    await clock.setTrack("house");
    expect(clock.track.id).toBe("house");
    expect(clock.bpm).toBe(125);
    await clock.setTrack("click");
    expect(clock.track).toBeNull();
    expect(clock.bpm).toBe(100);
    clock = null;
  });
});
