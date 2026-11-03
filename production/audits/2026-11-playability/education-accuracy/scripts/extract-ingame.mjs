// Read-only audit script. It imports the pure level modules and writes the
// in-game positions of every landmark, sign, label, mural, named building,
// and named park as local meters and as lat/lon (inverse projection).
// Run from the repository root:
//   node production/audits/2026-11-playability/education-accuracy/scripts/extract-ingame.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createProjection } from "../../../../../src/level/geo/projection.js";
import { landmarkPlacements } from "../../../../../src/level/geo/landmarks.js";
import { levelProps } from "../../../../../src/level/geo/props.js";
import { muralWalls } from "../../../../../src/level/geo/geo-mesh.js";

const OUT = "production/audits/2026-11-playability/education-accuracy/data/ingame.json";
const level = JSON.parse(readFileSync("levels/beltline-eastside/level.json", "utf8"));
const proj = createProjection(level.origin);
const ll = (x, z) => {
  const p = proj.toLatLon(x, z);
  return { lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) };
};
const centroid = (ring) => {
  // Area-weighted polygon centroid.
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    const f = x0 * z1 - x1 * z0;
    a += f; cx += (x0 + x1) * f; cz += (z0 + z1) * f;
  }
  a /= 2;
  return [cx / (6 * a), cz / (6 * a)];
};
const deg = (yaw) => +((yaw * 180) / Math.PI).toFixed(1);
// yaw: atan2(side.x, side.z) with +x east, +z south. Compass bearing of the
// facing direction: east = 90, south = 180, north = 0.
const bearingOfYaw = (yaw) => {
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  return +(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360).toFixed(1);
};

const out = { origin: level.origin, bounds: level.bounds, bbox: level.bbox, landmarks: [], signs: [], murals: [], buildings: [], areas: [], spawn: null };

for (const p of landmarkPlacements(level)) {
  out.landmarks.push({ id: p.id, part: "model", building: p.building, x: +p.model.x.toFixed(2), z: +p.model.z.toFixed(2), y: +p.model.y.toFixed(2), yawDeg: deg(p.model.yaw), facingBearing: bearingOfYaw(p.model.yaw), ...ll(p.model.x, p.model.z) });
  if (p.sign) out.landmarks.push({ id: p.id, part: "sign", text: p.sign.text, building: p.building, x: +p.sign.x.toFixed(2), z: +p.sign.z.toFixed(2), y: +p.sign.y.toFixed(2), yawDeg: deg(p.sign.yaw), facingBearing: bearingOfYaw(p.sign.yaw), ...ll(p.sign.x, p.sign.z) });
}

for (const p of levelProps(level)) {
  if (p.kind !== "street_sign") continue;
  out.signs.push({ names: p.names, x: p.x, z: p.z, ...ll(p.x, p.z) });
}

const WORDS = ["ATL", "BELTLINE", "SKATE ATL", "O4W", "ROLL ON", "PEACH", "INMAN", "PONCE", "GLIDE", "A-TOWN", "SWEET AUBURN", "KROG", "OLD 4TH WARD", "SWAG SURF", "RINK", "SHINE"];
for (const m of muralWalls(level)) {
  const x = (m.a[0] + m.b[0]) / 2, z = (m.a[1] + m.b[1]) / 2;
  const b = level.buildings.find((q) => q.id === m.id);
  out.murals.push({ building: m.id, buildingName: b?.name ?? null, word: WORDS[m.cell % WORDS.length], widthM: +Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]).toFixed(1), x: +x.toFixed(2), z: +z.toFixed(2), ...ll(x, z) });
}

for (const b of level.buildings) {
  if (!b.name) continue;
  const [x, z] = centroid(b.outer);
  out.buildings.push({ id: b.id, name: b.name, height: b.height, heightSource: b.heightSource, x: +x.toFixed(2), z: +z.toFixed(2), ...ll(x, z) });
}
for (const a of level.areas) {
  if (!a.name) continue;
  const [x, z] = centroid(a.outer);
  out.areas.push({ id: a.id, name: a.name, kind: a.kind, x: +x.toFixed(2), z: +z.toFixed(2), ...ll(x, z) });
}
const [sx, , sz] = level.spawn.position;
out.spawn = { x: sx, z: sz, ...ll(sx, sz) };

writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`landmarks ${out.landmarks.length}, signs ${out.signs.length}, murals ${out.murals.length}, buildings ${out.buildings.length}, areas ${out.areas.length}`);
