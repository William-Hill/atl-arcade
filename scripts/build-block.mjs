// Builds one real Atlanta block from OpenStreetMap into a level file.
//
//   node scripts/build-block.mjs --bbox 33.7560,-84.3685,33.7735,-84.3580 --out levels/beltline-eastside/
//
// Options:
//   --bbox south,west,north,east   degrees (the Overpass order). Required.
//   --out <dir>                    the level folder. Required.
//   --name <name>                  the level name. Default: the folder name.
//   --title <text>                 the display name.
//   --refresh                      fetch again, even when a cache exists.
//   --refresh-furniture            fetch only the street furniture again.
//   --offline                      never fetch; fail when the cache is missing.
//   --sources <file>               the building source file. Default:
//                                  data/buildings/<name>.json when it exists.
//
// The first run fetches from the Overpass API and writes the raw answer to
// <out>/raw/overpass.json, and the street furniture points to
// <out>/raw/street-furniture.json. Later runs read those files, so the script runs
// offline. The output is <out>/level.json: buildings (footprints with
// heights), strips (streets, sidewalks, paths, the BeltLine trail), and areas
// (parks), in local meters with the origin at the bbox center.
//
// Data: (c) OpenStreetMap contributors, ODbL 1.0. See docs/sources.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import polygonClipping from "polygon-clipping";
import { bboxCenter, createProjection, parseBbox } from "../src/level/geo/projection.js";
import { cleanRing, signedArea } from "../src/level/geo/extrude.js";
import { FOOTPRINT_GRADE, decodeHeights, encodeHeights, gradeBridgeEnds, gradeFootprints, gradeTrail, gradeWays, bridgeNodes, raiseEmbankments, terrainOf } from "../src/level/geo/terrain.js";
import { shortName } from "../src/level/geo/signs.js";
import { createStreetNamer } from "./street-names.mjs";

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const USER_AGENT = "atl-arcade-build-block/0.1 (https://github.com/William-Hill/atl-arcade)";

// Surface tops in meters. The sidewalk is a 0.15 m curb over the street.
// The small steps between flat kinds keep the render free of z-fighting;
// all of them are under SKATE.maxStep, so the skater rolls over them.
export const SURFACES = { ground: 0, park: 0.02, street: 0.03, path: 0.05, trail: 0.07, sidewalk: 0.15 };

// Default widths in meters when a way has no width tag.
const STREET_WIDTH = {
  trunk: 14,
  primary: 13,
  secondary: 12,
  tertiary: 10,
  unclassified: 8,
  residential: 8,
  living_street: 6,
  pedestrian: 6,
  service: 4,
};
const SERVICE_WIDTH = { parking_aisle: 5, driveway: 3, alley: 4 };
const PATH_WIDTH = { cycleway: 3, footway: 2, path: 2 };
const SIDEWALK_WIDTH = 2;
const TRAIL_WIDTH = 4.3; // The Eastside Trail is 14 ft wide.
const TRAIL_NAME = /beltline eastside trail/i;

// Heights when a building has no height and no levels tag.
const DEFAULT_HEIGHT = {
  house: 7,
  detached: 7,
  semidetached_house: 7,
  terrace: 8,
  residential: 9,
  apartments: 15,
  dormitory: 15,
  hotel: 20,
  office: 18,
  commercial: 9,
  retail: 6,
  industrial: 9,
  warehouse: 9,
  church: 12,
  school: 9,
  garage: 3,
  garages: 3,
  shed: 3,
  carport: 3,
  roof: 4,
  parking: 12,
};
const FALLBACK_HEIGHT = 8;
const LEVEL_HEIGHT = 3.2;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

export function overpassQuery(b) {
  const box = `${b.south},${b.west},${b.north},${b.east}`;
  return [
    "[out:json][timeout:120];",
    "(",
    `  way["building"](${box});`,
    `  relation["building"](${box});`,
    `  way["highway"](${box});`,
    `  way["leisure"="park"](${box});`,
    `  relation["leisure"="park"](${box});`,
    `  way["landuse"="grass"](${box});`,
    ");",
    "out body geom;",
  ].join("\n");
}

// The street furniture points (issue: props at real OSM positions). A
// separate query and cache (raw/street-furniture.json), so a fetch of the
// furniture does not fetch the buildings again.
export const FURNITURE_TAGS = {
  amenity: ["bench", "waste_basket", "bicycle_parking", "drinking_water"],
  highway: ["street_lamp"],
  barrier: ["bollard"],
};

export function furnitureQuery(b) {
  const box = `${b.south},${b.west},${b.north},${b.east}`;
  const lines = Object.entries(FURNITURE_TAGS).map(([k, vs]) => `  node["${k}"~"^(${vs.join("|")})$"](${box});`);
  return ["[out:json][timeout:60];", "(", ...lines, ");", "out body;"].join("\n");
}

// The tags that the props use. The other tags stay in the raw file.
const FURNITURE_KEEP = ["backrest", "material", "colour", "seats", "covered", "bicycle_parking", "capacity", "direction"];

// Turns the raw furniture answer into level points: [{ id, kind, x, z, tags }].
// `kind` is the OSM value (bench, waste_basket, ...). Points outside the box
// are left out. Sorted by id.
export function furniturePoints(raw, proj, box) {
  const out = [];
  for (const e of raw?.elements ?? []) {
    if (e.type !== "node" || !e.tags) continue;
    const kind = Object.entries(FURNITURE_TAGS).map(([k, vs]) => (vs.includes(e.tags[k]) ? e.tags[k] : null)).find(Boolean);
    if (!kind) continue;
    const [x, z] = proj.toLocal(e.lat, e.lon).map(round);
    if (!inBox([x, z], box)) continue;
    const item = { id: `n${e.id}`, kind, x, z };
    const tags = Object.fromEntries(FURNITURE_KEEP.filter((k) => e.tags[k] !== undefined).map((k) => [k, e.tags[k]]));
    if (Object.keys(tags).length) item.tags = tags;
    out.push(item);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function fetchOverpass(query) {
  let lastError = null;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const json = await res.json();
      // Overpass answers HTTP 200 with a "remark" when the query times out or
      // runs out of memory. That answer is incomplete: try the next endpoint,
      // and never cache it.
      if (json?.remark) throw new Error(`${url}: Overpass remark: ${json.remark}`);
      if (!Array.isArray(json?.elements)) throw new Error(`${url}: the answer has no elements array`);
      return { json, endpoint: url };
    } catch (err) {
      lastError = err;
      console.warn(`build-block: ${String(err)}`);
    }
  }
  throw lastError ?? new Error("build-block: no Overpass endpoint");
}

// Parses "50", "50 m", "164'", "164 ft". Returns meters or null.
export function parseHeight(text) {
  if (text === undefined || text === null) return null;
  const s = String(text).trim().toLowerCase();
  const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(m|ft|'|feet)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  return unit === "ft" || unit === "'" || unit === "feet" ? n * 0.3048 : n;
}

// The lowest Overture height to use. Lower values are sheds and carports;
// 2.5 m keeps them from a flat, slab look.
const MIN_OVERTURE_HEIGHT = 2.5;

// Overture estimates some small buildings far too tall (51 houses over 20 m
// on the BeltLine level, the highest 37.1 m). An Overture height for these
// OSM types is capped. A real tall house has an OSM height or levels tag.
export const OVERTURE_CAP = { house: 12, detached: 12, semidetached_house: 12, bungalow: 10, terrace: 14, garage: 6, garages: 6, shed: 5, carport: 5, hut: 5 };

// The order: a value in the level heights.json (with a source), the OSM
// height tag, the OSM levels tag, the Overture height (raw/overture.json,
// from scripts/overture-heights.py, capped by OVERTURE_CAP), the Overture
// floor count, and last a default for the building type.
export function buildingHeight(tags, overture = null, override = null) {
  if (override?.height > 0) return { height: override.height, source: "override" };
  const h = parseHeight(tags.height);
  if (h && h > 0) return { height: h, source: "height" };
  const levels = Number(tags["building:levels"]);
  if (Number.isFinite(levels) && levels > 0) return { height: levels * LEVEL_HEIGHT + 1, source: "levels" };
  const cap = OVERTURE_CAP[tags.building] ?? Infinity;
  if (overture?.height > 0) {
    const raw = Math.max(overture.height, MIN_OVERTURE_HEIGHT);
    return raw > cap ? { height: cap, source: "overture-capped" } : { height: raw, source: "overture" };
  }
  if (overture?.floors > 0) {
    const raw = overture.floors * LEVEL_HEIGHT + 1;
    return raw > cap ? { height: cap, source: "overture-capped" } : { height: raw, source: "overture" };
  }
  const t = tags.building;
  return { height: DEFAULT_HEIGHT[t] ?? FALLBACK_HEIGHT, source: "default" };
}

// Classifies a highway way. Returns { kind, width } or null to skip it.
export function classifyWay(tags) {
  const hw = tags.highway;
  if (!hw) return null;
  if (tags.tunnel === "yes" || tags.area === "yes") return null;
  if (hw === "steps" || hw === "construction" || hw === "proposed" || hw === "elevator") return null;
  const tagWidth = parseHeight(tags.width);
  if (TRAIL_NAME.test(tags.name ?? "")) return { kind: "trail", width: tagWidth ?? TRAIL_WIDTH };
  if (hw === "footway" && tags.footway === "sidewalk") return { kind: "sidewalk", width: tagWidth ?? SIDEWALK_WIDTH };
  if (hw === "footway" && tags.footway === "crossing") return null; // A crossing lies on the street.
  if (hw === "cycleway" && tags.cycleway === "crossing") return null;
  if (PATH_WIDTH[hw] !== undefined) return { kind: "path", width: tagWidth ?? PATH_WIDTH[hw] };
  if (STREET_WIDTH[hw] !== undefined) {
    let width = STREET_WIDTH[hw];
    if (hw === "service") width = SERVICE_WIDTH[tags.service] ?? width;
    const lanes = Number(tags.lanes);
    if (Number.isFinite(lanes) && lanes > 0 && hw !== "service") width = Math.max(width, lanes * 3.3);
    return { kind: "street", width: tagWidth ?? width };
  }
  return null;
}

// The lane tags of a street way (#138), for the road markings
// (src/level/geo/markings.js): the lane count, the lanes in each direction,
// one way, the turn lanes (as the OSM value, "left|through;right"), and the
// sides with a painted bike lane ("left", "right", or "both").
// A tag that is not there gives no field.
export function laneTags(tags) {
  const out = {};
  const count = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  if (count(tags.lanes)) out.lanes = count(tags.lanes);
  if (count(tags["lanes:forward"])) out.lanesForward = count(tags["lanes:forward"]);
  if (count(tags["lanes:backward"])) out.lanesBackward = count(tags["lanes:backward"]);
  if (tags.oneway === "yes") out.oneway = true;
  const forward = tags["turn:lanes"] ?? tags["turn:lanes:forward"];
  if (forward) out.turnLanes = forward;
  if (tags["turn:lanes:backward"]) out.turnLanesBackward = tags["turn:lanes:backward"];
  const lane = (v) => v === "lane" || v === "track";
  let left = lane(tags["cycleway:left"]) || lane(tags["cycleway:both"]) || lane(tags.cycleway);
  let right = lane(tags["cycleway:right"]) || lane(tags["cycleway:both"]) || lane(tags.cycleway);
  // On a one-way street, "cycleway=lane" is on the right side only.
  if (out.oneway && lane(tags.cycleway) && !lane(tags["cycleway:left"]) && !lane(tags["cycleway:both"])) left = false;
  if (left && right) out.cycleway = "both";
  else if (left) out.cycleway = "left";
  else if (right) out.cycleway = "right";
  return out;
}

// A crossing of a footway over a street (#136): { id, points, marked }.
// `marked` is true when the crossing has paint (crossing=marked, zebra,
// or crossing:markings other than "no" or "surface").
export function crossingOf(tags) {
  if (!((tags.highway === "footway" && tags.footway === "crossing") || (tags.highway === "cycleway" && tags.cycleway === "crossing"))) return null;
  const m = tags["crossing:markings"];
  const marked = m ? m !== "no" && m !== "surface" : tags.crossing === "marked" || tags.crossing === "zebra";
  return { marked };
}

const round = (n) => Math.round(n * 100) / 100 + 0; // + 0 turns -0 into 0.

// Clips a polyline to a rectangle. Returns a list of polylines.
export function clipPolyline(points, box) {
  const out = [];
  let current = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const seg = clipSegment(points[i], points[i + 1], box);
    if (!seg) {
      current = null;
      continue;
    }
    const [a, b] = seg;
    if (current && current[current.length - 1][0] === a[0] && current[current.length - 1][1] === a[1]) current.push(b);
    else {
      current = [a, b];
      out.push(current);
    }
  }
  return out;
}

// Liang-Barsky. Returns [a, b] or null.
function clipSegment(p, q, { minX, maxX, minZ, maxZ }) {
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dz = q[1] - p[1];
  const checks = [
    [-dx, p[0] - minX],
    [dx, maxX - p[0]],
    [-dz, p[1] - minZ],
    [dz, maxZ - p[1]],
  ];
  for (const [pp, qq] of checks) {
    if (pp === 0) {
      if (qq < 0) return null;
      continue;
    }
    const r = qq / pp;
    if (pp < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  const a = t0 === 0 ? p : [round(p[0] + t0 * dx), round(p[1] + t0 * dz)];
  const b = t1 === 1 ? q : [round(p[0] + t1 * dx), round(p[1] + t1 * dz)];
  return [a, b];
}

// Joins way pieces (lists of points) into closed rings, end to end.
export function joinRings(pieces) {
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3;
  const open = pieces.filter((p) => p.length >= 2).map((p) => p.slice());
  const rings = [];
  while (open.length) {
    let ring = open.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i += 1) {
        const p = open[i];
        const end = ring[ring.length - 1];
        if (same(end, p[0])) ring = ring.concat(p.slice(1));
        else if (same(end, p[p.length - 1])) ring = ring.concat(p.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (same(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

function centroid(ring) {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

function inBox([x, z], box) {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

// Turns the raw Overpass answer into the level data. Pure, so a test can
// call it on a small fixture.
// `overture` maps an OSM id ("w123") to { height, floors } (raw/overture.json).
// `terrain` is the grid from raw/terrain.json (scripts/terrain-dem.py).
// `heights` maps an OSM id to { height, source } (the level heights.json).
// `sources` maps a level building id to its record in the building source
// file (data/buildings/<name>.json, issue #88). With `sources`, each height
// comes from its record, and a building with no record is an error.
// `cityStreets` is raw/city-streets.json (scripts/city-streets.mjs). With it,
// the street names come from the City of Atlanta centerlines (issue #78,
// scripts/street-names.mjs).
// `furniture` is raw/street-furniture.json: the OSM street furniture points.
export function buildLevel(raw, { bbox, name, title, overture = null, terrain = null, heights = null, sources = null, cityStreets = null, furniture = null }) {
  const origin = bboxCenter(bbox);
  const proj = createProjection(origin);
  const project = (g) => g.map(({ lat, lon }) => proj.toLocal(lat, lon).map(round));
  const [minX, maxZ] = proj.toLocal(bbox.south, bbox.west).map(round);
  const [maxX, minZ] = proj.toLocal(bbox.north, bbox.east).map(round);
  const box = { minX, maxX, minZ, maxZ };

  const buildings = [];
  const strips = [];
  const areas = [];
  const crossings = [];
  const counts = { override: 0, height: 0, levels: 0, overture: 0, "overture-capped": 0, default: 0 };

  function addPolygon(target, id, outerRings, innerRings, extra) {
    for (const [i, outerRaw] of outerRings.entries()) {
      const outer = cleanRing(outerRaw);
      if (outer.length < 3 || Math.abs(signedArea(outer)) < 4) continue; // under 4 m^2: skip.
      if (!inBox(centroid(outer), box)) continue;
      const holes = innerRings.map(cleanRing).filter((h) => h.length >= 3 && inPolygon(centroid(h), outer));
      const item = { id: outerRings.length > 1 ? `${id}-${i}` : id, ...extra, outer };
      if (holes.length) item.holes = holes;
      target.push(item);
    }
  }

  // The strips come first: the building pass needs them.
  const footprints = [];
  for (const e of raw.elements ?? []) {
    const tags = e.tags ?? {};
    const id = `${e.type === "way" ? "w" : "r"}${e.id}`;
    const isBuilding = tags.building && tags.building !== "no";
    const isPark = tags.leisure === "park" || tags.landuse === "grass";
    if (isBuilding || isPark) {
      footprints.push({ e, tags, id, isBuilding });
      continue;
    }
    if (e.type !== "way" || !e.geometry) continue;
    const crossing = crossingOf(tags);
    if (crossing) {
      for (const [i, points] of clipPolyline(project(e.geometry), box).entries()) crossings.push({ id: i ? `${id}-${i}` : id, points, marked: crossing.marked });
    }
    const cls = classifyWay(tags);
    if (!cls) continue;
    const pieces = clipPolyline(project(e.geometry), box);
    for (const [i, points] of pieces.entries()) {
      const item = { id: pieces.length > 1 ? `${id}-${i}` : id, kind: cls.kind, width: round(cls.width), points };
      if (tags.name) item.name = tags.name;
      if (tags.highway) item.highway = tags.highway;
      if (cls.kind === "street") Object.assign(item, laneTags(tags));
      // A bridge deck runs from the ground at one end to the ground at the
      // other (src/level/geo/terrain.js), over the ways under it.
      if (tags.bridge && tags.bridge !== "no") {
        item.bridge = true;
        item.layer = Number(tags.layer) || 1;
      }
      strips.push(item);
    }
  }

  // The sign names from the city centerlines. The strip name stays the OSM name.
  const nameCounts = { city: 0, reviewed: 0, osm: 0, changed: 0 };
  if (cityStreets) {
    const lines = cityStreets.segments.flatMap((seg) => seg.paths.map((p) => ({ label: seg.label, points: p.map(([lon, lat]) => proj.toLocal(lat, lon)) })));
    const nameOf = createStreetNamer(lines);
    for (const st of strips) {
      if (st.kind !== "street" || !st.name) continue;
      const r = nameOf(st);
      if (r.signName) st.signName = r.signName;
      st.nameSource = r.nameSource;
      nameCounts[r.nameSource] += 1;
      if (r.signName && r.signName !== shortName(st.name)) nameCounts.changed += 1;
    }
  }

  const corridor = trailCorridor(strips);
  const ways = strips.filter((st) => st.kind === "trail" || st.kind === "path");
  for (const { e, tags, id, isBuilding } of footprints) {
    let outers = [];
    let inners = [];
    if (e.type === "way" && e.geometry) outers = [project(e.geometry)];
    else if (e.type === "relation" && e.members) {
      const memberRings = (role) => e.members.filter((m) => m.type === "way" && m.geometry && (m.role || "outer") === role).map((m) => project(m.geometry));
      outers = joinRings(memberRings("outer"));
      inners = joinRings(memberRings("inner"));
    }
    if (isBuilding) {
      if (!hasGroundWalls(tags)) continue;
      const { height, source } = buildingHeight(tags, overture?.[id], heights?.[id]);
      const extra = { height: round(height), heightSource: source };
      if (tags.name) extra.name = tags.name;
      if (tags.building !== "yes") extra.type = tags.building;
      Object.assign(extra, buildingTags(tags));
      const items = [];
      addPolygon(items, id, outers, inners, extra);
      for (const item of items) {
        // A raised footprint (layer > 0) over a trail or a path is a deck or a
        // shed roof that the way runs under: skip it.
        if (Number(tags.layer) > 0 && ways.some((st) => stripCrosses(st, item.outer))) continue;
        for (const piece of clipOffCorridor(item, corridor)) {
          if (sources) {
            const rec = sources[piece.id];
            if (!rec?.height?.source || !(rec.height.value > 0)) throw new Error(`build-block: building ${piece.id} has no height record in the building source file`);
            piece.height = round(rec.height.value);
            piece.heightSource = rec.height.source;
          }
          buildings.push(piece);
          counts[piece.heightSource] = (counts[piece.heightSource] ?? 0) + 1;
        }
      }
    } else {
      const extra = { kind: "park" };
      if (tags.name) extra.name = tags.name;
      addPolygon(areas, id, outers, inners, extra);
    }
  }

  // Stable order, so a rebuild gives the same file.
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  buildings.sort(byId);
  strips.sort(byId);
  areas.sort(byId);
  crossings.sort(byId);

  // Raise the bridge approaches that the grid smooths (src/level/geo/terrain.js).
  let embankments = [];
  if (terrain) {
    // First a rail grade on the trail, then the playable ways to a skating
    // grade, then a pad under each building on a slope (#135; it keeps the
    // trail band and the ways), then the embankments at the bridge ends.
    const railed = gradeTrail({ ...terrain, heights: decodeHeights(terrain.data, terrain.cols * terrain.rows) }, strips).heights;
    const skated = gradeWays({ ...terrain, heights: railed }, strips).heights;
    const graded = gradeFootprints({ ...terrain, heights: skated }, buildings, strips).heights;
    const r = raiseEmbankments({ ...terrain, heights: graded }, strips);
    embankments = r.changes;
    // Last, the ground at the bridge joints goes on the deck line (#131).
    // A second pass takes the deck line ends from the graded ground, so the
    // runtime deck (bridgeDeck) has the same line as the grade.
    const once = gradeBridgeEnds({ ...terrain, heights: r.heights }, strips);
    const ends = gradeBridgeEnds({ ...terrain, heights: once.heights }, strips);
    // The embankments and the bridge ends steepen the ways near the decks
    // again: grade the ways once more with the bridge nodes pinned, then the
    // lots again, off the way network only, so a way keeps its grade.
    const skating = gradeWays({ ...terrain, heights: ends.heights }, strips, { pinned: bridgeNodes(terrain, strips) });
    const wayMargin = terrain.cell * Math.SQRT2 + 0.01;
    const lots = gradeFootprints({ ...terrain, heights: skating.heights }, buildings, strips, { ...FOOTPRINT_GRADE, wayMargin, trailMargin: Math.max(FOOTPRINT_GRADE.trailMargin, wayMargin) });
    terrain = { ...terrain, data: encodeHeights(lots.heights) };
  }
  const spawn = trailSpawn(strips.filter((st) => !st.bridge));
  if (terrain) spawn.position[1] = round(spawn.position[1] + terrainOf({ terrain }).height(spawn.position[0], spawn.position[2]));

  const level = {
    name,
    title,
    format: "geo-level/1",
    attribution: `Map data (c) OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright${overture ? ". Heights: Overture Maps Foundation" : ""}${terrain ? ". Elevation: USGS 3DEP" : ""}${cityStreets ? ". Street names: City of Atlanta Department of City Planning" : ""}`,
    bbox,
    origin,
    axes: "+x east, +y up, +z south; meters from the origin",
    bounds: box,
    spawn,
    surfaces: SURFACES,
    stats: {
      buildings: buildings.length,
      buildingHeights: counts,
      ...(sources ? { buildingSources: `data/buildings/${name}.json` } : {}),
      ...(cityStreets ? { streetNames: nameCounts } : {}),
      strips: Object.fromEntries(["street", "sidewalk", "path", "trail"].map((k) => [k, strips.filter((s) => s.kind === k).length])),
      areas: areas.length,
      crossings: crossings.length,
    },
    buildings,
    strips,
    areas,
    // The footway crossings over the streets (#136): the curb ramps go at their ends.
    crossings,
    // Greybox-style objects (rails, ledges, ramps). Empty until M1-04.
    objects: [],
  };
  if (furniture) {
    // The OSM street furniture points. src/level/geo/props.js puts a prop at each.
    level.furniture = furniturePoints(furniture, proj, box);
    level.stats.furniture = Object.fromEntries(Object.values(FURNITURE_TAGS).flat().map((k) => [k, level.furniture.filter((f) => f.kind === k).length]));
  }
  if (terrain) {
    level.terrain = terrain;
    level.stats.bridges = strips.filter((st) => st.bridge).length;
    level.stats.embankments = embankments.length;
  }
  return level;
}

// The OSM tags that the facade kit reads (issue #135): the floor count, the
// roof shape, the wall material, and the shop or the amenity in the
// building with its name. The game filters the shop names
// (src/level/geo/shop-signs.js); the level keeps the OSM values.
export function buildingTags(tags) {
  const out = {};
  const levels = Number(tags["building:levels"]);
  if (Number.isInteger(levels) && levels > 0) out.levels = levels;
  if (tags["roof:shape"]) out.roofShape = tags["roof:shape"];
  if (tags["building:material"]) out.material = tags["building:material"];
  const use = tags.shop ? { key: "shop", value: tags.shop } : tags.amenity ? { key: "amenity", value: tags.amenity } : null;
  if (use) out.use = tags.name ? { ...use, name: tags.name } : use;
  return out;
}

// OSM footprints with no walls down to the ground (issue #57): a roof is an
// open canopy, and a min_height or a min_level lifts the walls off the ground.
export function hasGroundWalls(tags) {
  if (tags.building === "roof") return false;
  if ((parseHeight(tags.min_height) ?? 0) > 0) return false;
  if (Number(tags["building:min_level"]) > 0) return false;
  return true;
}

// True when the strip center line goes into the ring, tested every 0.5 m.
export function stripCrosses(strip, ring) {
  for (let i = 0; i < strip.points.length - 1; i += 1) {
    const [ax, az] = strip.points[i];
    const [bx, bz] = strip.points[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
    for (let k = 0; k <= n; k += 1) if (inPolygon([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n], ring)) return true;
  }
  return false;
}

// The clear corridor along the trail: the strip half width plus this margin.
export const TRAIL_CLEARANCE = 0.5;

// The trail corridor as polygons (one box for each segment and a 16-gon at
// each point), with a bounding box for a fast reject.
export function trailCorridor(strips) {
  const polys = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of strips) {
    if (s.kind !== "trail") continue;
    const r = s.width / 2 + TRAIL_CLEARANCE;
    for (const [i, [x, z]] of s.points.entries()) {
      const disc = [];
      for (let k = 0; k < 16; k += 1) disc.push([x + r * Math.cos((k * Math.PI) / 8), z + r * Math.sin((k * Math.PI) / 8)]);
      polys.push([[...disc, disc[0]]]);
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
      minZ = Math.min(minZ, z - r);
      maxZ = Math.max(maxZ, z + r);
      if (i === s.points.length - 1) continue;
      const [bx, bz] = s.points[i + 1];
      const len = Math.hypot(bx - x, bz - z);
      if (len === 0) continue;
      const nx = (-(bz - z) / len) * r;
      const nz = ((bx - x) / len) * r;
      polys.push([[[x + nx, z + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [x - nx, z - nz], [x + nx, z + nz]]]);
    }
  }
  return { polys, box: { minX, maxX, minZ, maxZ } };
}

// Cuts the trail corridor out of a building footprint (issue #57: the
// "725 Ponce" edge runs along the trail). Returns the item unchanged when the
// corridor does not touch it, or the pieces that are left, each 4 m^2 or more.
export function clipOffCorridor(item, corridor) {
  const ring = item.outer;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const b = corridor.box;
  if (maxX < b.minX || minX > b.maxX || maxZ < b.minZ || minZ > b.maxZ) return [item];
  const close = (r) => [...r, r[0]];
  const shape = [close(ring), ...(item.holes ?? []).map(close)];
  const near = corridor.polys.filter((p) => {
    const xs = p[0].map((q) => q[0]);
    const zs = p[0].map((q) => q[1]);
    return Math.max(...xs) >= minX && Math.min(...xs) <= maxX && Math.max(...zs) >= minZ && Math.min(...zs) <= maxZ;
  });
  if (!near.length || !polygonClipping.intersection(shape, polygonClipping.union(...near)).length) return [item];
  const pieces = [];
  for (const poly of polygonClipping.difference(shape, ...near)) {
    const [outer, ...holes] = poly.map((r) => cleanRing(r.slice(0, -1).map(([x, z]) => [round(x), round(z)])));
    if (outer.length < 3 || Math.abs(signedArea(outer)) < 4) continue;
    const kept = holes.filter((h) => h.length >= 3);
    pieces.push({ outer, ...(kept.length ? { holes: kept } : {}) });
  }
  const { outer: _o, holes: _h, ...rest } = item;
  return pieces.map((p, i) => ({ ...rest, id: pieces.length > 1 ? `${item.id}-${i}` : item.id, ...p }));
}

function inPolygon([x, z], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// The spawn is the trail point closest to the origin. The skater faces
// north along the trail (toward Ponce City Market on the Eastside Trail).
export function trailSpawn(strips) {
  let best = null;
  for (const s of strips) {
    if (s.kind !== "trail") continue;
    for (let i = 0; i < s.points.length - 1; i += 1) {
      const a = s.points[i];
      const b = s.points[i + 1];
      const d = Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (!best || d < best.d) best = { d, a, b };
    }
  }
  if (!best) return { position: [0, 0, 0], yaw: 0 };
  let dx = best.b[0] - best.a[0];
  let dz = best.b[1] - best.a[1];
  if (dz > 0) {
    dx = -dx;
    dz = -dz;
  }
  const p = [round((best.a[0] + best.b[0]) / 2), SURFACES.trail, round((best.a[1] + best.b[1]) / 2)];
  // Forward is (cos yaw, 0, -sin yaw) in the controller.
  return { position: p, yaw: Math.round(Math.atan2(-dz, dx) * 1000) / 1000 };
}

// Reads the cached Overpass answer when its query matches, or fetches it and
// writes the answer and its meta file.
async function cachedOverpass(rawFile, metaFile, query, bbox, args) {
  if (existsSync(rawFile) && existsSync(metaFile) && !args.refresh) {
    const meta = JSON.parse(readFileSync(metaFile, "utf8"));
    if (meta.query === query) {
      // Valid JSON is not enough: a cut or edited file must have the
      // elements list, or it counts as a miss.
      const cached = JSON.parse(readFileSync(rawFile, "utf8"));
      if (Array.isArray(cached?.elements)) {
        console.log(`build-block: cache hit ${rawFile} (fetched ${meta.fetchedAt})`);
        return cached;
      }
      console.log(`build-block: ${rawFile} has no elements list; fetch again`);
    } else console.log(`build-block: the cached query in ${metaFile} differs; fetch again`);
  }
  if (args.offline) throw new Error(`build-block: --offline and no matching cache at ${rawFile}`);
  console.log(`build-block: fetch ${rawFile} from Overpass`);
  const { json, endpoint } = await fetchOverpass(query);
  writeFileSync(rawFile, JSON.stringify(json));
  const meta = {
    source: "OpenStreetMap via the Overpass API",
    license: "ODbL 1.0",
    attribution: "(c) OpenStreetMap contributors",
    endpoint,
    fetchedAt: new Date().toISOString(),
    osmBase: json.osm3s?.timestamp_osm_base ?? null,
    bbox,
    query,
  };
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  return json;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // The value options need a value: "--out" with nothing after it is an error,
  // not the default.
  const missing = ["bbox", "out", "name", "title", "sources"].filter((k) => k in args && typeof args[k] !== "string");
  if (missing.length) {
    console.error(`build-block: ${missing.map((k) => `--${k}`).join(", ")} needs a value`);
    process.exit(2);
  }
  if (!args.bbox || !args.out) {
    console.error("usage: node scripts/build-block.mjs --bbox south,west,north,east --out levels/<name>/ [--name n] [--title t] [--refresh] [--offline]");
    process.exit(2);
  }
  const bbox = parseBbox(args.bbox);
  const outDir = resolve(String(args.out));
  const name = typeof args.name === "string" ? args.name : basename(outDir);
  const title = typeof args.title === "string" ? args.title : name;
  const rawDir = resolve(outDir, "raw");
  const rawFile = resolve(rawDir, "overpass.json");
  const metaFile = resolve(rawDir, "fetch.json");
  const query = overpassQuery(bbox);
  mkdirSync(rawDir, { recursive: true });

  const raw = await cachedOverpass(rawFile, metaFile, query, bbox, args);
  // The street furniture: its own query and cache. --refresh-furniture
  // fetches only the furniture again.
  // With --offline and no furniture cache, the level builds with no
  // furniture, as before the furniture query.
  const furnitureArgs = { ...args, refresh: args.refresh || args["refresh-furniture"] };
  const furnitureFile = resolve(rawDir, "street-furniture.json");
  let furniture = null;
  if (args.offline && !existsSync(furnitureFile)) console.log(`build-block: --offline and no ${furnitureFile}; no street furniture`);
  else {
    furniture = await cachedOverpass(furnitureFile, resolve(rawDir, "street-furniture-fetch.json"), furnitureQuery(bbox), bbox, furnitureArgs);
    console.log(`build-block: ${furniture.elements.length} street furniture points`);
  }

  // Building heights from Overture (scripts/overture-heights.py), when present.
  const overtureFile = resolve(rawDir, "overture.json");
  const overture = existsSync(overtureFile) ? JSON.parse(readFileSync(overtureFile, "utf8")).heights : null;
  if (overture) console.log(`build-block: ${Object.keys(overture).length} Overture heights from ${overtureFile}`);
  // The ground elevation (scripts/terrain-dem.py), when present.
  const terrainFile = resolve(rawDir, "terrain.json");
  const terrain = existsSync(terrainFile) ? JSON.parse(readFileSync(terrainFile, "utf8")).terrain : null;
  if (terrain) console.log(`build-block: terrain ${terrain.cols} x ${terrain.rows} from ${terrainFile}`);
  // Height overrides with sources (levels/<name>/heights.json), when present.
  const heightsFile = resolve(outDir, "heights.json");
  const heights = existsSync(heightsFile) ? JSON.parse(readFileSync(heightsFile, "utf8")).heights : null;
  if (heights) console.log(`build-block: ${Object.keys(heights).length} height overrides from ${heightsFile}`);
  // The building source file (issue #88, scripts/building-sources.mjs). Each
  // height comes from it when it exists.
  const sourcesFile = typeof args.sources === "string" ? resolve(args.sources) : resolve(import.meta.dirname, "..", "data", "buildings", `${name}.json`);
  const sources = existsSync(sourcesFile) ? JSON.parse(readFileSync(sourcesFile, "utf8")).buildings : null;
  if (typeof args.sources === "string" && !sources) throw new Error(`build-block: no building source file at ${sourcesFile}`);
  if (sources) console.log(`build-block: ${Object.keys(sources).length} building records from ${sourcesFile}`);
  // The City of Atlanta street centerlines (scripts/city-streets.mjs), when
  // present. The street names come from them.
  const cityStreetsFile = resolve(rawDir, "city-streets.json");
  const cityStreets = existsSync(cityStreetsFile) ? JSON.parse(readFileSync(cityStreetsFile, "utf8")) : null;
  if (cityStreets) console.log(`build-block: ${cityStreets.segments.length} city centerline segments from ${cityStreetsFile}`);
  const level = buildLevel(raw, { bbox, name, title, overture, terrain, heights, sources, cityStreets, furniture });
  const outFile = resolve(outDir, "level.json");
  writeFileSync(outFile, `${JSON.stringify(level)}\n`);
  console.log(`build-block: wrote ${outFile}`);
  console.log(JSON.stringify(level.stats));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
