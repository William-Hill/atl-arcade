// Read-only audit script. It compares the level with the City of Atlanta
// street centerlines and the official Atlanta BeltLine trail line
// (data/city-open-data.json, from scripts/fetch-city.py), and writes
// data/city-checks.json. Run from the repository root:
//   node production/audits/2026-11-playability/education-accuracy/scripts/analyze-city.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createProjection } from "../../../../../src/level/geo/projection.js";

const DIR = "production/audits/2026-11-playability/education-accuracy/";
const J = (p) => JSON.parse(readFileSync(p, "utf8"));
const level = J("levels/beltline-eastside/level.json");
const city = J(DIR + "data/city-open-data.json");
const ing = J(DIR + "data/ingame.json");
const proj = createProjection(level.origin);
const local = ([lon, lat]) => proj.toLocal(lat, lon);

function distToLines(x, z, lines) {
  let m = Infinity;
  for (const line of lines) for (let i = 0; i < line.length - 1; i += 1) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
    m = Math.min(m, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return m;
}
const stat = (a) => { const s = a.slice().sort((x, y) => x - y); return { n: s.length, median: +s[Math.floor(s.length / 2)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), max: +s[s.length - 1].toFixed(1) }; };

// Official BeltLine trail vs the in-game trail.
const trailLines = city["beltline-trails"].features.flatMap((f) => f.geometry.paths.map((p) => p.map(local)));
const inside = ([x, z]) => x >= level.bounds.minX && x <= level.bounds.maxX && z >= level.bounds.minZ && z <= level.bounds.maxZ;
const officialIn = trailLines.map((l) => l.filter(inside)).filter((l) => l.length > 1);
const gameTrail = level.strips.filter((s) => s.kind === "trail").map((s) => s.points);
const dGame = [];
for (const line of gameTrail) for (let i = 0; i < line.length - 1; i += 1) {
  const [ax, az] = line[i], [bx, bz] = line[i + 1];
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 5));
  for (let k = 0; k <= n; k += 1) dGame.push(distToLines(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, trailLines));
}
// Reverse: every official point inside the bounds, its distance to the game trail (coverage).
const dOfficial = [];
for (const line of officialIn) for (const [x, z] of line) dOfficial.push(distToLines(x, z, gameTrail));
let officialLen = 0;
for (const l of officialIn) for (let i = 1; i < l.length; i += 1) officialLen += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);

// City street labels: full label set, and the label nearest to each odd sign.
const streets = city["street-centerlines"].features.map((f) => ({ label: f.attributes.LABEL, status: f.attributes.STATUS, lines: f.geometry.paths.map((p) => p.map(local)) }));
const labels = [...new Set(streets.map((s) => s.label))].sort();
const nearestLabels = (x, z) => streets.map((s) => ({ label: s.label, d: distToLines(x, z, s.lines) })).sort((a, b) => a.d - b.d).slice(0, 3).map((r) => `${r.label} (${r.d.toFixed(1)} m)`);
const ODD = ["Closed Lake Ave", "Bishop Way NE", "Prospect Way NE", "Austin Ave NE", "Inman Way", "Ralph McGill Blvd", "John Lewis Freedom Pkwy NE"];
const oddSigns = ing.signs.filter((s) => s.names.some((n) => ODD.includes(n))).map((s) => ({ names: s.names, lat: s.lat, lon: s.lon, nearestCityLabels: nearestLabels(s.x, s.z) }));

// Five centerlines vs the city layer, by name word.
const SAMPLE = [["Ponce de Leon Avenue Northeast", /^PONCE DE LEON AVE/i], ["North Avenue Northeast", /^NORTH AVE/i], ["Highland Avenue Northeast", /^(N )?HIGHLAND AVE/i], ["Irwin Street Northeast", /^IRWIN ST/i], ["Ralph McGill Boulevard Northeast", /^RALPH MCGILL BLVD/i], ["Krog Street Northeast", /^KROG ST/i]];
const centerlines = SAMPLE.map(([name, re]) => {
  const lines = streets.filter((s) => re.test(s.label ?? "")).flatMap((s) => s.lines);
  const d = [];
  for (const s of level.strips.filter((q) => q.name === name && q.highway !== "service")) for (let i = 0; i < s.points.length - 1; i += 1) {
    const [ax, az] = s.points[i], [bx, bz] = s.points[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 10));
    for (let k = 0; k <= n; k += 1) d.push(distToLines(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, lines));
  }
  return { name, cityLines: lines.length, vsCity: lines.length && d.length ? stat(d) : null };
});

const out = {
  trail: { officialName: city["beltline-trails"].features[0]?.attributes?.name, officialExtent: city["beltline-trails"].features[0]?.attributes?.extent, officialMiles: city["beltline-trails"].features[0]?.attributes?.miles_txt, gameVsOfficial: stat(dGame), officialVsGame: dOfficial.length ? stat(dOfficial) : null, officialLenInBoundsM: +officialLen.toFixed(0) },
  cityLabels: labels,
  oddSigns,
  centerlines,
  landmarkBuildings: city["landmark-buildings"].features.map((f) => ({ name: f.attributes.BUILDING_N, address: f.attributes.STREET_ADD, designated: new Date(f.attributes.DESIGNATIO).toISOString().slice(0, 10) })),
  historicDistricts: city["historic-districts"].features.map((f) => f.attributes.DIST_1),
};
writeFileSync(DIR + "data/city-checks.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, cityLabels: `${labels.length} labels` }, null, 1));
console.log(labels.filter((l) => /lake|bishop|prospect|austin|inman|freedom|mcgill/i.test(l ?? "")));
