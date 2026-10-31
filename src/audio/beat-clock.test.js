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
