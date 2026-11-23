import { describe, expect, it } from "vitest";
import { allTrickNames, DANCES, danceFor, GRABS, grindName, hudShort, ONE_BUTTON, STANCES } from "./tricks.js";

// The banned word list file (src/content/banned-words.js) is the work of the
// HUD issue (#330). The prototype checks a local copy of the categories of
// AGENTS.md and R13. It does not import src/.
const BANNED = ["crash", "fail", "crime", "police", "cop", "gun", "kill", "dead", "death", "drug", "gang", "thug", "steal", "fight", "blood", "war", "decline", "slum", "ghetto", "hood", "trap", "weapon", "shoot", "nae nae", "liukang", "liu kang"];

describe("trick names (R13)", () => {
  it("no name has a banned word", () => {
    for (const n of allTrickNames()) for (const w of BANNED) expect(n.toLowerCase().includes(w), `${n} has ${w}`).toBe(false);
  });
  it("every HUD short name is 18 characters or fewer", () => {
    for (const n of allTrickNames()) expect(hudShort(n).length, n).toBeLessThanOrEqual(18);
  });
  it("the Side Grab placeholder uses the air_liukang clip", () => {
    expect(GRABS.r.name).toBe("Side Grab");
    expect(GRABS.r.clip).toBe("air_liukang");
  });
});

describe("grind names (R6)", () => {
  it("[Long] [edge] [stance] Grind", () => {
    expect(grindName("Ledge", "l", 4)).toBe("Ledge Soul Grind");
    expect(grindName("Ledge", "n", 4)).toBe("Ledge Grind");
    expect(grindName("Ledge", "n", 12)).toBe("Long Ledge Grind");
    expect(grindName("Ledge", "u", 12)).toBe("Long Ledge Makio Grind");
  });
  it("the HUD short form drops Grind of a direction stance", () => {
    expect(hudShort("Long Ledge Makio Grind")).toBe("Long Ledge Makio");
    expect(hudShort("Long Ledge Makio").length).toBe(16);
    expect(hudShort("Long Rail Grind")).toBe("Long Rail Grind");
  });
  it("up and down are the new clips", () => {
    expect(STANCES.u.clip).toBe("grind_makio");
    expect(STANCES.d.clip).toBe("grind_royale");
  });
});

describe("dances (R7)", () => {
  it("Nia neutral TRICK is Bankhead Bounce; Marcus neutral is Swag Surf, up is Drumline Count", () => {
    expect(danceFor("trick", "nia", "n").name).toBe("Bankhead Bounce");
    expect(danceFor("trick", "marcus", "n").name).toBe("Swag Surf");
    expect(danceFor("trick", "marcus", "u").name).toBe("Drumline Count");
  });
  it("SPIN neutral is Cross Step, 2 beats, 150; up is ATL Rydin, 8 beats, 600", () => {
    expect(DANCES.spin.n).toMatchObject({ name: "Cross Step", beats: 2, points: 150 });
    expect(DANCES.spin.u).toMatchObject({ name: "ATL Rydin", beats: 8, points: 600 });
  });
  it("every neutral slot has a sourced dance", () => {
    expect(DANCES.trick.nia.n.source && DANCES.trick.marcus.n.source && DANCES.spin.n.source).toBe(true);
  });
});

describe("one-button sets (R12.1)", () => {
  it("has 5 grabs, 5 stances, 10 Nia dances, 13 Marcus dances", () => {
    expect(ONE_BUTTON.air.map((g) => g.name)).toEqual(["Mute Grab", "Japan Grab", "Side Grab", "Rocket Grab", "Tuck Knee"]);
    expect(ONE_BUTTON.grind.length).toBe(5);
    expect(ONE_BUTTON.ground.nia.length).toBe(10);
    expect(ONE_BUTTON.ground.marcus.length).toBe(13);
  });
});
