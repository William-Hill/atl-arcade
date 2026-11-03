import { describe, expect, it } from "vitest";
import { cityAddressText, inFootprint, interiorPoint, normalizeAddress, osmAddressText, osmIdOf, pickCityAddress, recordProblems, sameAddress } from "./building-sources.js";

const fact = (value, source = "osm", confidence = "high") => ({ value, source, confidence });
const good = () => ({
  id: "w1",
  name: fact("Test Hall"),
  address: { ...fact("1 MAIN ST NE", "city"), point: [-84.36, 33.76] },
  height: fact(12, "overture", "medium"),
  floors: fact(3, "estimate", "low"),
  facade: fact("storefront", "style-rule", "low"),
});

describe("building-sources addresses", () => {
  it("normalizes street words to the USPS short form", () => {
    expect(normalizeAddress("725 Ponce de Leon Avenue Northeast")).toBe("725 PONCE DE LEON AVE NE");
    expect(cityAddressText({ number: "99", suffix: "", street: "KROG Street NE" })).toBe("99 KROG ST NE");
    expect(osmAddressText({ "addr:housenumber": "652, 654", "addr:street": "Irwin Place" })).toBe("652;654 IRWIN PL");
    expect(osmAddressText({ "addr:street": "Irwin Place" })).toBeNull();
  });

  it("agrees on the same street with or without a quadrant, and on a number in a range or a list", () => {
    expect(sameAddress("660 RALPH MCGILL BLVD NE", "660 RALPH MCGILL BLVD")).toBe(true);
    expect(sameAddress("729 PONCE DE LEON AVE NE", "727-733 PONCE DE LEON AVE NE")).toBe(true);
    expect(sameAddress("654 IRWIN ST NE", "652;654 IRWIN ST NE")).toBe(true);
    expect(sameAddress("116 KROG ST NE", "112 KROG ST NE")).toBe(false);
    expect(sameAddress("652 IRWIN ST NE", "652;654 IRWIN PL")).toBe(false);
    expect(sameAddress("1 A ST NE", "1 A ST SE")).toBe(false);
  });

  it("picks the street address with the most points, then the lowest point id", () => {
    const pts = [
      { id: 9, number: "725", suffix: "", street: "PONCE DE LEON AVENUE NE" },
      { id: 4, number: "725", suffix: "", street: "PONCE DE LEON AVENUE NE" },
      { id: 2, number: "731", suffix: "", street: "PONCE DE LEON AVENUE NE" },
    ];
    const pick = pickCityAddress(pts);
    expect(pick.text).toBe("725 PONCE DE LEON AVE NE");
    expect(pick.point.id).toBe(4);
    expect(pick.others).toEqual(["731 PONCE DE LEON AVE NE"]);
    // The city address that agrees with the OSM address wins over the count.
    expect(pickCityAddress(pts, "731 PONCE DE LEON AVE NE").text).toBe("731 PONCE DE LEON AVE NE");
    expect(pickCityAddress([])).toBeNull();
  });

  it("finds a point inside an L-shaped footprint, and not in a hole", () => {
    const L = { outer: [[0, 0], [10, 0], [10, 2], [2, 2], [2, 10], [0, 10]] };
    const p = interiorPoint(L);
    expect(inFootprint(p, L)).toBe(true);
    const ring = { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [[[3, 3], [7, 3], [7, 7], [3, 7]]] };
    expect(inFootprint([5, 5], ring)).toBe(false);
    expect(inFootprint(interiorPoint(ring), ring)).toBe(true);
  });

  it("takes the OSM id from a level building id", () => {
    expect(osmIdOf("w741961703")).toBe("w741961703");
    expect(osmIdOf("r123-1")).toBe("r123");
  });
});

describe("building-sources record checks", () => {
  it("passes a record with a source and a confidence for each fact", () => {
    expect(recordProblems(good())).toEqual([]);
  });

  it("fails a record with a fact that has no source", () => {
    const r = good();
    delete r.height.source;
    expect(recordProblems(r)).toContain("w1: height has no source or confidence");
    const r2 = good();
    r2.name = { value: "x", source: "osm" };
    expect(recordProblems(r2).length).toBe(1);
    const r3 = good();
    delete r3.facade;
    expect(recordProblems(r3)).toContain("w1: facade has no source or confidence");
  });

  it("fails a height with no value or with the source none, and an address with no point", () => {
    const r = good();
    r.height = { value: null, source: "none", confidence: "none" };
    expect(recordProblems(r)).toEqual(['w1: height has no value', 'w1: height source is "none"']);
    const r2 = good();
    delete r2.address.point;
    expect(recordProblems(r2)).toEqual(["w1: address has no point"]);
  });
});
