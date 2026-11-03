// Writes the building source file for a level (issue #88).
//
//   node scripts/building-sources.mjs levels/beltline-eastside/
//
// Inputs (all cached, so the script runs offline):
//   <level>/raw/fetch.json           the bbox
//   <level>/raw/overpass.json        OSM footprints and tags
//   <level>/raw/overture.json        Overture heights (scripts/overture-heights.py)
//   <level>/raw/city-addresses.json  City of Atlanta address points (scripts/city-addresses.mjs)
//   <level>/heights.json             researched height overrides, each with a source
//
// Outputs:
//   data/buildings/<name>.json       one record for each building in the level
//   data/buildings/<name>.report.md  counts for each source, and the address disagreements
//
// scripts/build-block.mjs then reads the heights from the source file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildingHeight, buildLevel } from "./build-block.mjs";
import { createProjection } from "../src/level/geo/projection.js";
import { chooseStyle } from "../src/level/geo/styles.js";
import {
  HEIGHT_CONFIDENCE,
  cityAddressText,
  inFootprint,
  interiorPoint,
  osmAddressText,
  osmIdOf,
  pickCityAddress,
  recordProblems,
  sameAddress,
} from "../src/level/geo/building-sources.js";

const ROOT = resolve(import.meta.dirname, "..");
const LEVEL_HEIGHT = 3.2;
const round = (n) => Math.round(n * 100) / 100 + 0;
const round7 = (n) => Math.round(n * 1e7) / 1e7;

// The reference text for a height source.
function heightRef(source, { override, overtureRelease }) {
  if (source === "override") return override.source;
  if (source === "height") return "OpenStreetMap tag height";
  if (source === "levels") return "OpenStreetMap tag building:levels x 3.2 m + 1 m";
  if (source === "overture" || source === "overture-capped") return `Overture Maps buildings, release ${overtureRelease}`;
  return "the default height for the OSM building type (scripts/build-block.mjs DEFAULT_HEIGHT)";
}

// Builds the records. Pure: the inputs are parsed JSON.
export function buildSources({ raw, bbox, name, overture, heights, city }) {
  const overtureRows = overture?.heights ?? null;
  const level = buildLevel(raw, { bbox, name, title: name, overture: overtureRows, heights });
  const proj = createProjection(level.origin);
  const tagsById = {};
  for (const e of raw.elements ?? []) tagsById[`${e.type === "way" ? "w" : "r"}${e.id}`] = e.tags ?? {};

  // The city points in local meters, with a coarse grid for a fast lookup.
  const cell = 50;
  const grid = new Map();
  const points = (city?.points ?? []).map((p) => {
    const [x, z] = proj.toLocal(p.lat, p.lon);
    const q = { ...p, x, z };
    const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(q);
    return q;
  });

  const records = [];
  const disagreements = [];
  const usedPoints = new Set();
  for (const b of level.buildings) {
    const osmId = osmIdOf(b.id);
    const tags = tagsById[osmId] ?? {};
    const override = heights?.[osmId] ?? null;
    const ov = overtureRows?.[osmId] ?? null;

    // Height: the same order as before (scripts/build-block.mjs buildingHeight).
    const h = buildingHeight(tags, ov, override);
    const height = { value: round(h.height), source: h.source, confidence: HEIGHT_CONFIDENCE[h.source], ref: heightRef(h.source, { override, overtureRelease: overture?.release }) };
    if (h.source === "override" && override.was) height.was = override.was;

    // Floors.
    const levels = Number(tags["building:levels"]);
    let floors;
    if (Number.isFinite(levels) && levels > 0) floors = { value: levels, source: "osm", confidence: "high", ref: "OpenStreetMap tag building:levels" };
    else if (override?.stories > 0) floors = { value: override.stories, source: "research", confidence: "medium", ref: override.source };
    else if (ov?.floors > 0) floors = { value: ov.floors, source: "overture", confidence: "medium", ref: `Overture Maps buildings, release ${overture.release}` };
    else floors = { value: Math.max(1, Math.round((height.value - 1) / LEVEL_HEIGHT)), source: "estimate", confidence: "low", ref: "(height - 1 m) / 3.2 m" };

    // Name.
    let nameFact;
    if (tags.name) nameFact = { value: tags.name, source: "osm", confidence: "high", ref: "OpenStreetMap tag name" };
    else if (override?.name) nameFact = { value: override.name, source: "research", confidence: "medium", ref: override.source };
    else nameFact = { value: null, source: "none", confidence: "none" };

    // Facade: OSM has no material tag on this level, so the value is the
    // game facade style, which is a rule and not a survey.
    const material = tags["building:material"] ?? tags["building:facade:material"];
    const facade = material
      ? { value: material, source: "osm", confidence: "high", ref: "OpenStreetMap tag building:material" }
      : { value: chooseStyle({ id: b.id, name: b.name, type: b.type, height: height.value, outer: b.outer }), source: "style-rule", confidence: "low", ref: "src/level/geo/styles.js chooseStyle (a game style, not a surveyed material)" };

    // Address: the city points inside the footprint, else the OSM addr:* tags.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of b.outer) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const inside = [];
    for (let gx = Math.floor(minX / cell); gx <= Math.floor(maxX / cell); gx += 1) {
      for (let gz = Math.floor(minZ / cell); gz <= Math.floor(maxZ / cell); gz += 1) {
        for (const p of grid.get(`${gx},${gz}`) ?? []) if (inFootprint([p.x, p.z], b)) inside.push(p);
      }
    }
    for (const p of inside) usedPoints.add(p.id);
    const osmText = osmAddressText(tags);
    const pick = pickCityAddress(inside, osmText);
    let address;
    if (pick) {
      address = { value: pick.text, source: "city", confidence: "high", ref: `${city.source}, OBJECTID ${pick.point.id}`, point: [pick.point.lon, pick.point.lat], cityPoints: inside.length };
      if (osmText) address.osm = osmText;
      if (pick.others.length) address.otherCity = pick.others;
      const agrees = sameAddress(pick.text, osmText) || pick.others.some((t) => sameAddress(t, osmText));
      if (osmText && !agrees) disagreements.push({ id: b.id, name: nameFact.value, city: pick.text, osm: osmText });
    } else if (osmText) {
      const [x, z] = interiorPoint(b);
      const ll = proj.toLatLon(x, z);
      address = { value: osmText, source: "osm", confidence: "medium", ref: "OpenStreetMap tags addr:housenumber and addr:street", point: [round7(ll.lon), round7(ll.lat)], pointSource: "a point inside the footprint" };
    } else address = { value: null, source: "none", confidence: "none" };

    records.push({ id: b.id, osmId, type: b.type ?? "yes", name: nameFact, address, height, floors, facade });
  }

  const count = (key) => {
    const out = {};
    for (const r of records) out[r[key].source] = (out[r[key].source] ?? 0) + 1;
    return Object.fromEntries(Object.entries(out).sort());
  };
  const stats = {
    buildings: records.length,
    height: count("height"),
    floors: count("floors"),
    name: count("name"),
    address: count("address"),
    facade: count("facade"),
    cityPoints: points.length,
    cityPointsInFootprints: usedPoints.size,
    addressDisagreements: disagreements.length,
  };
  return { level, records, stats, disagreements };
}

export function sourceFile({ name, records, stats, overture, city }) {
  return {
    about:
      "The building source file (issue #88). One record for each building in the level, keyed by the level building id. Each fact has a value, a source, a confidence (high, medium, low, none), and a ref. scripts/build-block.mjs takes each height from here. Written by scripts/building-sources.mjs; do not edit by hand, edit the inputs.",
    level: name,
    inputs: {
      osm: `levels/${name}/raw/overpass.json (OpenStreetMap contributors, ODbL 1.0)`,
      overture: overture ? `levels/${name}/raw/overture.json (Overture Maps Foundation, release ${overture.release}, ODbL 1.0)` : null,
      city: city ? `levels/${name}/raw/city-addresses.json (${city.source}, open-data-atl catalog ${city.catalogId})` : null,
      overrides: `levels/${name}/heights.json`,
    },
    confidence: {
      high: "a value for this building from a primary source",
      medium: "a value for this building from a rule or a model",
      low: "a value that does not come from this building",
      none: "no source has a value",
    },
    stats,
    buildings: Object.fromEntries(records.map((r) => [r.id, r])),
  };
}

export function reportText({ name, stats, disagreements }) {
  const lines = [];
  lines.push(`# Building sources: ${name}`, "");
  lines.push(`Written by \`scripts/building-sources.mjs\`. ${stats.buildings} buildings.`, "");
  for (const key of ["height", "floors", "address", "name", "facade"]) {
    lines.push(`## ${key[0].toUpperCase()}${key.slice(1)}`, "", "| Source | Buildings |", "| --- | ---: |");
    for (const [k, n] of Object.entries(stats[key])) lines.push(`| ${k} | ${n} |`);
    lines.push("");
  }
  lines.push("## City address points", "");
  lines.push(`${stats.cityPoints} current City of Atlanta address points in the box; ${stats.cityPointsInFootprints} are inside a building footprint.`, "");
  lines.push("## City and OSM address disagreements", "");
  lines.push(`${disagreements.length} buildings have a city address and an OSM address that do not agree. The source file uses the city address.`, "");
  if (disagreements.length) {
    lines.push("| Building | Name | City address | OSM address |", "| --- | --- | --- | --- |");
    for (const d of disagreements) lines.push(`| ${d.id} | ${d.name ?? ""} | ${d.city} | ${d.osm} |`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function readJson(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/building-sources.mjs levels/<name>/");
    process.exit(2);
  }
  const levelDir = resolve(dir);
  const name = basename(levelDir);
  const { bbox } = readJson(resolve(levelDir, "raw", "fetch.json"));
  const raw = readJson(resolve(levelDir, "raw", "overpass.json"));
  const overture = readJson(resolve(levelDir, "raw", "overture.json"));
  const city = readJson(resolve(levelDir, "raw", "city-addresses.json"));
  const heights = readJson(resolve(levelDir, "heights.json"))?.heights ?? null;
  const { records, stats, disagreements } = buildSources({ raw, bbox, name, overture, heights, city });
  const problems = records.flatMap(recordProblems);
  if (problems.length) throw new Error(`building-sources: ${problems.length} problems\n${problems.slice(0, 20).join("\n")}`);
  const outDir = resolve(ROOT, "data", "buildings");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, `${name}.json`), `${JSON.stringify(sourceFile({ name, records, stats, overture, city }), null, 1)}\n`);
  writeFileSync(resolve(outDir, `${name}.report.md`), reportText({ name, stats, disagreements }));
  console.log(`building-sources: wrote data/buildings/${name}.json and ${name}.report.md`);
  console.log(JSON.stringify(stats));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
