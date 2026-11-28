// Fetches the City of Atlanta historic and landmark district boundaries for
// a level box (issue #407).
//
//   node scripts/historic-districts.mjs levels/beltline-eastside/
//
// It reads the box from <level>/raw/fetch.json and writes
// <level>/historic-districts.json: one row for each district that touches
// the box, with the name, the zoning code, and the rings in degrees
// ([lon, lat]). src/level/geo/historic-districts.js reads that file at load
// time and tags each building with its district, so the build runs offline
// after this fetch, and level.json does not change.
//
// Data: City of Atlanta, Department of City Planning GIS, "Historic District
// - Open Data" (the open-data-atl catalog id
// dpcd-3f15fba5c71c4c4eab7288a3d1b4f17a-15). No license is stated; the
// catalog says "Cite City of Atlanta - Department of City Planning GIS".
// See docs/sources.md.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { districtSlug } from "../src/level/geo/historic-districts.js";

export const LAYER = "https://gis.atlantaga.gov/dpcd/rest/services/OpenDataService1/MapServer/15";
export const CATALOG_ID = "dpcd-3f15fba5c71c4c4eab7288a3d1b4f17a-15";
export const LANDING = "https://dpcd-coaplangis.opendata.arcgis.com/datasets/coaplangis::historic-district-open-data";
const FIELDS = ["OBJECTID_1", "DIST_1", "DIST_2", "ZONING"];
const round7 = (v) => Math.round(v * 1e7) / 1e7;

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/historic-districts.mjs levels/<name>/");
    process.exit(2);
  }
  const level = resolve(dir);
  const { bbox } = JSON.parse(readFileSync(resolve(level, "raw", "fetch.json"), "utf8"));
  const q = new URLSearchParams({
    where: "1=1",
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: FIELDS.join(","),
    orderByFields: "OBJECTID_1",
    returnGeometry: "true",
    f: "json",
  });
  const res = await fetch(`${LAYER}/query?${q}`);
  if (!res.ok) throw new Error(`historic-districts: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`historic-districts: ${JSON.stringify(json.error)}`);
  const districts = (json.features ?? []).map((f) => {
    const a = f.attributes;
    const name = String(a.DIST_1 ?? "").replace(/\s+/g, " ").trim();
    const sub = String(a.DIST_2 ?? "").trim();
    return {
      id: districtSlug(name),
      name,
      ...(sub ? { subarea: sub } : {}),
      zoning: String(a.ZONING ?? "").trim(),
      objectId: a.OBJECTID_1,
      rings: (f.geometry?.rings ?? []).map((r) => r.map(([lon, lat]) => [round7(lon), round7(lat)])),
    };
  });
  const out = {
    source: "City of Atlanta, Department of City Planning GIS, \"Historic District - Open Data\"",
    layer: LAYER,
    catalogId: CATALOG_ID,
    landingPage: LANDING,
    terms: "No license is stated. Cite City of Atlanta - Department of City Planning GIS.",
    attribution: "Historic districts: City of Atlanta Department of City Planning",
    fetchedAt: new Date().toISOString(),
    bbox,
    districts,
  };
  const file = resolve(level, "historic-districts.json");
  writeFileSync(file, `${JSON.stringify(out)}\n`);
  console.log(`historic-districts: ${districts.length} districts (${districts.map((d) => d.name).join(", ")}) -> ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
