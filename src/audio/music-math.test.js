import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLICK_ID, barLength, nextBarTime, pickTrack, switchTime, trackErrors, trackPosition } from "./music-math.js";

const track = { id: "a", title: "A", file: "a.ogg", bpm: 100, firstDownbeat: 0.5, bars: 2, loopStart: 0.5, loopEnd: 0.5 + 4.8, license: "x" };

describe("trackPosition", () => {
  it("puts beat 0 on the first downbeat", () => {
    expect(trackPosition(0, track)).toBeCloseTo(0.5, 12);
  });
  it("plays straight through until the loop end", () => {
    expect(trackPosition(4.7, track)).toBeCloseTo(5.2, 12);
  });
  it("wraps to the loop start on a bar line, so every bar line maps to a bar line", () => {
    for (let bar = 0; bar < 50; bar += 1) {
      const p = trackPosition(bar * barLength(100), track);
      const k = (p - track.firstDownbeat) / barLength(100);
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }
    expect(trackPosition(4.8, track)).toBeCloseTo(0.5, 9);
    expect(trackPosition(4.8 * 3 + 0.6, track)).toBeCloseTo(1.1, 9);
  });
  it("keeps zero drift over 3 loops: beat n always lands on beat n mod (4 * bars)", () => {
    const beat = 60 / track.bpm;
    for (let n = 0; n < 3 * 4 * track.bars + 1; n += 1) {
      const p = trackPosition(n * beat, track);
      expect(p).toBeCloseTo(track.firstDownbeat + (n % (4 * track.bars)) * beat, 9);
    }
  });
  it("handles a loop that starts after an intro", () => {
    const intro = { ...track, loopStart: 0.5 + 2.4, loopEnd: 0.5 + 2.4 + 4.8 };
    expect(trackPosition(2.4 + 4.8, intro)).toBeCloseTo(2.9, 9);
    expect(trackPosition(2.4 + 4.8 + 1, intro)).toBeCloseTo(3.9, 9);
  });
});

describe("nextBarTime and switchTime", () => {
  it("rounds up to the bar line, and keeps a bar line", () => {
    expect(nextBarTime(0, 100)).toBe(0);
    expect(nextBarTime(0.1, 100)).toBeCloseTo(2.4, 12);
    expect(nextBarTime(2.4, 100)).toBeCloseTo(2.4, 12);
    expect(nextBarTime(2.41, 120)).toBeCloseTo(4, 12);
  });
  it("switches on the next bar line of the old grid after the lead time", () => {
    expect(switchTime(10, 1, 100)).toBeCloseTo(1 + 4 * 2.4, 9);
    expect(switchTime(10, 1, 100, 0.5)).toBeCloseTo(1 + 4 * 2.4, 9);
    expect(switchTime(10.5, 1, 100, 0.2)).toBeCloseTo(1 + 5 * 2.4, 9);
  });
});

describe("trackErrors", () => {
  it("accepts a whole-bar loop", () => {
    expect(trackErrors(track)).toEqual([]);
  });
  it("rejects a loop that is not a whole number of bars, or off the bar line", () => {
    expect(trackErrors({ ...track, loopEnd: track.loopEnd + 0.01 }).join()).toMatch(/not 2 bars/);
    expect(trackErrors({ ...track, loopStart: 0.6, loopEnd: 5.4 }).join()).toMatch(/bar line/);
    expect(trackErrors({ ...track, bpm: undefined }).join()).toMatch(/missing bpm/);
  });
});

describe("pickTrack", () => {
  const tracks = [track, { ...track, id: "b" }];
  it("keeps the stored choice, falls back to the first track, and plays the click on request", () => {
    expect(pickTrack(tracks, "b").id).toBe("b");
    expect(pickTrack(tracks, "gone").id).toBe("a");
    expect(pickTrack(tracks, null).id).toBe("a");
    expect(pickTrack(tracks, CLICK_ID)).toBeNull();
    expect(pickTrack([], "a")).toBeNull();
  });
});

describe("assets/music/tracks.json", () => {
  const meta = JSON.parse(readFileSync(new URL("../../assets/music/tracks.json", import.meta.url), "utf8"));
  it("has four valid tracks, each loop a whole number of bars at 48 kHz", () => {
    expect(meta.tracks.length).toBe(4);
    for (const t of meta.tracks) {
      expect(trackErrors(t, meta.sampleRate)).toEqual([]);
      const samples = (t.loopEnd - t.loopStart) * meta.sampleRate;
      expect(Math.abs(samples - Math.round(samples))).toBeLessThan(1e-6);
    }
    expect(new Set(meta.tracks.map((t) => t.id)).size).toBe(4);
  });
  it("names an existing file and fallback for every track", () => {
    for (const t of meta.tracks) {
      for (const f of [t.file, t.fallback]) readFileSync(new URL(`../../assets/music/${f}`, import.meta.url));
    }
  });
});
