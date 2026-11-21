import { describe, expect, it } from "vitest";
import {
  CALLOUT,
  activeCard,
  beatSeconds,
  busy,
  cardLook,
  claimCallout,
  comboCallout,
  comboName,
  createCallouts,
  endCallout,
  nextBeat,
  offBeat,
  pushCallout,
  snapBeat,
  startCallout,
  stepCallouts,
} from "./callout-math.js";

const NO_BEAT = { phase: null, bpm: 0 };

describe("beat timing", () => {
  it("keeps one beat between 0.4 s and 0.75 s", () => {
    expect(beatSeconds(120)).toBeCloseTo(0.5);
    expect(beatSeconds(200)).toBe(CALLOUT.minBeat);
    expect(beatSeconds(60)).toBe(CALLOUT.maxBeat);
    expect(beatSeconds(0)).toBe(CALLOUT.maxBeat);
  });

  it("finds the next beat from the phase", () => {
    expect(nextBeat(10, 0.5, 120)).toBeCloseTo(10.25);
    expect(nextBeat(10, 0.25, 60)).toBeCloseTo(10.75);
    // On the beat (or within 3 %): now.
    expect(nextBeat(10, 0, 120)).toBe(10);
    expect(nextBeat(10, 0.99, 120)).toBe(10);
    // No beat: now.
    expect(nextBeat(10, null, 120)).toBe(10);
    expect(nextBeat(10, 0.5, 0)).toBe(10);
  });

  it("never waits more than one beat", () => {
    for (let p = 0; p < 1; p += 0.05) expect(nextBeat(0, p, 90) - 0).toBeLessThanOrEqual(60 / 90 + 1e-9);
  });

  it("snaps a card that is a little late back to the beat, else waits for the next beat", () => {
    // 120 bpm: 0.5 s a beat. 0.04 s past a beat: start on it.
    expect(snapBeat(10, 0.08, 120)).toBeCloseTo(9.96);
    // 0.1 s past a beat: wait for the next one.
    expect(snapBeat(10, 0.2, 120)).toBeCloseTo(10.4);
    expect(snapBeat(10, null, 120)).toBe(10);
  });
});

describe("callouts", () => {
  it("counts in 3, 2, 1, SKATE!", () => {
    expect(startCallout().cards.map((c) => c.text)).toEqual(["3", "2", "1", "SKATE!"]);
    expect(startCallout().cards.map((c) => c.motion ?? "stamp")).toEqual(["pop", "pop", "pop", "stamp"]);
  });

  it("claims a spot with its points", () => {
    expect(claimCallout(200).cards[0]).toMatchObject({ text: "SPOT CLAIMED", sub: "+200" });
    expect(claimCallout(0).cards[0].sub).toBe("");
  });

  it("names a long combo by its points", () => {
    expect(comboName(30000, 3)).toBeNull(); // too short
    expect(comboName(2000, 6)).toBeNull(); // too small
    expect(comboName(2500, 4)).toBe("NICE COMBO");
    expect(comboName(6000, 5)).toBe("BIG COMBO");
    expect(comboName(13000, 8)).toBe("HUGE COMBO");
    expect(comboName(25000, 10)).toBe("ATL LEGEND");
    expect(comboCallout(1000, { links: 2 })).toBeNull();
    expect(comboCallout(12400, { links: 6, multiplier: 6 }).cards[0]).toMatchObject({ text: "HUGE COMBO", sub: "x6  12,400" });
  });

  it("ends the round with the medal and the score", () => {
    expect(endCallout({ medal: "gold", score: 12345 }).cards.map((c) => [c.text, c.sub ?? "", c.tone])).toEqual([
      ["ROUND OVER", "", "end"],
      ["GOLD", "12,345", "gold"],
    ]);
    expect(endCallout({ medal: "silver", score: 1 }).cards[1].text).toBe("SILVER");
    expect(endCallout({ medal: "bronze", score: 1 }).cards[1].text).toBe("BRONZE");
    // No medal: one card, with the score.
    expect(endCallout({ medal: null, score: 900 }).cards).toEqual([{ text: "ROUND OVER", sub: "900", beats: 4, tone: "end" }]);
  });

  it("uses only positive words", () => {
    const words = [startCallout(), claimCallout(1), comboCallout(30000, { links: 10 }), endCallout({ score: 1 }), endCallout({ medal: "gold", score: 1 })].flatMap((c) => c.cards.map((d) => d.text));
    for (const w of words) expect(w).not.toMatch(/FAIL|LOSE|LOST|DEAD|KO|CRASH/);
  });
});

describe("queue", () => {
  it("starts a callout on the next beat and shows each card in turn", () => {
    let s = pushCallout(createCallouts(), startCallout());
    // At t = 0.1 the beat is half way (120 bpm): the first card starts at 0.35.
    s = stepCallouts(s, 0.1, { phase: 0.5, bpm: 120 });
    expect(s.current.start).toBeCloseTo(0.35);
    expect(activeCard(s)).toBeNull();
    s = stepCallouts(s, 0.3, { phase: 0.1, bpm: 120 });
    expect(activeCard(s).card.text).toBe("3");
    s = stepCallouts(s, 0.5, NO_BEAT);
    expect(activeCard(s).card.text).toBe("2");
    s = stepCallouts(s, 0.5, NO_BEAT);
    expect(activeCard(s).card.text).toBe("1");
    s = stepCallouts(s, 0.5, NO_BEAT);
    expect(activeCard(s)).toMatchObject({ index: 3, card: { text: "SKATE!" } });
    expect(activeCard(s).length).toBeCloseTo(1);
    s = stepCallouts(s, 1, NO_BEAT);
    expect(s.current).toBeNull();
    expect(busy(s)).toBe(false);
    expect(s.shown).toBe(1);
  });

  it("keeps the beat length of a card, also when the music changes", () => {
    let s = stepCallouts(pushCallout(createCallouts(), claimCallout(200)), 0, { phase: 0, bpm: 100 });
    expect(s.current.beat).toBeCloseTo(0.6);
    s = stepCallouts(s, 1, { phase: 0.3, bpm: 150 });
    expect(s.current.end).toBeCloseTo(1.8);
  });

  // The music keeps time in seconds; `music(t)` gives its beat at time t.
  const music = (t, bpm = 120) => ({ phase: (t * bpm) / 60 - Math.floor((t * bpm) / 60), bpm });

  it("finds the beat again after a pause (#310 review)", () => {
    let s = pushCallout(createCallouts(), startCallout());
    let t = 0;
    s = stepCallouts(s, 0, music(t));
    // Show "3" for 0.1 s, then pause for 0.25 s: the callout clock stops, the music goes on.
    s = stepCallouts(s, 0.1, music((t += 0.1)));
    t += 0.25;
    // Play on in 0.02 s frames until "2" shows.
    while (activeCard(s)?.card.text !== "2") s = stepCallouts(s, 0.02, music((t += 0.02)));
    // "2" starts on a beat of the music: 0.5 s steps, less than 1 frame off.
    const musicStart = t - activeCard(s).age;
    expect(Math.abs(musicStart / 0.5 - Math.round(musicStart / 0.5)) * 0.5).toBeLessThan(0.021);
  });

  it("moves a card that waits for its beat when a pause comes in the wait (#310 review)", () => {
    // 120 bpm, phase 0.5: the first card waits 0.25 s for the beat at 0.25.
    let s = stepCallouts(pushCallout(createCallouts(), claimCallout(200)), 0, music(0.25));
    expect(s.current.start).toBeCloseTo(0.25);
    // With no pause the start stays.
    const same = stepCallouts(s, 0.1, music(0.35));
    expect(same.current.start).toBeCloseTo(0.25);
    // A pause of 0.15 s (the music goes on, the callout clock stops), then 0.02 s of play.
    s = stepCallouts(s, 0.02, music(0.25 + 0.15 + 0.02));
    // Music time = callout time + 0.4: the music beat at 0.5 is callout time 0.1 (the old start, 0.25, is off the beat).
    expect(s.current.start).toBeCloseTo(0.1);
    expect(activeCard(s)).toBeNull();
  });

  it("moves a waiting card also when the step after the pause passes its old start (#310 review)", () => {
    // 120 bpm. The card waits for callout time 0.25; at 0.20 the game pauses for 0.15 s.
    let s = stepCallouts(pushCallout(createCallouts(), claimCallout(200)), 0, music(0.25));
    s = stepCallouts(s, 0.2, music(0.45));
    expect(s.current.start).toBeCloseTo(0.25);
    // Resume with a 0.06 s step: callout time 0.26, music time 0.66 (phase 0.32).
    s = stepCallouts(s, 0.06, music(0.66));
    // The next music beat is 1.0, callout time 0.60: the card waits for it.
    expect(s.current.start).toBeCloseTo(0.6);
    expect(activeCard(s)).toBeNull();
  });

  it("keeps the start of a waiting card when the clocks agree, with steps that pass it (#310 review)", () => {
    // 120 bpm. Music time = callout time + 0.10: the card waits for 0.40 (music 0.50).
    let s = stepCallouts(pushCallout(createCallouts(), claimCallout(200)), 0, music(0.1));
    expect(s.current.start).toBeCloseTo(0.4);
    // 0.25 s steps: the phase goes 0.70, 0.20, ...
    s = stepCallouts(s, 0.25, music(0.35));
    s = stepCallouts(s, 0.25, music(0.6));
    expect(s.current.start).toBeCloseTo(0.4);
    expect(activeCard(s)).toMatchObject({ card: { text: "SPOT CLAIMED" } });
    expect(activeCard(s).age).toBeCloseTo(0.1);
  });

  it("tells a start off the music beat", () => {
    // 120 bpm, music time = callout time + 0.10.
    expect(offBeat(0.4, 0.5, music(0.6))).toBe(false);
    expect(offBeat(0.4, 0.5, music(0.75))).toBe(true);
    expect(offBeat(0.4, 0.5, { phase: null, bpm: 120 })).toBe(false);
  });

  it("keeps each card on the beat after slow frames (#310 review)", () => {
    let s = pushCallout(createCallouts(), startCallout());
    let t = 0;
    s = stepCallouts(s, 0, music(t));
    const starts = [];
    let last = null;
    // 160 ms frames.
    for (let i = 0; i < 40 && (s.current || i === 0); i += 1) {
      s = stepCallouts(s, 0.16, music((t += 0.16)));
      const a = activeCard(s);
      if (a && a.index !== last) {
        last = a.index;
        starts.push(s.current.start);
      }
    }
    expect(starts).toHaveLength(4);
    // Each card starts on a beat of the music (the clocks agree here).
    for (const st of starts) expect(Math.abs(st / 0.5 - Math.round(st / 0.5))).toBeLessThan(1e-9);
  });

  it("does not move while the game is paused", () => {
    let s = stepCallouts(pushCallout(createCallouts(), claimCallout(200)), 0, NO_BEAT);
    const paused = stepCallouts(s, 0, NO_BEAT);
    expect(paused).toBe(s);
    s = stepCallouts(s, -5, NO_BEAT);
    expect(s.time).toBe(0);
  });

  it("puts a claim before a combo that waits", () => {
    let s = createCallouts();
    s = pushCallout(s, comboCallout(3000, { links: 5 }));
    s = pushCallout(s, claimCallout(200));
    expect(s.queue.map((c) => c.kind)).toEqual(["claim", "combo"]);
  });

  it("keeps one combo in the queue: the newest", () => {
    let s = createCallouts();
    s = pushCallout(s, comboCallout(3000, { links: 5 }));
    s = pushCallout(s, comboCallout(7000, { links: 7 }));
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0].cards[0].text).toBe("BIG COMBO");
  });

  it("drops the lowest priority when the queue is full", () => {
    let s = createCallouts();
    s = pushCallout(s, comboCallout(3000, { links: 5 }));
    for (let i = 0; i < 3; i += 1) s = pushCallout(s, claimCallout(100 + i));
    expect(s.queue).toHaveLength(CALLOUT.maxQueue);
    expect(s.queue.every((c) => c.kind === "claim")).toBe(true);
    // A new combo is the lowest: it does not go in.
    s = pushCallout(s, comboCallout(30000, { links: 9 }));
    expect(s.queue.map((c) => c.kind)).toEqual(["claim", "claim", "claim"]);
  });

  it("ends the round at once: the queue and the callout on show go", () => {
    let s = pushCallout(createCallouts(), startCallout());
    s = stepCallouts(s, 0, NO_BEAT);
    s = pushCallout(s, claimCallout(200));
    s = pushCallout(s, endCallout({ medal: "gold", score: 9000 }));
    expect(s.current).toBeNull();
    expect(s.queue.map((c) => c.kind)).toEqual(["end"]);
    s = stepCallouts(s, 0, NO_BEAT);
    expect(activeCard(s).card.text).toBe("ROUND OVER");
  });

  it("ignores a null callout", () => {
    const s = createCallouts();
    expect(pushCallout(s, null)).toBe(s);
  });
});

describe("card look", () => {
  it("stamps in: scale 1.2 to 1 in 0.18 s, opacity 0 to 1", () => {
    expect(cardLook(0, 2)).toMatchObject({ opacity: 0, scale: 1.2 });
    const mid = cardLook(0.09, 2);
    expect(mid.scale).toBeGreaterThan(1.15); // power4.in: slow at the start
    expect(mid.opacity).toBeLessThan(0.1);
    // Just after the drop: full size, the press and the shake.
    const hit = cardLook(0.18 + 0.01, 2);
    expect(hit).toMatchObject({ opacity: 1, scale: 1, x: 2, y: -2 });
    expect(hit.scaleY).toBeLessThan(1);
    expect(hit.scaleY).toBeGreaterThanOrEqual(0.98);
  });

  it("presses 2 % at most and comes back", () => {
    let min = 1;
    for (let t = 0.18; t < 0.3; t += 0.002) min = Math.min(min, cardLook(t, 2).scaleY);
    expect(min).toBeCloseTo(0.98, 3);
    expect(cardLook(0.18 + 0.1, 2).scaleY).toBe(1);
  });

  it("shakes 3 frames, then holds still", () => {
    const xs = [0.005, 0.04, 0.07, 0.11].map((a) => cardLook(0.18 + a, 2).x);
    expect(xs).toEqual([2, -2, 2, 0]);
    expect(cardLook(1, 2)).toEqual({ opacity: 1, scale: 1, scaleY: 1, x: 0, y: 0 });
  });

  it("pops a digit with no press and no shake", () => {
    expect(cardLook(0.2, 0.5, { motion: "pop" })).toEqual({ opacity: 1, scale: 1, scaleY: 1, x: 0, y: 0 });
  });

  it("leaves in 0.25 s: fades and rises 12 px", () => {
    const end = cardLook(1.99, 2);
    expect(end.opacity).toBeLessThan(0.05);
    expect(end.y).toBeLessThan(-11);
    expect(cardLook(2 - 0.25 - 0.01, 2).opacity).toBe(1);
    // A short card leaves in a third of its length.
    expect(cardLook(0.5 - 0.17, 0.5, { motion: "pop" }).opacity).toBe(1);
    expect(cardLook(0.5 - 0.15, 0.5, { motion: "pop" }).opacity).toBeLessThan(1);
  });

  it("only fades with reduced motion", () => {
    for (let a = 0; a <= 2; a += 0.01) {
      const l = cardLook(a, 2, { reducedMotion: true });
      expect([l.scale, l.scaleY, l.x, l.y]).toEqual([1, 1, 0, 0]);
    }
    expect(cardLook(0.1, 2, { reducedMotion: true }).opacity).toBeCloseTo(0.5);
    expect(cardLook(1, 2, { reducedMotion: true }).opacity).toBe(1);
    expect(cardLook(1.9, 2, { reducedMotion: true }).opacity).toBeCloseTo(0.5);
  });

  it("shows nothing outside the card", () => {
    expect(cardLook(-0.1, 2).opacity).toBe(0);
    expect(cardLook(2, 2).opacity).toBe(0);
  });
});
