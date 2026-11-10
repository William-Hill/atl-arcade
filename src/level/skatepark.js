// A skatepark in a geodata level (#222): a flat concrete pad with the skate
// features of assets/skate-features on it. Pure: plain arrays, no Three.js.
//
// The data file (levels/<level>/skatepark.json) gives the pad in its own
// frame: `center` [x, z], `axis` (the unit direction of +u, the long side),
// `size` [along u, along v], and the features at [u, v] with a `turn` in
// degrees. The frame is the model frame of skate-features.js turned by the
// pad yaw, so +v is the front (+z) of a feature with turn 0.
//
// withSkatepark(level, park, manifest) returns the level with
// - the terrain graded flat under the pad (the pad needs level ground: the
//   feature models are rigid),
// - the pad as a paved area (kind "sidewalk": the concrete of the level), so
//   the level meshes, the ground sampler and the colliders have it,
// - `level.skatepark`: the pad and each feature placed in world space.
// createLevelEnv() (ground.js) reads `level.skatepark` for the ground of
// the features and their grind edges.

import { decodeHeights, encodeHeights, terrainOf } from "./geo/terrain.js";
import { distanceToSegment, pointInRings } from "./geo/geo-ground.js";
import { featureFootprint, featureGround, featureLevelObjects, toWorld } from "./skate-features.js";

export const SKATEPARK = {
  surface: "sidewalk", // the surface kind of the pad
  full: 12, // m from the pad where the terrain is still the pad height (over a terrain cell diagonal)
  blend: 20, // m from the pad where the terrain is the level's own again
  propMargin: 1, // m around the pad with no street prop or tree
};

// The pad yaw: toWorld() of skate-features.js turns +x onto (cos, -sin).
export function padYaw(park) {
  return Math.atan2(-park.axis[1], park.axis[0]);
}

// A pad point [u, v] in level meters [x, z].
export function padPoint(park, u, v) {
  const [x, , z] = toWorld([u, 0, v], { position: [park.center[0], 0, park.center[1]], yaw: padYaw(park) });
  return [x, z];
}

// The four corners of the pad, [x, z].
export function padOutline(park) {
  const [l, w] = park.size;
  return [
    [-l / 2, -w / 2],
    [l / 2, -w / 2],
    [l / 2, w / 2],
    [-l / 2, w / 2],
  ].map(([u, v]) => padPoint(park, u, v));
}

// The distance from (x, z) to a ring, 0 inside it.
export function distanceToRing(x, z, ring) {
  if (pointInRings(x, z, [ring])) return 0;
  let d = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    d = Math.min(d, distanceToSegment(x, z, a[0], a[1], b[0], b[1]));
  }
  return d;
}

// The terrain grid with the nodes near `ring` moved to one height: the mean
// of the nodes within `full` m. A node within `full` m gets that height, and
// the change fades to nothing at `blend` m, so the ground around the pad has
// no step. Returns { terrain, height }.
export function gradeTerrain(terrain, ring, { full = SKATEPARK.full, blend = SKATEPARK.blend } = {}) {
  const { cell, x0, z0, cols, rows } = terrain;
  const heights = decodeHeights(terrain.data, cols * rows);
  const near = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const d = distanceToRing(x0 + i * cell, z0 + j * cell, ring);
      if (d < blend) near.push([j * cols + i, d]);
    }
  }
  const inner = near.filter(([, d]) => d <= full);
  if (!inner.length) return { terrain, height: null };
  const height = inner.reduce((s, [k]) => s + heights[k], 0) / inner.length;
  for (const [k, d] of near) {
    const w = d <= full ? 1 : 1 - (d - full) / (blend - full);
    heights[k] += (height - heights[k]) * w;
  }
  return { terrain: { ...terrain, data: encodeHeights(Array.from(heights)) }, height: Math.round(height * 100) / 100 };
}

// The level with the skatepark in it. `manifest` is
// assets/skate-features/features.json. A level with no terrain keeps its
// flat ground.
export function withSkatepark(level, park, manifest) {
  if (!park) return level;
  const outer = padOutline(park).map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
  const areaId = `skatepark:${park.id}`;
  const graded = level.terrain ? gradeTerrain(level.terrain, outer, park.grade) : { terrain: level.terrain };
  const out = {
    ...level,
    ...(level.terrain ? { terrain: graded.terrain } : {}),
    areas: [...(level.areas ?? []), { id: areaId, kind: SKATEPARK.surface, name: park.name, outer }],
  };
  const top = (level.surfaces?.[SKATEPARK.surface] ?? 0) + terrainOf(out).height(park.center[0], park.center[1]);
  const yaw = padYaw(park);
  const placements = park.features.map((f) => {
    const feature = manifest.features[f.feature];
    if (!feature) throw new Error(`skatepark ${park.id}: no skate feature "${f.feature}" (${f.id})`);
    const [x, z] = padPoint(park, f.at[0], f.at[1]);
    return { id: `${park.id}:${f.id}`, name: f.feature, file: feature.file, position: [x, top, z], yaw: yaw + ((f.turn ?? 0) * Math.PI) / 180, feature };
  });
  out.skatepark = { id: park.id, name: park.name, area: areaId, center: [...park.center], yaw, size: [...park.size], top, outer, approximate: Boolean(park.placement?.approximate), placements };
  return out;
}

function box(points) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const [x, , z] of points) {
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minZ = Math.min(b.minZ, z);
    b.maxZ = Math.max(b.maxZ, z);
  }
  return b;
}

// The grind edges of the placed features, as grindables for the grind
// system (src/sim/skate/grind.js). The id is `rail:skatepark:...` for a
// bar or a coping and `ledge:skatepark:...` for a ledge or a bench, so the
// combo names them "Rail Grind" and "Ledge Grind" (src/sim/skate/run.js).
export function skateparkGrindables(skatepark) {
  const out = [];
  for (const p of skatepark?.placements ?? []) {
    for (const o of featureLevelObjects(p.feature, p)) {
      const kind = o.edge === "rail" || o.edge === "coping" ? "rail" : "ledge";
      const points = o.spline.points;
      let total = 0;
      for (let i = 0; i < points.length - 1; i += 1) total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1], points[i + 1][2] - points[i][2]);
      out.push({ id: `${kind}:skatepark:${o.id}`, kind, edge: o.edge, feature: p.id, radius: o.radius, points, total, box: box(points) });
    }
  }
  return out;
}

// The ground sampler with the features on it: the higher of the level
// ground and a feature surface (a ledge top, a ramp face).
export function withSkateparkGround(sampleGround, skatepark) {
  if (!skatepark?.placements?.length) return sampleGround;
  const sampleFeatures = featureGround(skatepark.placements.map((p) => ({ feature: p.feature, placement: p })));
  const corners = skatepark.placements.flatMap((p) => featureFootprint(p.feature, p));
  const minX = Math.min(...corners.map((c) => c[0]));
  const maxX = Math.max(...corners.map((c) => c[0]));
  const minZ = Math.min(...corners.map((c) => c[1]));
  const maxZ = Math.max(...corners.map((c) => c[1]));
  return function sampleGroundWithFeatures(x, z, y) {
    const base = sampleGround(x, z, y);
    if (!base || x < minX || x > maxX || z < minZ || z > maxZ) return base;
    const f = sampleFeatures(x, z);
    return f && f.height > base.height ? { height: f.height, normal: f.normal, id: `skatepark:${f.id}` } : base;
  };
}

// The props that do not stand on the pad.
export function offPad(props, skatepark, margin = SKATEPARK.propMargin) {
  if (!skatepark) return props;
  return props.filter((p) => distanceToRing(p.x, p.z, skatepark.outer) > margin);
}
