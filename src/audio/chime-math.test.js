import { describe, expect, it } from "vitest";
import { CHIMES, chimeLength, chimeStart, duckPoints, queueChime } from "./chime-math.js";

describe("the chimes", () => {
  it("has a Found chime of 2 rising notes, under 0.4 s", () => {
    const n = CHIMES.found.notes;
    expect(n).toHaveLength(2);
    expect(n[1].freq).toBeGreaterThan(n[0].freq);
    expect(n[1].at).toBeGreaterThan(n[0].at);
    expect(CHIMES.found.wheel).toBeNull();
    expect(chimeLength("found")).toBeLessThan(0.4);
  });

  it("has a Claimed chime of a 3-note major arpeggio and a short wheel sound, under 0.9 s", () => {
    const n = CHIMES.claimed.notes;
    expect(n).toHaveLength(3);
    // A major triad: 4 and 7 semitones over the root.
    const semis = (f) => Math.round(12 * Math.log2(f / n[0].freq));
    expect(n.map((x) => semis(x.freq))).toEqual([0, 4, 7]);
    expect(n[0].at).toBeLessThan(n[1].at);
    expect(n[1].at).toBeLessThan(n[2].at);
    expect(CHIMES.claimed.wheel.length).toBeLessThanOrEqual(0.5);
    expect(chimeLength("claimed")).toBeLessThan(0.9);
    expect(chimeLength("claimed")).toBeGreaterThan(chimeLength("found"));
  });

  it("is soft: no note is louder than the kick of the click", () => {
    for (const type of ["found", "claimed"]) for (const n of CHIMES[type].notes) expect(n.gain).toBeLessThanOrEqual(0.25);
  });
});

describe("the start of a chime", () => {
  const bpm = 120; // a beat is 0.5 s, a half beat 0.25 s

  it("is the next beat or half beat, less than 1 beat away", () => {
    expect(chimeStart({ now: 10.1, startTime: 10, bpm })).toMatchObject({ onGrid: true });
    expect(chimeStart({ now: 10.1, startTime: 10, bpm }).at).toBeCloseTo(10.25, 9);
    expect(chimeStart({ now: 10.3, startTime: 10, bpm }).at).toBeCloseTo(10.5, 9);
    expect(chimeStart({ now: 10.5, startTime: 10, bpm }).at).toBeCloseTo(10.75, 9);
    for (let i = 0; i < 400; i += 1) {
      const now = 3 + i * 0.0137;
      const s = chimeStart({ now, startTime: 1.234, bpm: 97 });
      expect(s.delay).toBeGreaterThanOrEqual(CHIMES.lead - 1e-9);
      expect(s.delay).toBeLessThan(60 / 97);
      // On the grid of half beats from beat 0.
      const steps = (s.at - 1.234) / (60 / 97 / 2);
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    }
  });

  it("is at once when the clock is off", () => {
    expect(chimeStart({ now: 7.31, startTime: 0, bpm, running: false })).toEqual({ at: 7.31, delay: 0, onGrid: false });
    expect(chimeStart({ now: 7.31, startTime: 0, bpm: 0 })).toEqual({ at: 7.31, delay: 0, onGrid: false });
  });

  it("is at once before beat 0", () => {
    expect(chimeStart({ now: 0.02, startTime: 0.1, bpm })).toEqual({ at: 0.02, delay: 0, onGrid: false });
  });
});

describe("the music duck", () => {
  it("goes to half the gain in 80 ms, holds for the chime, and returns in 300 ms", () => {
    const p = duckPoints(10, 0.38, 0.8, 9.5);
    expect(p).toHaveLength(4);
    expect(p[0].t).toBeCloseTo(9.92, 9);
    expect(p[0].value).toBe(0.8);
    expect(p[1]).toEqual({ t: 10, value: 0.4 });
    expect(p[2].t).toBeCloseTo(10.38, 9);
    expect(p[2].value).toBe(0.4);
    expect(p[3].t).toBeCloseTo(10.68, 9);
    expect(p[3].value).toBe(0.8);
  });

  it("starts the fall now when the chime is less than 80 ms away, and never in the past", () => {
    const p = duckPoints(10, 0.38, 0.8, 9.98);
    expect(p[0].t).toBe(9.98);
    expect(p[1].t).toBe(10);
    const now = duckPoints(10, 0.38, 0.8, 10);
    expect(now[0].t).toBe(10);
    expect(now[1].t).toBe(10);
  });
});

describe("one chime at a time", () => {
  it("keeps 2 Found chimes that wait at most, as the Found banners, and never drops a Claimed chime", () => {
    let q = [];
    for (let i = 0; i < 5; i += 1) q = queueChime(q, "found");
    expect(q).toEqual(["found", "found"]);
    for (let i = 0; i < 3; i += 1) q = queueChime(q, "claimed");
    expect(q).toEqual(["claimed", "claimed", "claimed", "found", "found"]);
  });

  it("plays a Claimed chime before a Found chime that waits", () => {
    let q = queueChime([], "found");
    q = queueChime(q, "found");
    q = queueChime(q, "claimed");
    expect(q).toEqual(["claimed", "found", "found"]);
    expect(queueChime(q, "claimed")).toEqual(["claimed", "claimed", "found", "found"]);
  });
});
