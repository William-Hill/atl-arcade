import { describe, expect, it } from "vitest";
import { BEAT } from "../sim/skate/constants.js";
import { beatLength, beatPerfTime, envelopeAnchor, inputTime, judge, mean, phase, stddev } from "./beat-math.js";

describe("judge", () => {
  const len = beatLength(100); // 0.6 s

  it("tags an exact beat PERFECT with zero offset", () => {
    expect(judge(len * 4)).toEqual({ index: 4, offsetMs: 0, tag: "PERFECT", onBeat: true });
  });

  it("tags within the windows and signs late and early", () => {
    expect(judge(len * 2 + 0.015)).toMatchObject({ index: 2, tag: "PERFECT", onBeat: true });
    expect(judge(len * 2 + 0.05)).toMatchObject({ index: 2, tag: "GOOD", onBeat: true });
    expect(judge(len * 2 - 0.05)).toMatchObject({ index: 2, tag: "GOOD", onBeat: true });
    expect(judge(len * 2 + 0.05).offsetMs).toBeCloseTo(50);
    expect(judge(len * 2 - 0.05).offsetMs).toBeCloseTo(-50);
  });

  it("is off the beat past the GOOD window", () => {
    const r = judge(len * 3 + 0.1);
    expect(r.tag).toBeNull();
    expect(r.onBeat).toBe(false);
    expect(r.offsetMs).toBeCloseTo(100);
  });

  it("rounds to the nearest beat", () => {
    expect(judge(len * 5.4).index).toBe(5);
    expect(judge(len * 5.6).index).toBe(6);
  });

  it("uses the configured windows", () => {
    expect(judge(0.03, 100, { ...BEAT, perfectMs: 40 }).tag).toBe("PERFECT");
  });
});

describe("anchor mapping", () => {
  const anchor = { perf: 1000, audio: 5.0 };
  const startTime = 4.0;

  it("maps a DOM timestamp onto the audio clock", () => {
    expect(inputTime(1200, anchor, startTime)).toBeCloseTo(1.2);
    expect(inputTime(1200, anchor, startTime, 0.01)).toBeCloseTo(1.19);
    expect(inputTime(900, anchor, startTime)).toBeCloseTo(0.9);
  });

  it("round-trips through beatPerfTime", () => {
    for (let i = 0; i < 32; i += 1) {
      const ts = beatPerfTime(i, 100, anchor, startTime, 0.02);
      const r = judge(inputTime(ts, anchor, startTime, 0.02), 100);
      expect(r.index).toBe(i);
      expect(Math.abs(r.offsetMs)).toBeLessThan(1e-6);
    }
  });

  it("takes the freshest reading of a clock that updates in chunks (envelopeAnchor)", () => {
    // True audio time = perf / 1000 + 2; currentTime updates every 21.3 ms.
    const chunk = 1024 / 48000;
    const samples = [];
    for (let perf = 1000; perf <= 1500; perf += 25 + (perf % 7)) {
      const truth = perf / 1000 + 2;
      samples.push({ perf, audio: Math.floor(truth / chunk) * chunk });
    }
    const a = envelopeAnchor(samples);
    const last = samples[samples.length - 1];
    expect(a.perf).toBe(last.perf);
    expect(Math.abs(a.audio - (last.perf / 1000 + 2))).toBeLessThan(0.002);
    // A single reading is late by up to one chunk.
    expect(last.perf / 1000 + 2 - last.audio).toBeGreaterThanOrEqual(0);
    expect(envelopeAnchor([{ perf: 10, audio: 3 }])).toEqual({ perf: 10, audio: 3 });
  });

  it("gives the beat phase in 0..1", () => {
    expect(phase(0)).toBe(0);
    expect(phase(0.3)).toBeCloseTo(0.5);
    expect(phase(-0.15)).toBeCloseTo(0.75);
  });
});

describe("statistics", () => {
  it("computes mean and sample standard deviation", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(stddev([1])).toBe(0);
    expect(mean([])).toBe(0);
  });
});
