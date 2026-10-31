// Ground sampler for a level. Pure. Given (x, z) it returns the highest
// walkable surface under that column: { height, normal, id }, or null when
// nothing is there. Boxes of every kind count (a building top is a surface
// too; the controller treats a rise above its step limit as a wall). Rails
// never count, because the skater rides them through the grind system.

import { rampSurface } from "./ramp.js";

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
