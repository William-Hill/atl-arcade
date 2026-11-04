// Fetches the City of Atlanta street centerlines for a level box.
//
//   node scripts/city-streets.mjs levels/beltline-eastside/
//
// It reads the box from <level>/raw/fetch.json and writes
// <level>/raw/city-streets.json: one row for each centerline segment, with
// the label and the line in degrees, sorted by OBJECTID.
// scripts/build-block.mjs reads that file and takes the street names on the
// signs from it (issue #78), so the build runs offline after this fetch.
//
// Data: City of Atlanta, Department of City Planning GIS, "Street
// centerlines" (the open-data-atl catalog id atl-street-centerlines). See
// docs/sources.md.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const LAYER = "https://gis.atlantaga.gov/dpcd/rest/services/OpenDataService1/FeatureServer/33";
export const CATALOG_ID = "atl-street-centerlines";
const FIELDS = ["OBJECTID", "LABEL", "STATUS"];
const PAGE = 1000;
const round7 = (v) => Math.round(v * 1e7) / 1e7;

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/city-streets.mjs levels/<name>/");
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
    if (!res.ok) throw new Error(`city-streets: HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`city-streets: ${JSON.stringify(json.error)}`);
    for (const f of json.features ?? []) {
      const a = f.attributes;
      const label = typeof a.LABEL === "string" ? a.LABEL.replace(/\s+/g, " ").trim() : "";
      rows.push({
        id: a.OBJECTID,
        label,
        status: typeof a.STATUS === "string" ? a.STATUS.trim() : a.STATUS ?? "",
        paths: (f.geometry?.paths ?? []).map((p) => p.map(([lon, lat]) => [round7(lon), round7(lat)])),
      });
    }
    const n = (json.features ?? []).length;
    if (n === 0 || (!json.exceededTransferLimit && n < PAGE)) break;
  }
  rows.sort((a, b) => a.id - b.id);
  const out = {
    source: "City of Atlanta, Department of City Planning GIS, Street centerlines",
    catalogId: CATALOG_ID,
    layer: LAYER,
    terms: "Public City of Atlanta GIS service. No license is stated. Cite the City of Atlanta Department of City Planning.",
    fetchedAt: new Date().toISOString(),
    bbox,
    rows: rows.length,
    segments: rows,
  };
  writeFileSync(resolve(level, "raw", "city-streets.json"), `${JSON.stringify(out)}\n`);
  console.log(`city-streets: ${rows.length} centerline segments`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
