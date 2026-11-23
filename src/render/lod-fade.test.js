import { describe, expect, it } from "vitest";
import { DITHER_FULL, FADE_NONE, FADE_REVERSE, FADE_SNAP, FADE_START, LOD_FADE_COPIES, LOD_FADE_SECONDS, cameraJumped, createLodFade, ditherIn, ditherOut, fadeCopies, fadeDraw, lodFadeOn } from "./lod-fade.js";

const D = LOD_FADE_SECONDS;

// A fade state of one instance that shows `lod` with no fade (as after the
// first frame).
function settled(lod, opts) {
  const f = createLodFade(1, opts);
  f.set(0, lod, 0);
  return f;
}

describe("createLodFade", () => {
  it("does not fade on the first frame", () => {
    const f = createLodFade(3);
    expect(f.set(0, 0, 10)).toBe(FADE_SNAP);
    expect(f.set(1, 1, 10)).toBe(FADE_SNAP);
    expect(f.set(2, -1, 10)).toBe(FADE_SNAP);
    expect(f.active).toBe(0);
    expect(f.fading(0)).toBe(false);
    expect(f.progress(0, 10)).toBe(1);
  });

  it("starts a fade at the switch and ends it after the fade time", () => {
    const f = settled(0);
    expect(f.set(0, 1, 5)).toBe(FADE_START);
    expect(f.active).toBe(1);
    expect(f.fading(0)).toBe(true);
    expect(f.from[0]).toBe(0);
    expect(f.lod[0]).toBe(1);
    expect(f.progress(0, 5)).toBe(0);
    expect(f.progress(0, 5 + D / 2)).toBeCloseTo(0.5);
    const ended = [];
    expect(f.step(5 + D / 2, (i) => ended.push(i))).toBe(1);
    expect(ended).toEqual([]);
    expect(f.step(5 + D, (i) => ended.push(i))).toBe(0);
    expect(ended).toEqual([0]);
    expect(f.fading(0)).toBe(false);
    expect(f.from[0]).toBe(1);
    expect(f.progress(0, 6)).toBe(1);
  });

  it("does nothing when the LOD does not change", () => {
    const f = settled(1);
    expect(f.set(0, 1, 1)).toBe(FADE_NONE);
    expect(f.active).toBe(0);
  });

  it("fades out at a hide", () => {
    const f = settled(1);
    expect(f.set(0, -1, 2)).toBe(FADE_START);
    const d = fadeDraw(f.from[0], f.lod[0], f.progress(0, 2 + D * 0.25));
    expect(d.copy).toBe(null);
    expect(d.main.lod).toBe(1);
    expect(d.main.dither).toBeCloseTo(ditherOut(0.25));
    f.step(2 + D);
    expect(fadeDraw(f.from[0], f.lod[0], f.progress(0, 3))).toEqual({ main: { lod: -1, dither: DITHER_FULL }, copy: null });
  });

  it("fades in at a show", () => {
    const f = settled(-1);
    expect(f.set(0, 1, 2)).toBe(FADE_START);
    const d = fadeDraw(f.from[0], f.lod[0], f.progress(0, 2 + D * 0.75));
    expect(d.copy).toBe(null);
    expect(d.main.lod).toBe(1);
    expect(d.main.dither).toBeCloseTo(ditherIn(0.75));
    f.step(2 + D);
    expect(fadeDraw(f.from[0], f.lod[0], 1)).toEqual({ main: { lod: 1, dither: DITHER_FULL }, copy: null });
  });

  it("turns a fade around at a switch back in the middle of the fade", () => {
    const f = settled(0);
    f.set(0, 1, 0);
    // 30% of the way from LOD0 to LOD1, the camera comes back.
    expect(f.set(0, 0, D * 0.3)).toBe(FADE_REVERSE);
    expect(f.from[0]).toBe(1);
    expect(f.lod[0]).toBe(0);
    // The mix continues: 70% of LOD0 now, so the fade back is 70% done.
    expect(f.progress(0, D * 0.3)).toBeCloseTo(0.7);
    expect(f.active).toBe(1);
    expect(f.step(D * 0.6 - 1e-6)).toBe(1);
    expect(f.step(D * 0.6 + 1e-6)).toBe(0);
    expect(f.fading(0)).toBe(false);
    expect(f.lod[0]).toBe(0);
  });

  it("keeps each pixel on the same shape at a switch back", () => {
    // The shader rule: in, a pixel draws when t < d; out, when t >= d - 2.
    const draws = (d, t) => (d < 1 ? t < d : d > 1.5 ? t >= d - 2 : true);
    const pixels = (draw) => {
      const out = [];
      for (let k = 0; k < 16; k += 1) {
        const t = (k + 0.5) / 16;
        out.push(draw.copy && draws(draw.copy.dither, t) ? draw.copy.lod : draws(draw.main.dither, t) ? draw.main.lod : -1);
      }
      return out;
    };
    for (const [a, b] of [[0, 1], [1, -1], [-1, 1]]) {
      const f = settled(a);
      f.set(0, b, 0);
      const before = pixels(fadeDraw(f.from[0], f.lod[0], f.progress(0, D * 0.4), f.flip[0] === 1));
      f.set(0, a, D * 0.4);
      expect(f.flip[0]).toBe(1);
      const after = pixels(fadeDraw(f.from[0], f.lod[0], f.progress(0, D * 0.4), f.flip[0] === 1));
      expect(after).toEqual(before);
      // A second switch back keeps the pixels too.
      const before2 = pixels(fadeDraw(f.from[0], f.lod[0], f.progress(0, D * 0.5), f.flip[0] === 1));
      f.set(0, b, D * 0.5);
      expect(f.flip[0]).toBe(0);
      const after2 = pixels(fadeDraw(f.from[0], f.lod[0], f.progress(0, D * 0.5), f.flip[0] === 1));
      expect(after2).toEqual(before2);
    }
  });

  it("restarts from the LOD now at a switch to a third LOD", () => {
    const f = settled(0);
    f.set(0, 1, 0);
    expect(f.set(0, -1, D / 2)).toBe(FADE_START);
    expect(f.from[0]).toBe(1);
    expect(f.progress(0, D / 2)).toBe(0);
    expect(f.active).toBe(1);
  });

  it("makes a hard switch with snap (a teleport) and ends the fade", () => {
    const f = settled(0);
    f.set(0, 1, 0);
    expect(f.set(0, 0, 0.1, true)).toBe(FADE_SNAP);
    expect(f.active).toBe(0);
    expect(f.fading(0)).toBe(false);
  });

  it("never fades when it is off", () => {
    const f = settled(0, { enabled: false });
    expect(f.set(0, 1, 1)).toBe(FADE_SNAP);
    expect(f.active).toBe(0);
  });

  it("ends one fade or all fades at once", () => {
    const f = createLodFade(3);
    for (let i = 0; i < 3; i += 1) f.set(i, 0, 0);
    for (let i = 0; i < 3; i += 1) f.set(i, 1, 1);
    f.finish(1);
    expect(f.activeList()).toEqual([0, 2]);
    const ended = [];
    f.finishAll((i) => ended.push(i));
    expect(ended).toEqual([0, 2]);
    expect(f.active).toBe(0);
  });
});

describe("fadeDraw", () => {
  it("draws the new shape in and the old shape out with a copy at a LOD switch", () => {
    expect(fadeDraw(0, 1, 0.4)).toEqual({ main: { lod: 1, dither: 0.4 }, copy: { lod: 0, dither: 2.4 } });
  });

  it("draws one full shape with no fade", () => {
    expect(fadeDraw(1, 1, 0.2)).toEqual({ main: { lod: 1, dither: DITHER_FULL }, copy: null });
    expect(fadeDraw(-1, -1, 0.2).main.lod).toBe(-1);
    expect(fadeDraw(0, 1, 1)).toEqual({ main: { lod: 1, dither: DITHER_FULL }, copy: null });
  });
});

describe("dither values", () => {
  // The shader rule: in, a pixel draws when t < d; out, when t >= d - 2.
  const draws = (d, t) => (d < 1 ? t < d : d > 1.5 ? t >= d - 2 : true);
  it("makes the two shapes complementary at each progress", () => {
    for (const p of [0, 0.1, 0.5, 0.9]) {
      for (let k = 0; k < 16; k += 1) {
        const t = (k + 0.5) / 16;
        expect(draws(ditherIn(p), t) !== draws(ditherOut(p), t)).toBe(true);
      }
    }
  });

  it("starts with the old shape only and ends with the new shape only", () => {
    expect(ditherIn(0)).toBe(0);
    expect(ditherOut(0)).toBe(2);
    expect(ditherIn(1)).toBe(DITHER_FULL);
    expect(ditherOut(1)).toBe(3);
  });
});

describe("helpers", () => {
  it("reads ?lodfade=0", () => {
    expect(lodFadeOn("?level=x")).toBe(true);
    expect(lodFadeOn("?lodfade=0")).toBe(false);
    expect(lodFadeOn("")).toBe(true);
  });

  it("finds a camera jump", () => {
    expect(cameraJumped(null, { x: 0, z: 0 })).toBe(true);
    expect(cameraJumped({ x: 0, z: 0 }, { x: 1, z: 1 })).toBe(false);
    expect(cameraJumped({ x: 0, z: 0 }, { x: 300, z: 0 })).toBe(true);
  });

  it("keeps spare copies only when the fade is on", () => {
    expect(fadeCopies(10)).toBe(10);
    expect(fadeCopies(10_000)).toBe(LOD_FADE_COPIES);
    expect(fadeCopies(10, false)).toBe(0);
  });
});
