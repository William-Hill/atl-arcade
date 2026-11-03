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
//   --offline                      never fetch; fail when the cache is missing.
//
// The first run fetches from the Overpass API and writes the raw answer to
// <out>/raw/overpass.json. Later runs read that file, so the script runs
// offline. The output is <out>/level.json: buildings (footprints with
// heights), strips (streets, sidewalks, paths, the BeltLine trail), and areas
// (parks), in local meters with the origin at the bbox center.
//
// Data: (c) OpenStreetMap contributors, ODbL 1.0. See docs/sources.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bboxCenter, createProjection, parseBbox } from "../src/level/geo/projection.js";
import { cleanRing, signedArea } from "../src/level/geo/extrude.js";

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

export function buildingHeight(tags) {
  const h = parseHeight(tags.height);
  if (h && h > 0) return { height: h, source: "height" };
  const levels = Number(tags["building:levels"]);
  if (Number.isFinite(levels) && levels > 0) return { height: levels * LEVEL_HEIGHT + 1, source: "levels" };
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
export function buildLevel(raw, { bbox, name, title }) {
  const origin = bboxCenter(bbox);
  const proj = createProjection(origin);
  const project = (g) => g.map(({ lat, lon }) => proj.toLocal(lat, lon).map(round));
  const [minX, maxZ] = proj.toLocal(bbox.south, bbox.west).map(round);
  const [maxX, minZ] = proj.toLocal(bbox.north, bbox.east).map(round);
  const box = { minX, maxX, minZ, maxZ };

  const buildings = [];
  const strips = [];
  const areas = [];
  const counts = { height: 0, levels: 0, default: 0 };

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

  for (const e of raw.elements ?? []) {
    const tags = e.tags ?? {};
    const id = `${e.type === "way" ? "w" : "r"}${e.id}`;
    const isBuilding = tags.building && tags.building !== "no";
    const isPark = tags.leisure === "park" || tags.landuse === "grass";
    if (isBuilding || isPark) {
      let outers = [];
      let inners = [];
      if (e.type === "way" && e.geometry) outers = [project(e.geometry)];
      else if (e.type === "relation" && e.members) {
        const ways = (role) => e.members.filter((m) => m.type === "way" && m.geometry && (m.role || "outer") === role).map((m) => project(m.geometry));
        outers = joinRings(ways("outer"));
        inners = joinRings(ways("inner"));
      }
      if (isBuilding) {
        const { height, source } = buildingHeight(tags);
        const before = buildings.length;
        const extra = { height: round(height), heightSource: source };
        if (tags.name) extra.name = tags.name;
        if (tags.building !== "yes") extra.type = tags.building;
        addPolygon(buildings, id, outers, inners, extra);
        counts[source] += buildings.length - before;
      } else {
        const extra = { kind: "park" };
        if (tags.name) extra.name = tags.name;
        addPolygon(areas, id, outers, inners, extra);
      }
      continue;
    }
    if (e.type !== "way" || !e.geometry) continue;
    const cls = classifyWay(tags);
    if (!cls) continue;
    const pieces = clipPolyline(project(e.geometry), box);
    for (const [i, points] of pieces.entries()) {
      const item = { id: pieces.length > 1 ? `${id}-${i}` : id, kind: cls.kind, width: round(cls.width), points };
      if (tags.name) item.name = tags.name;
      if (tags.highway) item.highway = tags.highway;
      strips.push(item);
    }
  }

  // Stable order, so a rebuild gives the same file.
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  buildings.sort(byId);
  strips.sort(byId);
  areas.sort(byId);

  const spawn = trailSpawn(strips);

  return {
    name,
    title,
    format: "geo-level/1",
    attribution: "Map data (c) OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright",
    bbox,
    origin,
    axes: "+x east, +y up, +z south; meters from the origin",
    bounds: box,
    spawn,
    surfaces: SURFACES,
    stats: {
      buildings: buildings.length,
      buildingHeights: counts,
      strips: Object.fromEntries(["street", "sidewalk", "path", "trail"].map((k) => [k, strips.filter((s) => s.kind === k).length])),
      areas: areas.length,
    },
    buildings,
    strips,
    areas,
    // Greybox-style objects (rails, ledges, ramps). Empty until M1-04.
    objects: [],
  };
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // The value options need a value: "--out" with nothing after it is an error,
  // not the default.
  const missing = ["bbox", "out", "name", "title"].filter((k) => k in args && typeof args[k] !== "string");
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

  let raw = null;
  if (existsSync(rawFile) && existsSync(metaFile) && !args.refresh) {
    const meta = JSON.parse(readFileSync(metaFile, "utf8"));
    if (meta.query === query) {
      raw = JSON.parse(readFileSync(rawFile, "utf8"));
      console.log(`build-block: cache hit ${rawFile} (fetched ${meta.fetchedAt})`);
    } else console.log("build-block: the cached query differs from this bbox; fetch again");
  }
  if (!raw) {
    if (args.offline) throw new Error(`build-block: --offline and no matching cache at ${rawFile}`);
    console.log("build-block: fetch from Overpass");
    const { json, endpoint } = await fetchOverpass(query);
    raw = json;
    writeFileSync(rawFile, JSON.stringify(raw));
    const meta = {
      source: "OpenStreetMap via the Overpass API",
      license: "ODbL 1.0",
      attribution: "(c) OpenStreetMap contributors",
      endpoint,
      fetchedAt: new Date().toISOString(),
      osmBase: raw.osm3s?.timestamp_osm_base ?? null,
      bbox,
      query,
    };
    writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  }

  const level = buildLevel(raw, { bbox, name, title });
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
