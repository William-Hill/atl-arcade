// Ground sampler for a level. Pure. Given (x, z) it returns the highest
// walkable surface under that column: { height, normal, id }, or null when
// nothing is there. Boxes of every kind count (a building top is a surface
// too; the controller treats a rise above its step limit as a wall). Rails
// never count, because the skater rides them through the grind system.

import { rampSurface } from "./ramp.js";
import { createGeoGroundSampler, GEO_CELL } from "./geo/geo-ground.js";
import { levelProps, propObstacles } from "./geo/props.js";
import { benchLedges, curbLedges } from "./geo/grindables.js";
import { clipGrindables, edgeFence, withEdgeFence } from "./edge-fence.js";

export function createGroundSampler(level) {
  const boxes = level.objects.filter((o) => o.size && o.kind !== "rail");
  const ramps = level.objects.filter((o) => o.kind === "ramp");

  return function sampleGround(x, z) {
    let best = null;
    for (const o of boxes) {
      const [cx, cy, cz] = o.position;
      const [sx, sy, sz] = o.size;
      if (Math.abs(x - cx) > sx / 2 || Math.abs(z - cz) > sz / 2) continue;
      const height = cy + sy / 2;
      if (!best || height > best.height) best = { height, normal: [0, 1, 0], id: o.id };
    }
    for (const r of ramps) {
      const s = rampSurface(r, x, z);
      if (s && (!best || s.height >= best.height)) best = { height: s.height, normal: s.normal, id: r.id };
    }
    return best;
  };
}

// Everything the skate controller needs from a level: the ground sampler,
// the bounds, the spawn point for an out-of-bounds respawn, and on a
// geodata level the grindables of the sidewalks (benches and curbs, for
// createSkaterEnv()).
// A geodata level (format "geo-level/1") uses the polygon and strip sampler,
// with the street props as solid obstacles. `props` lists the placements
// for the render. `{ props: false }` leaves the props out (the M1-03 level).
// `placed`: the props, made before by levelProps(level) (in a worker, #98).
// A geodata level also gets the edge fence (edge-fence.js, #229): a wall a
// short distance inside the bounds, so the skater cannot ride off the level.
// `fence` is the fence rectangle for the render and the HUD, or null, and
// `sampleGroundNoFence` is the ground with no fence (for the fence render).
// The greybox has its own barriers at each edge.
export function createLevelEnv(level, { props = true, placed: made = null } = {}) {
  const geo = typeof level.format === "string" && level.format.startsWith("geo-level/");
  if (!geo) return { sampleGround: createGroundSampler(level), bounds: level.bounds, spawn: level.spawn, props: [], grindables: [], fence: null };
  const placed = props ? (made ?? levelProps(level)) : [];
  const obstacles = propObstacles(placed.filter((p) => !p.roof));
  const ground = createGeoGroundSampler(level, GEO_CELL, { obstacles });
  const fence = edgeFence(level.bounds);
  const sampleGround = withEdgeFence(ground, fence);
  // The skate features (#136): the OSM benches and the curbs are ledges.
  const streetIds = new Set((level.strips ?? []).filter((s) => s.kind === "street").map((s) => s.id));
  const isStreet = (x, z) => {
    const id = ground(x, z)?.id;
    return streetIds.has(id) || Boolean(id?.startsWith("junction:"));
  };
  // A grind does not sample the ground, so the ledges stop before the fence.
  const grindables = clipGrindables([...benchLedges(level, placed), ...curbLedges(level, isStreet)], fence);
  return { sampleGround, sampleGroundNoFence: ground, bounds: level.bounds, spawn: level.spawn, props: placed, grindables, fence };
}
