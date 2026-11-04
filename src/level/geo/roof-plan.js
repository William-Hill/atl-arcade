// The roof plan of a flat roof: where the stair bulkhead, the water tower,
// the roof units, and the vent stacks stand. Pure and seeded.
//
// The facade kit (facade-kit.js) builds the bulkhead and the vents. The
// props (props.js) place the roof units and the water tower from the kit
// GLB. Both read this one plan, so no two parts stand in the same place.
//
// Each part is a rectangle on the axes of the footprint rectangle
// (minRect()): `u` is the long axis and `v` the short axis. So each part is
// square to the long walls. Each part stands `clear` meters or more inside
// the footprint, and `gap` meters or more from every other part.

import { orientRing } from "./extrude.js";
import { pointInRings } from "./geo-ground.js";
import { hash32, seededRandom } from "./styles.js";

// The stair bulkhead: it stands `margin` from every wall and `end` from the
// end wall. It is not built when it is narrower than `minAcross`.
export const BULKHEAD = { end: 1.5, margin: 1.0, minAcross: 2.0 };

export const ROOF = {
  // The roof unit of the kit GLB: 1.6 m x 1.24 m (x along u). Units stand
  // in rows, `pitch` meters apart.
  unit: { size: [1.6, 1.24], pitch: 2.4, clear: 1.0, max: 10, minArea: 120 },
  // The water tower of the kit GLB: 3 m x 3 m.
  tower: { size: [3, 3], clear: 1.2, minArea: 200 },
  // A vent stack: a small pipe with a cap (facade-kit.js roofVents()).
  vent: { size: [0.34, 0.34], height: [0.5, 0.9], clear: 0.6, perArea: 1 / 140, min: 2, max: 8 },
  // The clear space between two parts.
  gap: 0.6,
  // The unit count is the roof area times the style rate, times this.
  unitBoost: 2,
};

// The smallest rectangle around the ring, with one side on a ring edge:
// { cx, cz, ux, uz, long, short, area }. (ux, uz) is the long axis.
export function minRect(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i += 1) {
    const [px, pz] = ring[i];
    const [qx, qz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(qx - px, qz - pz);
    if (len < 1e-6) continue;
    const ux = (qx - px) / len;
    const uz = (qz - pz) / len;
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const [x, z] of ring) {
      const a = x * ux + z * uz;
      const b = -x * uz + z * ux;
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
      b0 = Math.min(b0, b);
      b1 = Math.max(b1, b);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) {
      const ca = (a0 + a1) / 2;
      const cb = (b0 + b1) / 2;
      const r = { cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, ux, uz, long: a1 - a0, short: b1 - b0, area };
      if (r.short > r.long) {
        // Turn the axis so (ux, uz) is the long side.
        r.ux = -uz;
        r.uz = ux;
        [r.long, r.short] = [r.short, r.long];
      }
      best = r;
    }
  }
  return best;
}

// Pure: the stair bulkhead box of a style with a crown, or null:
// { cx, cz, u, v, ha, hc, height }. `ha` is the half size along u, and `hc`
// the half size along v. `seed & 1` picks the end of the long axis.
export function bulkheadBox(ring, style, seed, c = BULKHEAD) {
  if (!style.crown) return null;
  const r = minRect(ring);
  if (!r) return null;
  const [along, across0, height] = style.crown.bulkhead;
  const across = Math.min(across0, r.short - 2.4);
  if (across < c.minAcross) return null;
  const side = seed & 1 ? 1 : -1;
  const off = side * (r.long / 2 - c.end - along / 2);
  const cx = r.cx + r.ux * off;
  const cz = r.cz + r.uz * off;
  const u = [r.ux, r.uz];
  const v = [-r.uz, r.ux];
  const ha = along / 2;
  const hc = across / 2;
  for (const [sa, sc] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = cx + u[0] * sa * (ha + c.margin) + v[0] * sc * (hc + c.margin);
    const z = cz + u[1] * sa * (ha + c.margin) + v[1] * sc * (hc + c.margin);
    if (!pointInRings(x, z, [ring])) return null;
  }
  return { cx, cz, u, v, ha, hc, height };
}

function area(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a / 2);
}

// The yaw that turns a template's +x toward (vx, vz). Same convention as
// props.js yawToward().
function yawOf(vx, vz) {
  return Math.atan2(-vz, vx);
}

// Pure: the roof plan of one building. Returns { bulkhead, parts }, where
// each part is { kind, x, z, yaw, ha, hc } and a vent also has `height`.
// `kind` is "water_tower", "roof_unit", or "vent". A style with no roof
// rates (a house, a parking deck) gets no parts.
export function roofPlan(b, style) {
  const out = { bulkhead: null, parts: [] };
  if (!(b.outer?.length >= 3)) return out;
  const ring = orientRing(b.outer, false);
  const rings = [ring, ...(b.holes ?? [])];
  out.bulkhead = bulkheadBox(ring, style, hash32(`${b.id}:crown`));
  const r = minRect(ring);
  const roof = style.roof ?? {};
  if (!r || !(roof.roof_unit > 0 || roof.water_tower > 0)) return out;
  const u = [r.ux, r.uz];
  const v = [-r.uz, r.ux];
  const rand = seededRandom(hash32(`${b.id}:roof`));
  const a = area(ring);
  // The taken rectangles, in (a, c) roof coordinates: { a, c, ha, hc }.
  const taken = [];
  const toRoof = (x, z) => [(x - r.cx) * u[0] + (z - r.cz) * u[1], (x - r.cx) * v[0] + (z - r.cz) * v[1]];
  const toWorld = (pa, pc) => [r.cx + u[0] * pa + v[0] * pc, r.cz + u[1] * pa + v[1] * pc];
  if (out.bulkhead) {
    const [ba, bc] = toRoof(out.bulkhead.cx, out.bulkhead.cz);
    taken.push({ a: ba, c: bc, ha: out.bulkhead.ha, hc: out.bulkhead.hc });
  }
  function fits(pa, pc, ha, hc, clear) {
    for (const [sa, sc] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const [x, z] = toWorld(pa + sa * (ha + clear), pc + sc * (hc + clear));
      if (!pointInRings(x, z, rings)) return false;
    }
    for (const q of taken) {
      if (Math.abs(pa - q.a) < ha + q.ha + ROOF.gap && Math.abs(pc - q.c) < hc + q.hc + ROOF.gap) return false;
    }
    return true;
  }
  function add(kind, pa, pc, ha, hc, extra = {}) {
    taken.push({ a: pa, c: pc, ha, hc });
    const [x, z] = toWorld(pa, pc);
    out.parts.push({ kind, x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000, yaw: Math.round(yawOf(u[0], u[1]) * 1000) / 1000, ha, hc, ...extra });
  }
  // The water tower first: at the end away from the bulkhead.
  const tw = ROOF.tower;
  if (roof.water_tower > 0 && a > tw.minArea && rand() < roof.water_tower) {
    const side = out.bulkhead ? -Math.sign(toRoof(out.bulkhead.cx, out.bulkhead.cz)[0] || 1) : rand() < 0.5 ? -1 : 1;
    const ha = tw.size[0] / 2;
    const hc = tw.size[1] / 2;
    search: for (let k = 0; k < 8; k += 1) {
      const pa = side * (r.long / 2 - tw.clear - ha - k * 1.5);
      for (const pc of [0, -r.short / 4, r.short / 4]) {
        if (fits(pa, pc, ha, hc, tw.clear)) {
          add("water_tower", pa, pc, ha, hc);
          break search;
        }
      }
    }
  }
  // The roof units: in rows along the long axis.
  const un = ROOF.unit;
  const want = roof.roof_unit > 0 && a >= un.minArea ? Math.min(un.max, Math.max(1, Math.floor(a * roof.roof_unit * ROOF.unitBoost))) : 0;
  if (want > 0) {
    const ha = un.size[0] / 2;
    const hc = un.size[1] / 2;
    const rows = [0, -r.short / 4, r.short / 4];
    if (rand() < 0.5) rows.reverse();
    const start = (rand() - 0.5) * r.long * 0.5;
    let placed = 0;
    for (const pc of rows) {
      if (placed >= want) break;
      // March both ways from the start of the row.
      for (let k = 0; placed < want && k < 2 * Math.ceil(r.long / un.pitch); k += 1) {
        const step = Math.ceil(k / 2) * (k % 2 ? 1 : -1);
        const pa = start + step * un.pitch;
        if (Math.abs(pa) > r.long / 2) continue;
        if (fits(pa, pc, ha, hc, un.clear)) {
          add("roof_unit", pa, pc, ha, hc);
          placed += 1;
        }
      }
    }
  }
  // The vent stacks: spread over the roof.
  const vn = ROOF.vent;
  const vents = Math.max(vn.min, Math.min(vn.max, Math.round(a * vn.perArea)));
  for (let i = 0, tries = 0; i < vents && tries < vents * 12; tries += 1) {
    const pa = (rand() - 0.5) * r.long;
    const pc = (rand() - 0.5) * r.short;
    const h = vn.size[0] / 2;
    if (!fits(pa, pc, h, h, vn.clear)) continue;
    add("vent", pa, pc, h, h, { height: Math.round((vn.height[0] + rand() * (vn.height[1] - vn.height[0])) * 100) / 100 });
    i += 1;
  }
  return out;
}
