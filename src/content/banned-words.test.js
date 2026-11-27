import { describe, expect, it } from "vitest";
import { BANNED_GROUPS, BANNED_WORDS, bannedIn, wordsOf } from "./banned-words.js";
import { STYLE } from "../sim/skate/constants.js";
import { ATL_RYDIN, DANCE_SLOTS, GRABS, MANUALS, STANCES, airName, grindName } from "../sim/skate/tricks.js";
import { ONE_BUTTON_SETS } from "../input/one-button.js";
import { hudShortName } from "../ui/trick-names.js";
import { TEACH_STEPS, promptFor } from "../ui/teach-steps.js";
import { BANNED_WORDS as LANDMARK_WORDS } from "../landmarks/validate.js";
import { CHIP_BANNED } from "../ui/trick-hud-text.js";

// #342, GDD R13: every trick and dance name is positive or neutral. The
// banned word list holds the AGENTS.md political rules.

// Every trick name that the player can see: the grabs, every grind name
// (each edge, stance, and length, and its HUD short form), the manuals, the
// air links with no grab, every dance of STYLE.moves and of the slots, and
// the one-button sets.
function allTrickNames() {
  const names = new Set();
  for (const g of Object.values(GRABS)) names.add(g.name);
  for (const dir of Object.keys(STANCES)) {
    for (const id of ["rail:x", "ledge:x"]) {
      for (const m of [0, 12]) {
        const n = grindName(id, m, dir);
        names.add(n);
        names.add(hudShortName(n));
      }
    }
  }
  for (const m of Object.values(MANUALS)) names.add(m.name);
  for (const from of ["ramp", "launch", "jump", "grind", "edge"]) {
    const n = airName(from);
    if (n) names.add(n);
  }
  for (const move of STYLE.moves) for (const d of move.dances) names.add(d.name);
  names.add(ATL_RYDIN.name);
  for (const bySkater of [DANCE_SLOTS.style1.nia, DANCE_SLOTS.style1.marcus, DANCE_SLOTS.style2]) for (const d of Object.values(bySkater)) names.add(d.name);
  for (const set of Object.values(ONE_BUTTON_SETS)) for (const item of set) names.add(item.name);
  return [...names];
}

describe("#342 the banned word list", () => {
  it("has the 7 groups of the political rules, each with words", () => {
    expect(Object.keys(BANNED_GROUPS)).toEqual(["crime", "police", "violence", "weapons", "drugs", "decline", "failure"]);
    for (const words of Object.values(BANNED_GROUPS)) expect(words.length).toBeGreaterThan(0);
    // The examples of the GDD (R13).
    expect(BANNED_WORDS).toEqual(expect.arrayContaining(["crash", "fail"]));
    // The chip words of the trick HUD spec (CHIP_BANNED in src/ui/trick-hud-text.js, #330).
    for (const w of CHIP_BANNED) expect(BANNED_WORDS).toContain(w.toLowerCase());
  });

  it("is lower case, one word each, and has no repeat", () => {
    for (const w of BANNED_WORDS) expect(w).toMatch(/^[a-z]+$/);
    expect(new Set(BANNED_WORDS).size).toBe(BANNED_WORDS.length);
  });

  it("holds every word of the landmark text check, which now uses this list", () => {
    expect(LANDMARK_WORDS).toBe(BANNED_WORDS);
    for (const w of ["crime", "police", "graffiti", "blight", "blighted", "slum", "decline", "declined", "abandoned", "derelict", "gentrification", "displaced", "displacement", "riot", "arson", "murder", "bail"]) expect(BANNED_WORDS).toContain(w);
  });

  it("matches whole words in any case, not parts of words", () => {
    expect(bannedIn("Big CRASH here")).toEqual(["crash"]);
    expect(bannedIn("Bankhead Bounce")).toEqual([]);
    expect(bannedIn("Old Fourth Ward neighborhood")).toEqual([]);
    expect(bannedIn("A fail, then a bail.")).toEqual(["fail", "bail"]);
    expect(wordsOf("Long Rail Grind")).toEqual(["long", "rail", "grind"]);
    expect(bannedIn(null)).toEqual([]);
  });
});

describe("#342 every trick and dance name against the list", () => {
  const names = allTrickNames();

  it("checks the full name set (grabs, grinds, manuals, airs, dances, one-button sets)", () => {
    expect(names).toEqual(expect.arrayContaining(["Mute Grab", "Side Grab", "Rail Grind", "Long Ledge Makio", "Toe Roll", "Vert Air", "Bankhead Bounce", "Cross Step", "ATL Rydin", "(edge) Grind"]));
    expect(names.length).toBeGreaterThan(40);
  });

  for (const name of allTrickNames()) {
    it(`"${name}" has no banned word`, () => {
      expect(bannedIn(name)).toEqual([]);
    });
  }
});

describe("#342 one neutral stance name: (edge) Grind, never Frontside", () => {
  it("the neutral stance has no stance word: Rail Grind, Ledge Grind, Long Ledge Grind", () => {
    expect(STANCES.n).toMatchObject({ id: "edge", word: null });
    expect(grindName("rail:x", 3, "n")).toBe("Rail Grind");
    expect(grindName("ledge:x", 3, "n")).toBe("Ledge Grind");
    expect(grindName("ledge:x", 12, "n")).toBe("Long Ledge Grind");
    expect(hudShortName("Long Ledge Grind")).toBe("Long Ledge Grind");
  });

  it("the one-button grind set starts with (edge) Grind", () => {
    expect(ONE_BUTTON_SETS.grind[0]).toEqual({ name: "(edge) Grind", dir: "n" });
  });

  it("no trick name, HUD name, or tutorial line says Frontside", () => {
    for (const n of allTrickNames()) expect(n).not.toMatch(/frontside/i);
    for (const step of TEACH_STEPS) {
      for (const kind of ["keyboard", "gamepad", "touch"]) {
        const p = promptFor(step, kind);
        const text = `${p.title} ${p.hint} ${(p.icons ?? []).map((i) => i.label).join(" ")}`;
        expect(text).not.toMatch(/frontside/i);
        expect(bannedIn(text)).toEqual([]);
      }
    }
  });
});
