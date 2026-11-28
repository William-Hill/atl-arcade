// The facade style from the Fulton County data of a building (issue #406).
// Pure functions. The build (scripts/parcel-join.mjs) writes `b.parcel`:
//   { landUse, yearBuilt, stories }
// from the Fulton County structure footprints. chooseStyle() in styles.js
// calls styleFromParcel() after the name, the OSM type, and the OSM
// material, and before the hash.
//
// The land use codes are the Fulton County Board of Assessors land use
// classes (LUC). The groups below cover every code in the BeltLine Eastside
// level. A code that is not in a group gives no style, so the hash decides.

// The land use groups: a code to a group name.
const GROUPS = {
  house: ["101", "102", "103", "104", "105", "201", "301", "622"],
  townhouse: ["107"],
  condo: ["106"],
  loft: ["110"],
  apartment: ["2A0", "2A1", "2B1", "2C1", "2D1", "2X0"],
  "loft-retail": ["206"],
  hotel: ["251"],
  retail: ["321", "325", "327", "351", "356", "373", "374"],
  office: ["349", "355", "3A3", "3C3", "3X4"],
  parking: ["338"],
  "car-wash": ["337"],
  warehouse: ["390", "392", "393", "394", "395", "399"],
  industrial: ["401", "443", "720"],
  school: ["612"],
  church: ["620"],
  civic: ["610", "660", "699"],
};
const GROUP_OF = new Map(Object.entries(GROUPS).flatMap(([g, codes]) => codes.map((c) => [c, g])));

// The land use group of a Fulton land use code, or null.
export function landUseGroup(code) {
  return GROUP_OF.get(String(code ?? "").trim().toUpperCase()) ?? null;
}

// The years that split the eras of the house and the brick stock.
// Before 1910: the Victorian cottages and the shotgun rows of Inman Park and
// the Old Fourth Ward. 1910 to 1945: the bungalow era. Before 1960: the brick
// mills and warehouses along the rail line.
export const ERA = { victorian: 1910, brick: 1960, modern: 1990 };

// A footprint under this area (m²) is an outbuilding (a garage or a
// shed), not the main building of the parcel. chooseStyle() gives it the
// garage style by size.
export const OUTBUILDING_AREA = 40;
// A house parcel with this many stories or more, or a wall height of
// APARTMENT_HEIGHT m or more, is an apartment block.
export const APARTMENT_STORIES = 4;
export const APARTMENT_HEIGHT = 14;

// A one-story house before ERA.victorian with a footprint of this area (m²)
// or less is a shotgun house or a mill cottage. A larger one, or one with 2
// stories or more, is a Victorian house (a Queen Anne house or cottage).
export const SHOTGUN_AREA = 120;

// The style of a house from its year built, or null when the year does not
// decide. Only a house before ERA.victorian changes: the kit has no house
// style newer than the craftsman house. `b.parcel` must be on a house
// parcel (land use group "house"), so that the year is the year of a house.
// chooseStyle() uses it for the parcel rule and for an OSM house type.
export function houseEraStyle(b, area = Infinity) {
  const p = b?.parcel;
  if (!p || area < OUTBUILDING_AREA || landUseGroup(p.landUse) !== "house") return null;
  const year = p.yearBuilt ?? null;
  if (year === null || year >= ERA.victorian) return null;
  return (p.stories ?? 1) <= 1 && area <= SHOTGUN_AREA ? "shotgun-house" : "victorian-house";
}

// The facade style id for a building from its parcel data, or null when the
// data does not decide. `area` is the footprint area in m².
export function styleFromParcel(b, area = Infinity) {
  const p = b?.parcel;
  if (!p || area < OUTBUILDING_AREA) return null;
  const group = landUseGroup(p.landUse);
  if (!group) return null;
  const year = p.yearBuilt ?? null;
  const old = (y) => year !== null && year < y;
  const tall = (p.stories ?? 0) >= APARTMENT_STORIES || (b.height ?? 0) >= APARTMENT_HEIGHT;
  switch (group) {
    case "house":
      if (tall) return "stucco-apartment";
      return houseEraStyle(b, area) ?? "craftsman-house";
    case "townhouse":
      return "stucco-apartment";
    case "condo":
      if (old(ERA.brick)) return "brick-loft";
      return year !== null && year >= ERA.modern ? "modern-apartment" : "stucco-apartment";
    case "loft":
    case "loft-retail":
      return old(ERA.brick) ? "brick-loft" : "modern-apartment";
    case "apartment":
      return year !== null && year >= ERA.modern ? "modern-apartment" : "stucco-apartment";
    case "hotel":
      return "modern-apartment";
    case "retail":
      return "storefront";
    case "office":
      return old(ERA.brick) ? "brick-loft" : "glass-office";
    case "parking":
      return "parking-deck";
    case "car-wash":
      return "garage";
    case "warehouse":
    case "industrial":
      return old(ERA.brick) ? "brick-warehouse" : "industrial-shed";
    case "school":
      return "brick-warehouse";
    case "church":
      return "church";
    case "civic":
      return "brick-loft";
    default:
      return null;
  }
}
