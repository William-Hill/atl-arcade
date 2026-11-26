import { describe, expect, it } from "vitest";
import { STYLE, styleDuration } from "./constants.js";
import { ATL_RYDIN, DANCE_SLOTS, danceFor, danceNamed } from "./tricks.js";
import { fr, rig } from "./trick-rig.js";

// #337: beats and points per dance (GDD R7), on the slots of TRICK and SPIN.
// Each dance: [beats, points]. TRICK dances are 2 beats and 150 points; the
// spins are 1 beat and 160; ATL Rydin is 8 beats and 600 (75 per beat).
const EXPECTED = {
  "Jam Groove": [2, 150],
  "Drumline Count": [2, 150],
  "Jam Step": [2, 150],
  "Bankhead Bounce": [2, 150],
  "Walk It Out": [2, 150],
  "The Prep": [2, 150],
  "Swag Surf": [2, 150],
  "Snap Lean": [2, 150],
  "Cross Step": [2, 150],
  "Smooth Quad": [2, 150],
  "Toe Spin": [1, 160],
  "Sit Spin": [1, 160],
  "ATL Rydin": [8, 600],
};

describe("#337 beats and points per dance", () => {
  it("every dance of STYLE.moves and every slot has the length and the points of the table", () => {
    const all = [...STYLE.moves.flatMap((m) => m.dances), ...Object.values(DANCE_SLOTS.style2), ...Object.values(DANCE_SLOTS.style1).flatMap((s) => Object.values(s))];
    for (const d of all) {
      expect(EXPECTED[d.name], d.name).toBeDefined();
      expect([d.beats, d.points], d.name).toEqual(EXPECTED[d.name]);
      expect(styleDuration(d, 100)).toBeCloseTo((EXPECTED[d.name][0] * 60) / 100, 9);
    }
    for (const name of Object.keys(EXPECTED)) expect(danceNamed(name)?.name, name).toBe(name);
  });

  it("ATL Rydin pays 75 points per beat and plays the Sit Spin clip until dance_atlrydin exists", () => {
    expect(ATL_RYDIN.points / ATL_RYDIN.beats).toBe(75);
    expect(ATL_RYDIN).toMatchObject({ clip: "dance_sitspin", futureClip: "dance_atlrydin" });
    expect(danceFor("style2", "nia", "u")).toBe(ATL_RYDIN);
  });

  it("no dance is named Crisscross; the clip dance_crisscross is the Cross Step", () => {
    const names = STYLE.moves.flatMap((m) => m.dances.map((d) => d.name));
    expect(names.some((n) => /criss/i.test(n))).toBe(false);
    expect(STYLE.moves.flatMap((m) => m.dances).find((d) => d.clip === "dance_crisscross").name).toBe("Cross Step");
  });

  it("AC: SPIN with a fresh right plays the Smooth Quad for 2 beats and pays 150", () => {
    const r = rig({ speed: 5 });
    r.step({ style2: true, flick: { style2: "r" } });
    expect(r.s.style).toMatchObject({ name: "Smooth Quad", points: 150 });
    expect(r.s.style.duration).toBeCloseTo(1.2, 9); // 2 beats at 100 BPM
    r.steps(fr(1300), { push: true }, (run) => run.skater.justStyled != null);
    expect(r.s.justStyled).toMatchObject({ name: "Smooth Quad", points: 150 });
    expect(r.s.time).toBeCloseTo(1.2 + 1 / 60, 6);
  });

  it("the length of a dance follows the BPM of the track", () => {
    const r = rig({ speed: 5, bpm: 120 });
    r.step({ style2: true, flick: { style2: "u" } });
    expect(r.s.style).toMatchObject({ name: "ATL Rydin", points: 600 });
    expect(r.s.style.duration).toBeCloseTo(4, 9); // 8 beats at 120 BPM
  });
});
