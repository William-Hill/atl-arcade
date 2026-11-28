// Fetches the Fulton County structure footprints for a level box (issue #406).
//
//   node scripts/fulton-structures.mjs levels/beltline-eastside/
//
// Node 22 does not use HTTPS_PROXY by default. Behind a proxy, set
// NODE_USE_ENV_PROXY=1.
//
// It reads the box from <level>/raw/fetch.json and writes
// <level>/raw/fulton-structures.json: one row for each structure footprint,
// with the year built, the stories, the land use code, the structure form,
// the feature type, the parcel id, and the outer rings in degrees ([lon, lat],
// 6 decimals, about 0.1 m), sorted by OBJECTID. scripts/build-block.mjs reads
// the file, so the build runs offline after this fetch.
//
// The layer has no owner and no address fields. The script asks only for
// the fields in FIELDS.
//
// Data: Fulton County GIS, "Structure Footprints". The Fulton County Tax
// Parcels layer (CC BY-SA) is not used: owner choice 2026-11-28, see
// docs/decisions.md and docs/sources.md.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const LAYER = "https://services1.arcgis.com/AQDHTHDrZzfsFsB5/arcgis/rest/services/Structure_Footprints/FeatureServer/0";
export const ITEM = "https://www.arcgis.com/home/item.html?id=29dbb49a50c2422d9f5afd8dba7413a9";
export const FIELDS = ["OBJECTID", "ParcelID", "FeatType", "StructForm", "Stories", "YearBuilt", "LUC", "LUCDesc"];
const PAGE = 1000;
const round6 = (v) => Math.round(v * 1e6) / 1e6;

const text = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() || null : v ?? null);

// One ArcGIS feature to a row: the fields in `fields` (text trimmed, empty
// text to null) and the rings in degrees.
export function featureRow(f, fields = FIELDS) {
  const row = {};
  for (const k of fields) row[k] = text(f.attributes?.[k]);
  row.rings = (f.geometry?.rings ?? []).map((r) => r.map(([lon, lat]) => [round6(lon), round6(lat)]));
  return row;
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/fulton-structures.mjs levels/<name>/");
    process.exit(2);
  }
  const level = resolve(dir);
  const { bbox } = JSON.parse(readFileSync(resolve(level, "raw", "fetch.json"), "utf8"));
  const rows = [];
  // The server can return fewer rows than PAGE in one page. Thus the next
  // offset is the count of rows so far, not a multiple of PAGE.
  for (let offset = 0; ; offset = rows.length) {
    const q = new URLSearchParams({
      where: "1=1",
      geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      outSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: FIELDS.join(","),
      orderByFields: "OBJECTID",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: "json",
    });
    const res = await fetch(`${LAYER}/query?${q}`);
    if (!res.ok) throw new Error(`fulton-structures: HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`fulton-structures: ${JSON.stringify(json.error)}`);
    const n = (json.features ?? []).length;
    // An empty page with the transfer limit flag means that more rows
    // remain, but the offset cannot move. Fail, so the old cache stays.
    if (n === 0 && json.exceededTransferLimit) throw new Error(`fulton-structures: an empty page at offset ${offset} with exceededTransferLimit; the cache is not changed`);
    for (const f of json.features ?? []) rows.push(featureRow(f));
    if (n === 0 || (!json.exceededTransferLimit && n < PAGE)) break;
  }
  rows.sort((a, b) => a.OBJECTID - b.OBJECTID);
  const out = {
    source: "Fulton County GIS, Structure Footprints",
    layer: LAYER,
    item: ITEM,
    terms: "Public Fulton County GIS service; no license is stated. Cite Fulton County GIS.",
    fetchedAt: new Date().toISOString(),
    bbox,
    rows: rows.length,
    structures: rows,
  };
  writeFileSync(resolve(level, "raw", "fulton-structures.json"), `${JSON.stringify(out)}\n`);
  console.log(`fulton-structures: ${rows.length} structure footprints`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
