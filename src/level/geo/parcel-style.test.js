import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APARTMENT_HEIGHT, APARTMENT_STORIES, ERA, OUTBUILDING_AREA, SHOTGUN_AREA, houseEraStyle, landUseGroup, styleFromParcel } from "./parcel-style.js";
import { STYLE_INDEX, chooseStyle } from "./styles.js";

// Issue #406: the facade style from the Fulton County parcel data.

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const at = (landUse, more = {}) => ({ id: "w1", height: 8, parcel: { landUse, ...more } });
const SQUARE = (s) => [[0, 0], [s, 0], [s, s], [0, s]];

describe("landUseGroup", () => {
  it("maps the Fulton land use codes to groups", () => {
    expect(landUseGroup("101")).toBe("house");
    expect(landUseGroup("107")).toBe("townhouse");
    expect(landUseGroup("2c1")).toBe("apartment");
    expect(landUseGroup(" 374 ")).toBe("retail");
    expect(landUseGroup("620")).toBe("church");
  });

  it("gives no group to vacant land, common areas, and unknown codes", () => {
    for (const code of ["100", "111", "188", "300", "339", "600", "889", "999", null, undefined, ""]) expect(landUseGroup(code)).toBeNull();
  });
});

describe("styleFromParcel", () => {
  it("gives null with no parcel data or no known land use", () => {
    expect(styleFromParcel({ id: "w1" })).toBeNull();
    expect(styleFromParcel(at("100"))).toBeNull();
    expect(styleFromParcel({ id: "w1", parcel: { yearBuilt: 1920 } })).toBeNull();
  });

  it("gives every result as a style of the kit", () => {
    const codes = ["101", "107", "106", "110", "206", "2A0", "251", "374", "355", "338", "337", "394", "401", "612", "620", "699"];
    for (const code of codes) for (const yearBuilt of [1890, 1925, 1975, 2015, undefined]) {
      const s = styleFromParcel(at(code, { yearBuilt }), 200);
      expect(STYLE_INDEX[s], `${code} ${yearBuilt}`).toBeTypeOf("number");
    }
  });

  it("gives the houses their era", () => {
    expect(styleFromParcel(at("101", { yearBuilt: ERA.victorian - 1 }), 150)).toBe("victorian-house");
    expect(styleFromParcel(at("101", { yearBuilt: ERA.victorian - 1, stories: 1 }), SHOTGUN_AREA)).toBe("shotgun-house");
    expect(styleFromParcel(at("101", { yearBuilt: ERA.victorian }), 150)).toBe("craftsman-house");
    expect(styleFromParcel(at("102", { yearBuilt: 1925 }), 150)).toBe("craftsman-house");
    // No year: not old.
    expect(styleFromParcel(at("101"), 150)).toBe("craftsman-house");
  });

  it("gives a tall house parcel an apartment style", () => {
    expect(styleFromParcel(at("101", { stories: APARTMENT_STORIES }), 300)).toBe("stucco-apartment");
    expect(styleFromParcel({ ...at("101"), height: APARTMENT_HEIGHT }, 300)).toBe("stucco-apartment");
    expect(styleFromParcel(at("101", { stories: APARTMENT_STORIES - 1 }), 300)).toBe("craftsman-house");
  });

  it("leaves an outbuilding to the size rule", () => {
    expect(styleFromParcel(at("101"), OUTBUILDING_AREA - 1)).toBeNull();
    expect(styleFromParcel(at("374"), OUTBUILDING_AREA - 1)).toBeNull();
    expect(styleFromParcel(at("101"), OUTBUILDING_AREA)).toBe("craftsman-house");
  });

  it("gives the brick styles to old lofts, offices, and warehouses", () => {
    expect(styleFromParcel(at("110", { yearBuilt: 1925 }), 500)).toBe("brick-loft");
    expect(styleFromParcel(at("110", { yearBuilt: 2005 }), 500)).toBe("modern-apartment");
    expect(styleFromParcel(at("355", { yearBuilt: 1920 }), 500)).toBe("brick-loft");
    expect(styleFromParcel(at("355", { yearBuilt: 1999 }), 500)).toBe("glass-office");
    expect(styleFromParcel(at("394", { yearBuilt: 1940 }), 3000)).toBe("brick-warehouse");
    expect(styleFromParcel(at("394", { yearBuilt: 1975 }), 3000)).toBe("industrial-shed");
  });

  it("gives the apartments and condos their era", () => {
    expect(styleFromParcel(at("2C1", { yearBuilt: 1965 }), 800)).toBe("stucco-apartment");
    expect(styleFromParcel(at("2A0", { yearBuilt: ERA.modern }), 800)).toBe("modern-apartment");
    expect(styleFromParcel(at("106", { yearBuilt: 1950 }), 800)).toBe("brick-loft");
    expect(styleFromParcel(at("106", { yearBuilt: 1975 }), 800)).toBe("stucco-apartment");
    expect(styleFromParcel(at("106", { yearBuilt: 2014 }), 800)).toBe("modern-apartment");
  });

  it("gives the shops, the churches, and the parking decks their style", () => {
    expect(styleFromParcel(at("374"), 600)).toBe("storefront");
    expect(styleFromParcel(at("620"), 600)).toBe("church");
    expect(styleFromParcel(at("338"), 3000)).toBe("parking-deck");
  });
});

describe("houseEraStyle", () => {
  const house = (more, parcel = {}) => ({ id: "w1", height: 7, ...more, parcel: { landUse: "101", yearBuilt: 1895, ...parcel } });

  it("gives a house before 1910 a Victorian house, or a shotgun house when it is small and one story", () => {
    expect(houseEraStyle(house({}, { stories: 2 }), 80)).toBe("victorian-house");
    expect(houseEraStyle(house({}, { stories: 1 }), SHOTGUN_AREA + 1)).toBe("victorian-house");
    expect(houseEraStyle(house({}, { stories: 1 }), SHOTGUN_AREA)).toBe("shotgun-house");
    // No story count: one story.
    expect(houseEraStyle(house(), 80)).toBe("shotgun-house");
  });

  it("does not decide from 1910 on, with no year, off a house parcel, or for an outbuilding", () => {
    expect(houseEraStyle(house({}, { yearBuilt: ERA.victorian }), 150)).toBeNull();
    expect(houseEraStyle(house({}, { yearBuilt: undefined }), 150)).toBeNull();
    expect(houseEraStyle(house({}, { landUse: "107" }), 150)).toBeNull();
    expect(houseEraStyle(house({}, { landUse: "374" }), 150)).toBeNull();
    expect(houseEraStyle({ id: "w1" }, 150)).toBeNull();
    expect(houseEraStyle(house(), OUTBUILDING_AREA - 1)).toBeNull();
  });
});

describe("chooseStyle with parcel data", () => {
  const house = { id: "w1", height: 7, outer: SQUARE(12), parcel: { landUse: "101", yearBuilt: 1895 } };

  it("uses the parcel data before the hash", () => {
    expect(chooseStyle(house)).toBe("victorian-house");
    // The style does not depend on the id now.
    for (const id of ["a", "b", "c", "d", "e", "f"]) expect(chooseStyle({ ...house, id })).toBe("victorian-house");
  });

  it("gives an OSM house type its era from the year built", () => {
    for (const type of ["house", "detached"]) {
      expect(chooseStyle({ ...house, type })).toBe("victorian-house");
      expect(chooseStyle({ ...house, type, outer: SQUARE(9), parcel: { ...house.parcel, stories: 1 } })).toBe("shotgun-house");
      // From 1910 on, or with no year, the OSM type keeps its style.
      expect(chooseStyle({ ...house, type, parcel: { landUse: "101", yearBuilt: 1925 } })).toBe("craftsman-house");
      expect(chooseStyle({ ...house, type, parcel: undefined })).toBe("craftsman-house");
    }
    // An OSM type that is not a house keeps its style.
    expect(chooseStyle({ ...house, type: "retail" })).toBe("storefront");
  });

  it("keeps a house that the year decides out of the historic district mix", () => {
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      expect(chooseStyle({ ...house, id, type: "house", historicDistrict: "cabbagetown" })).toBe("victorian-house");
    }
  });

  it("keeps the name, the OSM type, and the OSM material before the parcel data", () => {
    expect(chooseStyle({ ...house, name: "Krog Street Market" })).toBe("brick-market-hall");
    expect(chooseStyle({ ...house, type: "retail" })).toBe("storefront");
    expect(chooseStyle({ ...house, outer: SQUARE(20), material: "brick" })).toBe("brick-loft");
  });

  it("keeps the size rule for a small outbuilding", () => {
    expect(chooseStyle({ ...house, outer: SQUARE(5) })).toBe("garage");
  });
});

describe("the BeltLine Eastside level (#406)", () => {
  it("has parcel data on most buildings", () => {
    const n = LEVEL.buildings.filter((b) => b.parcel).length;
    expect(n).toBe(LEVEL.stats.parcels.joined);
    expect(n / LEVEL.buildings.length).toBeGreaterThan(0.9);
    for (const b of LEVEL.buildings) {
      if (!b.parcel) continue;
      expect(Object.keys(b.parcel).every((k) => ["landUse", "yearBuilt", "stories"].includes(k))).toBe(true);
    }
  });

  it("keeps the landmark styles", () => {
    const style = (name) => chooseStyle(LEVEL.buildings.find((b) => b.name === name), LEVEL);
    expect(style("Ponce City Market")).toBe("brick-warehouse");
    expect(style("Krog Street Market")).toBe("brick-market-hall");
  });
});
