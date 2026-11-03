// Fetches the City of Atlanta address points for a level box.
//
//   node scripts/city-addresses.mjs levels/beltline-eastside/
//
// It reads the box from <level>/raw/fetch.json and writes
// <level>/raw/city-addresses.json: one row for each current address point,
// sorted by OBJECTID. scripts/building-sources.mjs reads that file, so the
// build runs offline after this fetch.
//
// Data: City of Atlanta, Department of City Planning GIS, "Official Address
// Points" (the open-data-atl catalog id dpcd-0a5785b3466a46c7a256f7fa9d628afd-0).
// The layer has no owner fields. See docs/sources.md.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const LAYER = "https://gis.atlantaga.gov/dpcd/rest/services/AdministrativeArea/AddressPoint/MapServer/0";
export const CATALOG_ID = "dpcd-0a5785b3466a46c7a256f7fa9d628afd-0";
const FIELDS = ["OBJECTID", "FULLADDR", "ADDRNUM", "ADDRNUMSUF", "ADDR_PD", "ADDR_SN", "ADDR_ST", "ADDR_SD", "UNITID", "STATUS"];
const PAGE = 1000;

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/city-addresses.mjs levels/<name>/");
    process.exit(2);
  }
  const level = resolve(dir);
  const { bbox } = JSON.parse(readFileSync(resolve(level, "raw", "fetch.json"), "utf8"));
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = new URLSearchParams({
      where: "STATUS='Current'",
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
    if (!res.ok) throw new Error(`city-addresses: HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`city-addresses: ${JSON.stringify(json.error)}`);
    for (const f of json.features ?? []) {
      const a = f.attributes;
      const trim = (v) => (typeof v === "string" ? v.trim() : v ?? "");
      rows.push({
        id: a.OBJECTID,
        full: trim(a.FULLADDR),
        number: trim(a.ADDRNUM),
        suffix: trim(a.ADDRNUMSUF),
        street: [a.ADDR_PD, a.ADDR_SN, a.ADDR_ST, a.ADDR_SD].map(trim).filter(Boolean).join(" "),
        unit: trim(a.UNITID),
        lon: Math.round(f.geometry.x * 1e7) / 1e7,
        lat: Math.round(f.geometry.y * 1e7) / 1e7,
      });
    }
    if (!json.exceededTransferLimit && (json.features ?? []).length < PAGE) break;
  }
  rows.sort((a, b) => a.id - b.id);
  const out = {
    source: "City of Atlanta, Department of City Planning GIS, Official Address Points",
    catalogId: CATALOG_ID,
    layer: LAYER,
    terms: "City of Atlanta open data, provided as is",
    fetchedAt: new Date().toISOString(),
    where: "STATUS='Current'",
    bbox,
    rows: rows.length,
    points: rows,
  };
  writeFileSync(resolve(level, "raw", "city-addresses.json"), `${JSON.stringify(out, null, 0)}\n`);
  console.log(`city-addresses: ${rows.length} current address points`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
