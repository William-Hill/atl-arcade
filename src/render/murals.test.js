import { describe, expect, it } from "vitest";
import { MURAL_WORDS } from "./murals.js";
import { MURAL_CELLS } from "../level/geo/geo-mesh.js";

// Issue #80: a mural can stand on any wall that faces the trail, so its word
// names no neighborhood. These are the neighborhoods near the BeltLine
// Eastside Trail and their short names.
const PLACES = ["SWEET AUBURN", "AUBURN", "INMAN", "PONCE", "KROG", "OLD 4TH WARD", "OLD FOURTH WARD", "O4W", "4TH WARD", "FOURTH WARD", "PONCEY", "HIGHLAND", "VIRGINIA", "CABBAGETOWN", "REYNOLDSTOWN", "MIDTOWN", "EDGEWOOD", "L5P", "LITTLE FIVE"];

describe("mural words", () => {
  it("has one word for each atlas cell", () => {
    expect(MURAL_WORDS.length).toBe(MURAL_CELLS);
  });

  it("names no neighborhood", () => {
    for (const w of MURAL_WORDS) for (const p of PLACES) expect(w.includes(p), `${w} names ${p}`).toBe(false);
  });
});
