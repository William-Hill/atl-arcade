import { describe, expect, it } from "vitest";
import { SFX, bonkVoice, landVoice, scrapeLevel } from "./sfx-math.js";
import { createSfx } from "./sfx.js";
import { createSkateState } from "../sim/skate/controller.js";

const skater = (over = {}) => ({ ...createSkateState(), ...over });

// A fake AudioContext: it records the nodes and the start times.
function fakeContext() {
  const log = [];
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(v, t) { log.push({ set: v, t }); }, cancelScheduledValues() {} });
  const node = (kind) => ({ kind, connect: (n) => n, start: (t) => log.push({ start: kind, t }), stop() {} });
  return {
    log,
    currentTime: 1,
    sampleRate: 8000,
    createBuffer: (ch, n) => ({ getChannelData: () => new Float32Array(n) }),
    createOscillator: () => ({ ...node("osc"), type: "", frequency: param() }),
    createGain: () => ({ ...node("gain"), gain: param() }),
    createBiquadFilter: () => ({ ...node("filter"), type: "", frequency: param(), Q: param() }),
    createBufferSource: () => ({ ...node("noise"), buffer: null, loop: false }),
    destination: {},
  };
}

describe("sound levels", () => {
  it("a stronger bonk is louder and lower", () => {
    const a = bonkVoice(0.3);
    const b = bonkVoice(1);
    expect(b.gain).toBeGreaterThan(a.gain);
    expect(b.freq).toBeLessThan(a.freq);
    expect(bonkVoice(0)).toBe(null);
  });

  it("a higher fall lands louder, lower and longer", () => {
    const step = landVoice(0.1);
    const drop = landVoice(1);
    const big = landVoice(3);
    expect(drop.gain).toBeGreaterThan(step.gain);
    expect(big.gain).toBeGreaterThan(drop.gain);
    expect(big.freq).toBeLessThan(drop.freq);
    expect(big.length).toBeGreaterThan(step.length);
    expect(big.gain).toBe(SFX.land.gain[1]);
    expect(landVoice(0)).toBe(null);
    expect(landVoice(Number.NaN)).toBe(null);
  });

  it("the scrape is silent off a wall and louder and brighter at speed", () => {
    expect(scrapeLevel(false, 10).gain).toBe(0);
    expect(scrapeLevel(true, 0.2).gain).toBe(0);
    const slow = scrapeLevel(true, 3);
    const fast = scrapeLevel(true, 11);
    expect(fast.gain).toBeGreaterThan(slow.gain);
    expect(fast.band).toBeGreaterThan(slow.band);
  });

  it("no sound is louder than the music gain", () => {
    expect(Math.max(SFX.bonk.gain[1], SFX.land.gain[1], SFX.scrape.gain[1])).toBeLessThanOrEqual(0.8);
  });
});

describe("the sound player", () => {
  it("plays the bonk, the landing and the scrape from the controller flags", () => {
    const ctx = fakeContext();
    const sfx = createSfx({ ctx, running: true, muted: false });
    sfx.observe(skater({ speed: 8 }), skater({ bonked: true }));
    sfx.observe(skater({ velocity: [0, -8, 0] }), skater({ justLanded: true }));
    sfx.observe(skater(), skater({ wallSlide: true, speed: 6 }));
    expect(sfx.info).toMatchObject({ bonk: 1, land: 1, scrapeTicks: 1, played: 3 });
    expect(sfx.info.last.kind).toBe("land");
    expect(sfx.info.last.height).toBeCloseTo(64 / 40, 9);
    expect(ctx.log.some((e) => e.start === "osc")).toBe(true);
    // The scrape fades to 0 by itself after each tick.
    expect(ctx.log.filter((e) => "set" in e).at(-2)).toEqual({ set: 0, t: 1.06 });
  });

  it("is silent when muted or before the first gesture, and still counts", () => {
    for (const clock of [{ ctx: fakeContext(), running: true, muted: true }, { ctx: fakeContext(), running: false, muted: false }, null]) {
      const sfx = createSfx(clock);
      sfx.observe(skater({ speed: 8 }), skater({ bonked: true }));
      expect(sfx.info.bonk).toBe(1);
      expect(sfx.info.played).toBe(0);
      if (clock) expect(clock.ctx.log).toEqual([]);
    }
  });

  it("a bonk repeat inside the cooldown plays once", () => {
    const ctx = fakeContext();
    const sfx = createSfx({ ctx, running: true, muted: false });
    sfx.bonk(1);
    sfx.bonk(1);
    expect(sfx.info.played).toBe(1);
    ctx.currentTime += SFX.bonk.cooldown + 0.01;
    sfx.bonk(1);
    expect(sfx.info.played).toBe(2);
  });
});
