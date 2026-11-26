import { describe, expect, it } from "vitest";
import { HUD_NAME_MAX, hudLinks, hudShortName } from "./trick-names.js";
import { ATL_RYDIN, GRABS, MANUALS, STANCES, airName, grindName } from "../sim/skate/tricks.js";
import { STYLE } from "../sim/skate/constants.js";
import { COMBO_LINE, comboLine } from "../sim/skate/combo.js";

// GDD R6 and #335: [Long] [edge] [stance] Grind, and the HUD short form.
const CASES = [
  // [stance, edge id, meters, full name, HUD name]
  ["n", "rail:a", 6, "Rail Grind", "Rail Grind"],
  ["n", "rail:a", 12, "Long Rail Grind", "Long Rail Grind"],
  ["n", "ledge:a", 6, "Ledge Grind", "Ledge Grind"],
  ["n", "ledge:a", 12, "Long Ledge Grind", "Long Ledge Grind"],
  ["l", "rail:a", 6, "Rail Soul Grind", "Rail Soul"],
  ["l", "rail:a", 12, "Long Rail Soul Grind", "Long Rail Soul"],
  ["l", "ledge:a", 6, "Ledge Soul Grind", "Ledge Soul"],
  ["l", "ledge:a", 12, "Long Ledge Soul Grind", "Long Ledge Soul"],
  ["r", "rail:a", 6, "Rail Unity Grind", "Rail Unity"],
  ["r", "rail:a", 12, "Long Rail Unity Grind", "Long Rail Unity"],
  ["r", "ledge:a", 6, "Ledge Unity Grind", "Ledge Unity"],
  ["r", "ledge:a", 12, "Long Ledge Unity Grind", "Long Ledge Unity"],
  ["u", "rail:a", 6, "Rail Makio Grind", "Rail Makio"],
  ["u", "rail:a", 12, "Long Rail Makio Grind", "Long Rail Makio"],
  ["u", "ledge:a", 6, "Ledge Makio Grind", "Ledge Makio"],
  ["u", "ledge:a", 12, "Long Ledge Makio Grind", "Long Ledge Makio"],
  ["d", "rail:a", 6, "Rail Royale Grind", "Rail Royale"],
  ["d", "rail:a", 12, "Long Rail Royale Grind", "Long Rail Royale"],
  ["d", "ledge:a", 6, "Ledge Royale Grind", "Ledge Royale"],
  ["d", "ledge:a", 12, "Long Ledge Royale Grind", "Long Ledge Royale"],
];

describe("grind names and the HUD short form (#335)", () => {
  it.each(CASES)("stance %s on %s at %d m: %s, HUD %s", (stance, id, meters, full, hud) => {
    expect(grindName(id, meters, stance)).toBe(full);
    expect(hudShortName(full)).toBe(hud);
  });

  it("covers all 5 stances on both edges, under and over 10 m", () => {
    expect(new Set(CASES.map((c) => c[0]))).toEqual(new Set(Object.keys(STANCES)));
    expect(CASES).toHaveLength(Object.keys(STANCES).length * 2 * 2);
  });

  it("the long grind starts at 10 m", () => {
    expect(grindName("ledge:a", 9.99, "u")).toBe("Ledge Makio Grind");
    expect(grindName("ledge:a", 10, "u")).toBe("Long Ledge Makio Grind");
  });

  it("Long Ledge Makio is 16 characters", () => {
    expect(hudShortName("Long Ledge Makio Grind")).toBe("Long Ledge Makio");
    expect("Long Ledge Makio").toHaveLength(16);
  });

  it(`every grind name fits ${HUD_NAME_MAX} characters on the HUD`, () => {
    for (const [, , , full] of CASES) expect(hudShortName(full).length).toBeLessThanOrEqual(HUD_NAME_MAX);
  });

  it(`every trick name fits ${HUD_NAME_MAX} characters on the HUD`, () => {
    const names = [
      ...Object.values(GRABS).map((g) => g.name),
      ...Object.values(MANUALS).map((m) => m.name),
      ...STYLE.moves.flatMap((m) => m.dances.map((d) => d.name)),
      ATL_RYDIN.name,
      ...["ramp", "launch", "jump"].map(airName),
    ];
    for (const n of names) expect(hudShortName(n).length, n).toBeLessThanOrEqual(HUD_NAME_MAX);
  });

  it("does not change a name with no stance word", () => {
    for (const n of ["Japan Grab", "Long Rail Grind", "Ledge Grind", "Manual", "Swag Surf", "Grind", ""]) expect(hudShortName(n)).toBe(n);
  });

  it("the combo line shows the short form and keeps the other link fields", () => {
    const links = [
      { name: "Long Ledge Makio Grind", onBeat: true },
      { name: "Manual", onBeat: false },
      { name: "Japan Grab", onBeat: false },
    ];
    expect(hudLinks(links)[0]).toEqual({ name: "Long Ledge Makio", onBeat: true });
    expect(links[0].name).toBe("Long Ledge Makio Grind");
    expect(comboLine(hudLinks(links), COMBO_LINE.desktop)).toBe("Long Ledge Makio! + Manual + Japan Grab");
  });
});
