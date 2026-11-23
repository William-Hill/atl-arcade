import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { MURAL_WORDS, muralSource } from "./murals.js";
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

describe("mural atlas source", () => {
  it("paints the pbr look and draws the toon look", () => {
    expect(muralSource({ look: "pbr" })).toBe("painted");
    expect(muralSource({ look: "toon" })).toBe("canvas");
  });

  it("follows ?murals over the look", () => {
    expect(muralSource({ look: "pbr", murals: "canvas" })).toBe("canvas");
    expect(muralSource({ look: "toon", murals: "painted" })).toBe("painted");
  });

  it("reads the look from the URL as lookFor() does when it is not given", () => {
    expect(muralSource({ lookParam: "pbr" })).toBe("painted");
    expect(muralSource({ lookParam: "toon", quality: "high" })).toBe("canvas");
    expect(muralSource({ quality: "high" })).toBe("painted");
    expect(muralSource({ quality: "phone" })).toBe("canvas");
    expect(muralSource({})).toBe("canvas");
  });
});

describe("the painted mural atlas", () => {
  const prov = JSON.parse(readFileSync(new URL("../../assets/murals/provenance.json", import.meta.url), "utf8"));

  it("has an original, credit-free design for every cell, with the cell's word", () => {
    expect(prov.designs.length).toBe(MURAL_CELLS);
    prov.designs.forEach((d, cell) => {
      expect(d.cell).toBe(cell);
      expect(d.word).toBe(MURAL_WORDS[cell]);
    });
    expect(prov.credits.total).toBe(0);
    expect(prov.originality).toMatch(/original/);
  });

  it("stays in the download budget", () => {
    let total = 0;
    for (const name of Object.keys(prov.files)) total += statSync(new URL(`../../assets/murals/${name}`, import.meta.url)).size;
    expect(total).toBeLessThanOrEqual(1.5 * 1024 * 1024);
  });
});
