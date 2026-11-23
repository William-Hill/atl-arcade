// The music files against the beat clock (#20). scripts/music/check_grid.py
// decodes each game file, plays 3 loops of it the way the beat clock does,
// and measures where the onsets fall against the grid in tracks.json; it
// writes reports/m2-music-grid.json. This test checks those numbers, the
// pure grid math for each track, and the CC0 license files.

import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BEAT } from "../sim/skate/constants.js";
import { beatLength, judge } from "./beat-math.js";
import { barLength, trackPosition } from "./music-math.js";
import { trackChoices } from "./music-tracks.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const meta = JSON.parse(read("assets/music/tracks.json"));
const report = JSON.parse(read("reports/m2-music-grid.json"));
const cc0 = JSON.parse(read("assets/music/cc0-sources.json"));
const LOOPS = 3;

describe("every track against the beat clock grid (reports/m2-music-grid.json)", () => {
  it("the report covers every track in tracks.json with the same BPM", () => {
    expect(report.tracks.map((r) => r.id)).toEqual(meta.tracks.map((t) => t.id));
    for (const r of report.tracks) expect(r.bpm).toBe(meta.tracks.find((t) => t.id === r.id).bpm);
  });

  for (const t of meta.tracks) {
    it(`${t.id}: the onsets of ${LOOPS} loops sit on the grid, inside the PERFECT window`, () => {
      const r = report.tracks.find((x) => x.id === t.id);
      expect(r.loops).toBe(LOOPS);
      expect(r.barsChecked).toBe(LOOPS * t.bars);
      // The offset of beat 0: the mean bar shift and the folded beat phase.
      expect(Math.abs(r.meanOffsetMs)).toBeLessThan(2);
      expect(Math.abs(r.foldPhaseMs)).toBeLessThan(5);
      // The BPM: no drift across the run, the loop wraps included.
      expect(Math.abs(r.driftMsPerBar)).toBeLessThan(0.1);
      expect(Math.abs(r.driftMsOverRun)).toBeLessThan(5);
      // No bar leaves the PERFECT window.
      expect(r.maxAbsOffsetMs).toBeLessThan(BEAT.perfectMs);
    });

    it(`${t.id}: every beat of ${LOOPS} loops judges PERFECT and every bar line maps to a bar line of the file`, () => {
      const beats = LOOPS * t.bars * 4;
      for (let i = 0; i < beats; i += 1) {
        const j = judge(i * beatLength(t.bpm), t.bpm);
        expect(j.index).toBe(i);
        expect(Math.abs(j.offsetMs)).toBeLessThan(1e-6);
        expect(j.tag).toBe("PERFECT");
      }
      const bar = barLength(t.bpm);
      for (let b = 0; b <= LOOPS * t.bars; b += 1) {
        const k = (trackPosition(b * bar, t) - t.firstDownbeat) / bar;
        // One sample at 48 kHz, in bars.
        expect(Math.abs(k - Math.round(k)) * bar).toBeLessThan(1 / meta.sampleRate);
      }
    });
  }
});

describe("the CC0 placeholder tracks (#20)", () => {
  it("are 4 tracks in tracks.json, after the ACE-Step tracks, each with an author", () => {
    expect(cc0.tracks).toHaveLength(4);
    const ids = cc0.tracks.map((s) => s.id);
    expect(meta.tracks.slice(-4).map((t) => t.id)).toEqual(ids);
    for (const s of cc0.tracks) expect(meta.tracks.find((t) => t.id === s.id).author).toBe(s.author);
  });

  it("have the CC0 1.0 legal code in assets/music", () => {
    const text = read("assets/music/CC0-1.0.txt");
    expect(text.startsWith("Creative Commons Legal Code\n\nCC0 1.0 Universal")).toBe(true);
    expect(text).toContain("Statement of Purpose");
  });

  for (const s of cc0.tracks) {
    it(`${s.id}: a license file names the source, the author and CC0`, () => {
      const t = meta.tracks.find((x) => x.id === s.id);
      expect(s.license).toBe("CC0-1.0");
      expect(s.sourcePage).toMatch(/^https:\/\/opengameart\.org\/content\//);
      const md = read(`assets/music/${s.id}.LICENSE.md`);
      for (const part of [s.title, s.author, s.authorUrl, s.sourcePage, s.sourceFile, s.sourceSha256, "CC0 1.0 Universal", "CC0-1.0.txt", t.file, t.fallback]) expect(md).toContain(part);
      expect(t.license).toContain("CC0 1.0");
      expect(t.license).toContain(`${s.id}.LICENSE.md`);
    });

    it(`${s.id}: the grid BPM is the measured tempo and the loop passed the drift check`, () => {
      const m = s.measured;
      const t = meta.tracks.find((x) => x.id === s.id);
      expect(t.bpm).toBe(m.gridBpm);
      expect(Math.abs(m.gridBpm - m.bestFitBpm) / m.bestFitBpm).toBeLessThan(1e-4);
      expect(Math.abs(m.driftMsPerBar)).toBeLessThan(2);
      expect(m.jitterMs).toBeLessThan(6);
      expect(s.loop.samples).toBe(Math.round(t.loopEnd * meta.sampleRate));
    });

    it(`${s.id}: both files are small for the web (under 1 MB)`, () => {
      for (const f of [`${s.id}.ogg`, `${s.id}.m4a`]) {
        const bytes = statSync(new URL(`../../assets/music/${f}`, import.meta.url)).size;
        expect(bytes).toBeLessThan(1024 * 1024);
        expect(bytes).toBe(s.encode[f].bytes);
      }
    });
  }
});

describe("trackChoices", () => {
  it("shows the author next to the title when the track has one", () => {
    const choices = trackChoices(meta.tracks);
    expect(choices.find((c) => c.id === "raspberry-jam").title).toBe("Raspberry Jam (congusbongus)");
    expect(choices.find((c) => c.id === "day-trail").title).toBe("Day Trail Bounce");
    expect(choices.at(-1).id).toBe("click");
  });
});
