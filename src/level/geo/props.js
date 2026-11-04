// Prop placement for a geodata level. Pure and seeded: the same level gives
// the same props on every load, in node and in the browser.
//
// Placement rules (also in docs/decisions.md):
// - Trail: a tree each 12 m on each side, 2.5 m past the edge; a lamp each
//   24 m, sides in turn, 0.7 m past the edge; a bench each 60 m, 1.2 m past
//   the edge and turned to face the trail, with a bin 2.5 m after it (each
//   second pair of benches is the Poly Haven painted bench); a bike rack
//   each 180 m.
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

import { orientRing } from "./extrude.js";
import { doorBay, frontEdges } from "./facade-kit.js";
import { walkStrip } from "./aprons.js";
import { roofPlan } from "./roof-plan.js";
import { createGeoGroundSampler } from "./geo-ground.js";
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
  // The Poly Haven painted bench: 1.17 m x 0.50 m, 0.89 m high at the back.
  bench_painted: { r: 0.65, h: 0.75 },
  bin: { r: 0.35, h: 1.05 },
  bike_rack: { r: 0.8, h: 0.85 },
  street_sign: { r: 0.12, h: 3.2 },
  // The kit planter at PLANTER.scale: 1.2 m square and 0.82 m high. It is a
  // ledge for the skater.
  planter: { r: 0.6, h: 0.82 },
};

// The planters on the front apron of a shop (planterSpots()): the scale of
// the kit planter, and the distance of its center from the wall (m).
export const PLANTER = { scale: 0.8, out: 1.0 };

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

// Pure: the planter spots on the front wall of one storefront building:
// [{ x, z, yaw }]. A planter stands in front of every second inner pier
// (the bay lines of the facade shader), but not at the two piers of the
// door bay (facade-kit.js doorBay()). It is square to the wall.
export function planterSpots(b, style, front) {
  const ring = orientRing(b.outer, false);
  if (!front || front.edge < 0 || front.edge >= ring.length) return [];
  const [px, pz] = ring[front.edge];
  const [qx, qz] = ring[(front.edge + 1) % ring.length];
  const len = Math.hypot(qx - px, qz - pz);
  if (len < 1e-6) return [];
  const t = [(qx - px) / len, (qz - pz) / len];
  // The outward normal of an outer ring edge is (-dz, dx).
  const n = [-t[1], t[0]];
  const bays = Math.max(1, Math.round(len / style.bay));
  const bl = len / bays;
  const door = doorBay(front, bays);
  const out = [];
  for (let k = 2; k < bays; k += 2) {
    if (k === door || k === door + 1) continue;
    const a = k * bl;
    out.push({ x: px + t[0] * a + n[0] * PLANTER.out, z: pz + t[1] * a + n[1] * PLANTER.out, yaw: yawToward(t[0], t[1]) });
  }
  return out;
}

// Returns [{ kind, x, y, z, yaw }]. `sample` is the ground sampler of the
// level without props. With `fronts` (facade-kit.js frontEdges()), the
// shops get planters on their front aprons, and no other prop stands on a
// walk from a shop door to the street (aprons.js walkStrip()).
export function streetProps(level, sample, fronts = null) {
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
  // The walks from the shop doors: { o, t, n, a0, a1, d0, d1 } boxes.
  const walks = [];
  const shops = [];
  if (fronts) {
    for (const b of (level.buildings ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const front = fronts.get(b.id);
      if (!front || !(b.outer?.length >= 3)) continue;
      const style = STYLES.find((s) => s.id === chooseStyle(b));
      shops.push({ b, style, front });
      const w = walkStrip(orientRing(b.outer, false), front, style.bay);
      if (w) walks.push(w);
    }
  }
  function onWalk(x, z, r) {
    for (const w of walks) {
      const dx = x - w.o[0];
      const dz = z - w.o[1];
      const a = dx * w.t[0] + dz * w.t[1];
      const d = dx * w.n[0] + dz * w.n[1];
      if (a > w.a0 - r && a < w.a1 + r && d > w.d0 - r && d < w.d1 + r) return true;
    }
    return false;
  }
  function put(kind, x, z, yaw = 0, scale = 1, extra = null) {
    const solid = PROP_SOLID[kind];
    const r = solid ? solid.r + 0.3 : 0.5;
    if (!free(x, z) || !isOpen(sample, x, z, r, kind === "street_sign" ? signIds : areaIds)) return false;
    if (kind !== "street_sign" && onWalk(x, z, r)) return false;
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

  // The planters go next, so a tree never takes the place of a planter.
  for (const { b, style, front } of shops) {
    for (const s of planterSpots(b, style, front)) put("planter", s.x, s.z, s.yaw, PLANTER.scale);
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
        // The bench front (+z of the template) faces the trail. The benches
        // come in pairs, one on each side; each second pair is the painted
        // bench.
        const kind = Math.floor(i / 2) % 2 === 1 ? "bench_painted" : "bench";
        if (put(kind, bx, bz, yawFrontToward(-nx, -nz))) put("bin", bx + dx * 2.5, bz + dz * 2.5, 0);
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

// Roof props for one building: [{ kind, x, y, z, yaw }]. They are the roof
// units and the water tower of the roof plan (roof-plan.js roofPlan()), so
// they are square to the walls and clear of the stair bulkhead and the
// vents of the facade kit.
export function roofProps(b, style) {
  return roofPlan(b, style)
    .parts.filter((p) => p.kind === "roof_unit" || p.kind === "water_tower")
    .map((p) => ({ kind: p.kind, x: p.x, y: b.height, z: p.z, yaw: p.yaw }));
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
  const street = streetProps(level, createGeoGroundSampler(level), frontEdges(level)).map((p) => (t.flat ? p : { ...p, y: Math.round(t.height(p.x, p.z) * 100) / 100 }));
  return [...street, ...allRoofProps(level)];
}
