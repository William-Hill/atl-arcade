// Ground sampler for a geodata level. Pure. Same contract as
// src/level/ground.js: sampleGround(x, z) returns the highest surface under
// the column, { height, normal, id }, or null outside the level.
//
// Buildings and areas are polygons. Streets, sidewalks, paths, and the trail
// are strips: a point is on a strip when it is within width / 2 of the
// center line. A uniform grid keeps each query to a few candidates.

export const GEO_CELL = 16; // m, grid cell size.
const UP = [0, 1, 0];

// Even-odd test over the outer ring and the holes.
export function pointInRings(x, z, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function distanceToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

function cellKey(ix, iz) {
  return ix * 65536 + iz;
}

// The surface heights (tops) of each strip and area kind, in meters.
export function surfaceTop(level, kind) {
  const top = level.surfaces?.[kind];
  if (typeof top !== "number") throw new Error(`geo level: no surface height for "${kind}"`);
  return top;
}

// Lists the shapes that the sampler tests. Each shape is
// { id, top, kind, rings } or { id, top, kind, a, b, r }.
export function geoShapes(level) {
  const shapes = [];
  for (const b of level.buildings ?? []) {
    shapes.push({ id: b.id, kind: "building", top: b.height, rings: [b.outer, ...(b.holes ?? [])] });
  }
  for (const a of level.areas ?? []) {
    shapes.push({ id: a.id, kind: a.kind, top: surfaceTop(level, a.kind), rings: [a.outer, ...(a.holes ?? [])] });
  }
  for (const s of level.strips ?? []) {
    const top = surfaceTop(level, s.kind);
    for (let i = 0; i < s.points.length - 1; i += 1) {
      shapes.push({ id: s.id, kind: s.kind, top, a: s.points[i], b: s.points[i + 1], r: s.width / 2 });
    }
  }
  return shapes;
}

function shapeBox(s) {
  if (s.c) return { minX: s.c[0] - s.r, maxX: s.c[0] + s.r, minZ: s.c[1] - s.r, maxZ: s.c[1] + s.r };
  if (s.rings) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z] of s.rings[0]) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    return { minX, maxX, minZ, maxZ };
  }
  return {
    minX: Math.min(s.a[0], s.b[0]) - s.r,
    maxX: Math.max(s.a[0], s.b[0]) + s.r,
    minZ: Math.min(s.a[1], s.b[1]) - s.r,
    maxZ: Math.max(s.a[1], s.b[1]) + s.r,
  };
}

function contains(s, x, z) {
  if (s.c) return Math.hypot(x - s.c[0], z - s.c[1]) <= s.r;
  if (s.rings) return pointInRings(x, z, s.rings);
  return distanceToSegment(x, z, s.a[0], s.a[1], s.b[0], s.b[1]) <= s.r;
}

// `obstacles` are solid circles { id, c: [x, z], r, top }, for example the
// street props (src/level/geo/props.js).
export function createGeoGroundSampler(level, cell = GEO_CELL, { obstacles = [] } = {}) {
  const shapes = [...geoShapes(level), ...obstacles];
  const grid = new Map();
  for (const s of shapes) {
    const box = shapeBox(s);
    for (let ix = Math.floor(box.minX / cell); ix <= Math.floor(box.maxX / cell); ix += 1) {
      for (let iz = Math.floor(box.minZ / cell); iz <= Math.floor(box.maxZ / cell); iz += 1) {
        const k = cellKey(ix, iz);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(s);
      }
    }
  }
  const { minX, maxX, minZ, maxZ } = level.bounds;
  const groundTop = level.surfaces?.ground ?? 0;

  function sampleGround(x, z) {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return null;
    let best = { height: groundTop, normal: UP, id: "ground" };
    const list = grid.get(cellKey(Math.floor(x / cell), Math.floor(z / cell)));
    if (list) {
      for (const s of list) {
        if (s.top <= best.height) continue;
        if (contains(s, x, z)) best = { height: s.top, normal: UP, id: s.id };
      }
    }
    return best;
  }
  sampleGround.cellCount = grid.size;
  sampleGround.shapeCount = shapes.length;
  return sampleGround;
}
