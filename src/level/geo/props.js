// Prop placement for a geodata level. Pure and seeded: the same level gives
// the same props on every load, in node and in the browser.
//
// Placement rules (also in docs/decisions.md):
// - Trail: a tree each 12 m on each side, 2.5 m past the edge; a lamp each
//   24 m, sides in turn, 0.7 m past the edge; a bench each 60 m, 1.2 m past
//   the edge and turned to face the trail, with a bin 2.5 m after it; a bike
//   rack each 180 m.
// - Sidewalks: a tree each 16 m and a lamp each 36 m, 1.8 m and 0.5 m past
//   the edge, on the side that is open ground.
// - A prop goes only on open ground or a park: never on a street, sidewalk,
//   path, the trail, or in a building. No two props are closer than 2.5 m.
// - Roofs: roof units by roof area, and water towers on brick lofts and
//   warehouses, from the building style.
// - Street signs: one post at each intersection of two named streets
//   (src/level/geo/signs.js), on a free corner. A sign may stand on a
//   sidewalk, as a real sign does. Signs go first, so a tree never takes
//   the corner.

import { cleanRing, signedArea } from "./extrude.js";
import { createGeoGroundSampler, pointInRings } from "./geo-ground.js";
import { STYLES, chooseStyle, hash32, seededRandom } from "./styles.js";
import { cornerSpots, shortName, streetIntersections } from "./signs.js";
import { buildingSpan, terrainOf } from "./terrain.js";

// Solid size of each prop for the ground sampler: radius and height in m.
// Every height is over SKATE.maxStep, so a prop stops the skater.
export const PROP_SOLID = {
  tree_round: { r: 0.35, h: 2.2 },
  tree_tall: { r: 0.3, h: 2.0 },
  lamp: { r: 0.2, h: 4.2 },
  bench: { r: 0.9, h: 0.75 },
  bin: { r: 0.35, h: 1.05 },
  bike_rack: { r: 0.8, h: 0.85 },
  street_sign: { r: 0.12, h: 3.2 },
};

const MIN_GAP = 2.5;

// The yaw that turns a template's +x toward (vx, vz). Same convention as
// the skater: forward(yaw) = (cos yaw, -sin yaw).
export function yawToward(vx, vz) {
  return Math.atan2(-vz, vx);
}

// The yaw that turns a template's +z (the bench front) toward (vx, vz).
export function yawFrontToward(vx, vz) {
  return Math.atan2(vx, vz);
}

function along(points, step, offset, fn) {
  // Calls fn(x, z, dirX, dirZ, index) each `step` m, starting at `offset`.
  let acc = 0;
  let next = offset;
  let n = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    while (next <= acc + len) {
      const t = next - acc;
      fn(ax + dx * t, az + dz * t, dx, dz, n);
      n += 1;
      next += step;
    }
    acc += len;
  }
}

function isOpen(sample, x, z, r, openIds) {
  for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
    const g = sample(x + ox, z + oz);
    if (!g) return false;
    if (g.id !== "ground" && !openIds.has(g.id)) return false;
  }
  return true;
}

// Returns [{ kind, x, y, z, yaw }]. `sample` is the ground sampler of the
// level without props.
export function streetProps(level, sample) {
  const areaIds = new Set((level.areas ?? []).map((a) => a.id));
  // A sign may also stand on a sidewalk.
  const signIds = new Set([...areaIds, ...(level.strips ?? []).filter((s) => s.kind === "sidewalk").map((s) => s.id)]);
  const out = [];
  const taken = new Map();
  const key = (x, z) => `${Math.floor(x / MIN_GAP)},${Math.floor(z / MIN_GAP)}`;
  function free(x, z) {
    const ix = Math.floor(x / MIN_GAP);
    const iz = Math.floor(z / MIN_GAP);
    for (let a = -1; a <= 1; a += 1) {
      for (let b = -1; b <= 1; b += 1) {
        for (const p of taken.get(`${ix + a},${iz + b}`) ?? []) if (Math.hypot(p[0] - x, p[1] - z) < MIN_GAP) return false;
      }
    }
    return true;
  }
  function put(kind, x, z, yaw = 0, scale = 1, extra = null) {
    const solid = PROP_SOLID[kind];
    if (!free(x, z) || !isOpen(sample, x, z, solid ? solid.r + 0.3 : 0.5, kind === "street_sign" ? signIds : areaIds)) return false;
    const k = key(x, z);
    if (!taken.has(k)) taken.set(k, []);
    taken.get(k).push([x, z]);
    const p = { kind, x: Math.round(x * 100) / 100, y: 0, z: Math.round(z * 100) / 100, yaw: Math.round(yaw * 1000) / 1000 };
    if (scale !== 1) p.scale = Math.round(scale * 100) / 100;
    if (extra) Object.assign(p, extra);
    out.push(p);
    return true;
  }

  // The blades point along the streets: yaws[i] turns the blade (+x) along
  // street i.
  for (const ix of streetIntersections(level)) {
    // A name that the city layer does not confirm gets no sign (issue #78).
    if (!ix.confirmed) continue;
    const extra = { names: ix.names.map(shortName), yaws: ix.dirs.map(([dx, dz]) => Math.round(yawToward(dx, dz) * 1000) / 1000) };
    for (const [x, z] of cornerSpots(ix)) if (put("street_sign", x, z, 0, 1, extra)) break;
  }

  const strips = (level.strips ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const s of strips) {
    const half = s.width / 2;
    const rand = seededRandom(hash32(s.id));
    if (s.kind === "trail") {
      along(s.points, 12, 6, (x, z, dx, dz) => {
        for (const side of [1, -1]) {
          const nx = -dz * side;
          const nz = dx * side;
          const d = half + 2.5 + rand() * 1.5;
          put(rand() < 0.6 ? "tree_round" : "tree_tall", x + nx * d, z + nz * d, rand() * Math.PI * 2, 0.85 + rand() * 0.35);
        }
      });
      along(s.points, 24, 3, (x, z, dx, dz, i) => {
        const side = i % 2 === 0 ? 1 : -1;
        const nx = -dz * side;
        const nz = dx * side;
        // The lamp arm (+x) reaches over the trail.
        put("lamp", x + nx * (half + 0.7), z + nz * (half + 0.7), yawToward(-nx, -nz));
      });
      along(s.points, 60, 20, (x, z, dx, dz, i) => {
        const side = i % 2 === 0 ? 1 : -1;
        const nx = -dz * side;
        const nz = dx * side;
        const bx = x + nx * (half + 1.2);
        const bz = z + nz * (half + 1.2);
        // The bench front (+z of the template) faces the trail.
        if (put("bench", bx, bz, yawFrontToward(-nx, -nz))) put("bin", bx + dx * 2.5, bz + dz * 2.5, 0);
      });
      along(s.points, 180, 90, (x, z, dx, dz) => {
        put("bike_rack", x + dz * (half + 1.5), z - dx * (half + 1.5), yawToward(dx, dz));
      });
    } else if (s.kind === "sidewalk") {
      along(s.points, 16, 8, (x, z, dx, dz) => {
        for (const side of [1, -1]) {
          const d = half + 1.8;
          if (put(rand() < 0.7 ? "tree_round" : "tree_tall", x - dz * side * d, z + dx * side * d, rand() * Math.PI * 2, 0.85 + rand() * 0.35)) break;
        }
      });
      along(s.points, 36, 18, (x, z, dx, dz) => {
        for (const side of [1, -1]) {
          const d = half + 0.5;
          const nx = -dz * side;
          const nz = dx * side;
          if (put("lamp", x + nx * d, z + nz * d, yawToward(-nx, -nz))) break;
        }
      });
    }
  }
  return out;
}

// Roof props for one building: [{ kind, x, y, z, yaw }].
export function roofProps(b, style) {
  const out = [];
  const ring = cleanRing(b.outer);
  const area = Math.abs(signedArea(ring));
  const rings = [ring, ...(b.holes ?? [])];
  const rand = seededRandom(hash32(`${b.id}:roof`));
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
  function spot(margin) {
    for (let tries = 0; tries < 20; tries += 1) {
      const x = minX + rand() * (maxX - minX);
      const z = minZ + rand() * (maxZ - minZ);
      const ok = [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([ox, oz]) => pointInRings(x + ox, z + oz, rings));
      if (ok) return [x, z];
    }
    return null;
  }
  const units = Math.min(8, Math.floor(area * (style.roof.roof_unit ?? 0)));
  for (let i = 0; i < units; i += 1) {
    const p = spot(1.5);
    if (p) out.push({ kind: "roof_unit", x: p[0], y: b.height, z: p[1], yaw: Math.round(rand() * 4) * (Math.PI / 2) });
  }
  if (style.roof.water_tower && area > 300 && rand() < style.roof.water_tower) {
    const p = spot(2.5);
    if (p) out.push({ kind: "water_tower", x: p[0], y: b.height, z: p[1], yaw: 0 });
  }
  return out;
}

// Every roof prop in the level.
export function allRoofProps(level) {
  const out = [];
  for (const b of level.buildings ?? []) {
    const style = STYLES.find((s) => s.id === chooseStyle(b));
    // A roof prop stands on the roof: the building span top (terrain.js).
    const top = buildingSpan(level, b).top;
    for (const p of roofProps(b, style)) out.push({ ...p, y: top, roof: true });
  }
  return out;
}

// The props as solid circles for the ground sampler.
export function propObstacles(props) {
  const out = [];
  for (const p of props) {
    const solid = PROP_SOLID[p.kind];
    if (solid) out.push({ id: `prop:${p.kind}`, c: [p.x, p.z], r: solid.r, top: solid.h });
  }
  return out;
}

// Every prop in a level: the street props and the roof props.
// A street prop stands on the terrain (y is the terrain height under it).
export function levelProps(level) {
  const t = terrainOf(level);
  const street = streetProps(level, createGeoGroundSampler(level)).map((p) => (t.flat ? p : { ...p, y: Math.round(t.height(p.x, p.z) * 100) / 100 }));
  return [...street, ...allRoofProps(level)];
}
