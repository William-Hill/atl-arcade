// Placement of the facade kit (assets/facades/facade-kit.glb) on real
// OSM/Overture footprints. Pure: no Three.js, no game state. The parent
// session wires it in (see docs/facade-kit.md); nothing in src/ calls it yet.
//
// facadePlacements() returns instances { module, wall, position: [x, y, z],
// rotationY, scale: [sx, sy, 1], tint } in game meters (+y up). The module
// frame is +x along the wall, +y up, +z out of the wall, so rotationY turns
// module +x onto the wall tangent and module +z onto the outward normal.

// The window frame of the facade shader is FRAME cells wider and taller than
// the glass, and an upper window is centered at WINDOW_CENTER of the floor
// (facade-kit.js, geo-view.js). The sign band starts at SIGN_Y0 of the floor.
export const FRAME = 0.07;
export const WINDOW_CENTER = 0.55;
export const SIGN_Y0 = 0.84;
export const PIER = 0.36;
// The wall-run modules are 2 m long; a run is cut into whole segments.
export const RUN = 2;
export const MIN_WALL = 1.5;
// The stair of fire_escape_floor rises FIRE_ESCAPE_RISE (m) to the platform of
// the unit above (its 4.8 m nominal height includes the upper handrail).
export const FIRE_ESCAPE_RISE = 4.2;
// The clear margin (m) around a mural, as MURAL_CLEAR in facade-kit.js.
export const MURAL_CLEAR = 0.3;
// Draw LOD1 (the <module>_lod1 node) past this camera distance (m).
export const LOD1_DISTANCE = 60;

// Nominal sizes [x, y, z] (m) of the modules, from extras.kit.size.
export const MODULES = {
  storefront_door_26: [2.24, 3.3, 0.15],
  storefront_glass_26: [2.24, 3.3, 0.15],
  storefront_door_32: [2.84, 3.3, 0.15],
  storefront_glass_32: [2.84, 3.3, 0.15],
  storefront_door_45: [4.14, 3.3, 0.15],
  storefront_glass_45: [4.14, 3.3, 0.15],
  window_brick_loft: [2.1, 2.9, 0.14],
  window_brick_warehouse: [3.0, 2.85, 0.14],
  window_stucco_apartment: [1.56, 1.98, 0.1],
  window_stucco_modern: [2.0, 2.28, 0.22],
  cornice_segment: [2, 0.76, 0.5],
  cornice_corner: [1.1, 0.76, 1.1],
  parapet_cap_segment: [2, 0.2, 0.45],
  parapet_cap_corner: [0.67, 0.2, 0.67],
  belt_course_segment: [2, 0.26, 0.12],
  belt_course_corner: [0.72, 0.26, 0.72],
  awning_fabric: [2.84, 1.02, 1.2],
  awning_metal: [2.84, 1.14, 1],
  balcony_juliet: [2.02, 1.07, 0.32],
  balcony_slab: [3, 1.27, 1.4],
  fire_escape_floor: [3.4, 4.8, 1.1],
  fire_escape_top: [3.4, 1, 1.1],
  fire_escape_ladder: [0.49, 3.3, 0.82],
  ac_unit_wall: [0.66, 0.78, 0.45],
  hvac_rooftop: [2.5, 1.41, 1.46],
  hvac_condenser: [0.92, 1.04, 0.92],
  roof_vent: [0.4, 0.64, 0.4],
  roof_exhaust: [0.84, 0.7, 0.84],
  trim_pilaster: [0.4, 1, 0.08],
  trim_pilaster_cap: [0.5, 0.26, 0.16],
  trim_downspout: [0.14, 1, 0.145],
  trim_downspout_head: [0.32, 0.62, 0.2],
  trim_downspout_shoe: [0.1, 0.5, 0.41],
  trim_sign_board: [1.88, 0.58, 0.065],
  trim_gooseneck_lamp: [0.34, 0.42, 0.79],
};
// The modules with a <module>_lod1 node in the GLB.
export const LOD1 = new Set(["balcony_slab", "fire_escape_floor", "fire_escape_top", "hvac_rooftop"]);

const STOREFRONTS = [26, 32, 45];
const WINDOW_OF = {
  "brick-loft": "window_brick_loft",
  "brick-warehouse": "window_brick_warehouse",
  "stucco-apartment": "window_stucco_apartment",
  "craftsman-house": "window_stucco_apartment",
  "shotgun-house": "window_stucco_apartment",
  "modern-apartment": "window_stucco_modern",
  storefront: "window_brick_loft",
};
const FIRE_ESCAPE = new Set(["brick-loft", "brick-warehouse", "stucco-apartment"]);
const AC_UNITS = new Set(["stucco-apartment", "brick-loft", "shotgun-house", "craftsman-house"]);
const BALCONY = { "modern-apartment": "balcony_slab", "stucco-apartment": "balcony_juliet", "brick-loft": "balcony_juliet" };
const HOUSES = new Set(["craftsman-house", "shotgun-house"]);
const NO_ROOF_KIT = new Set(["craftsman-house", "shotgun-house", "glass-office", "parking-deck", "industrial-shed"]);
const CORNER = { min: (75 * Math.PI) / 180, max: (105 * Math.PI) / 180 };
const SCALE = { storefront: [0.8, 1.2], window: [0.8, 1.25], awning: [0.8, 1.6], run: [0.75, 1.25] };

// A small deterministic PRNG (mulberry32), so a building gets the same
// modules on every load.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wallOf(ring, i) {
  const [px, pz] = ring[i];
  const [qx, qz] = ring[(i + 1) % ring.length];
  const len = Math.hypot(qx - px, qz - pz) || 1;
  const t = [(qx - px) / len, (qz - pz) / len];
  // The outward normal of an outer ring edge (orientRing(ring, false)).
  return { o: [px, pz], t, n: [-t[1], t[0]], len };
}

// The yaw that turns module +x onto t (and module +z onto n = (-t.z, t.x)).
export function wallYaw(t) {
  return Math.atan2(-t[1], t[0]);
}

// The column-major 4x4 matrix of an instance (for InstancedMesh.setMatrixAt
// via Matrix4.fromArray).
export function instanceMatrix({ position, rotationY, scale }) {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  const [sx, sy, sz] = scale;
  return [c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, position[0], position[1], position[2], 1];
}

function inRange(v, [lo, hi]) {
  return v >= lo - 1e-9 && v <= hi + 1e-9;
}

// The storefront width (26, 32, or 45) whose nominal width is closest to w.
export function storefrontFor(w) {
  let best = STOREFRONTS[0];
  for (const k of STOREFRONTS) if (Math.abs(MODULES[`storefront_glass_${k}`][0] - w) < Math.abs(MODULES[`storefront_glass_${best}`][0] - w)) best = k;
  return best;
}

// The turn at ring vertex i (between wall i-1 and wall i), in radians:
// positive for an outside corner of an outer ring (orientRing(ring, false)).
export function turnAt(ring, i) {
  const a = wallOf(ring, (i - 1 + ring.length) % ring.length).t;
  const b = wallOf(ring, i).t;
  return -Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a) / 2;
}

function inside(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function edgeDistance(ring, x, z) {
  let d = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const { o, t, len } = wallOf(ring, i);
    const a = Math.max(0, Math.min(len, (x - o[0]) * t[0] + (z - o[1]) * t[1]));
    d = Math.min(d, Math.hypot(x - o[0] - t[0] * a, z - o[1] - t[1] * a));
  }
  return d;
}

// ring: the outer ring as [[x, z], ...] as orientRing(b.outer, false)
// returns it (the outward normal of edge i is (-t.z, t.x)); holes: the inner
// rings (b.holes, courtyards), kept clear of roof units; style: a STYLES
// entry; base/top: the wall base and top (buildingSpan()); front: frontEdge()
// of the building or null; mural: the building's muralWalls() entry
// ({ edge, t0, t1, y0, y1 }) or null, kept clear like wallDepth() does;
// seed: a stable integer (hash32(b.id)).
export function facadePlacements({ ring, holes = [], style, base = 0, top, front = null, mural = null, seed = 1 }) {
  const out = [];
  if (!(ring?.length >= 3) || !(top > base)) return out;
  const rand = rng(seed);
  const height = top - base;
  // Same floor split as facadeKit()/extrudeFootprint(): whole floors, stretched to fit.
  const floors = Math.max(1, Math.round(height / style.floorHeight));
  const floorH = height / floors;
  const add = (module, wall, w, a, y, d, sx = 1, sy = 1, tint = null) => {
    out.push({ module, wall: w, position: [w.o[0] + w.t[0] * a + w.n[0] * d, y, w.o[1] + w.t[1] * a + w.n[1] * d], rotationY: wallYaw(w.t), scale: [sx, sy, 1], tint, wallIndex: wall });
  };
  const fronts = new Set(front && front.edge >= 0 ? [front.edge, ...(front.wraps ?? [])] : []);
  const shop = style.storefront && fronts.size > 0;
  const parapet = style.parapet ?? 0;
  // A box [a0, a1] x [y0, y1] on wall i that is on the mural or within MURAL_CLEAR of it.
  const onMural = (i, a0, a1, y0, y1) => !!mural && mural.edge === i && a1 > mural.t0 - MURAL_CLEAR && a0 < mural.t1 + MURAL_CLEAR && y1 > mural.y0 - MURAL_CLEAR && y0 < mural.y1 + MURAL_CLEAR;
  const windowModule = WINDOW_OF[style.id] ?? null;
  const flatRoof = !NO_ROOF_KIT.has(style.id);
  const corniceRoof = flatRoof && (style.parapet ?? 0) >= 0.5 && height > 5;
  const fireWall = FIRE_ESCAPE.has(style.id) && floors >= 3 ? pickFireWall(ring, fronts, rand, mural) : -1;

  for (let i = 0; i < ring.length; i += 1) {
    const w = wallOf(ring, i);
    if (w.len < MIN_WALL) continue;
    const bays = Math.max(1, Math.round(w.len / style.bay));
    const bl = w.len / bays;
    // The primary front gets the whole shop front; a wrap wall only its corner
    // bay (the bay next to the primary front), as shopFront() does.
    const isShop = shop && fronts.has(i);
    const shopBays = !isShop ? [] : i === front.edge ? [...Array(bays).keys()] : [i === (front.edge + 1) % ring.length ? 0 : bays - 1];
    const fireBay = i === fireWall ? Math.floor(bays / 2) : -1;

    // Ground floor of a storefront wall: glass bays, a door at the center
    // bay, a sign board on every other bay, the belt course, and awnings.
    if (isShop) {
      const wOpen = bl - PIER;
      const k = storefrontFor(wOpen);
      const sx = wOpen / MODULES[`storefront_glass_${k}`][0];
      const sy = (SIGN_Y0 * floorH - 0.04) / MODULES[`storefront_glass_${k}`][1];
      const door = Math.floor(bays / 2);
      for (const b of shopBays) {
        const a = (b + 0.5) * bl;
        if (onMural(i, a - bl / 2, a + bl / 2, base, base + floorH)) continue;
        if (inRange(sx, SCALE.storefront) && inRange(sy, SCALE.storefront)) add(`storefront_${b === door && i === front.edge ? "door" : "glass"}_${k}`, i, w, a, base, 0, sx, sy);
        if (b % 2 === 0 || i !== front.edge) add("trim_sign_board", i, w, a, base + SIGN_Y0 * floorH, 0.07, 1, 1, "trim");
        const awn = i === front.edge && (style.awnings ?? 0) > 0 && rand() < Math.max(style.awnings, 0.5);
        const asx = wOpen / MODULES.awning_fabric[0];
        if (awn && inRange(asx, SCALE.awning)) {
          const metal = style.brick || style.id === "modern-apartment";
          add(metal ? "awning_metal" : "awning_fabric", i, w, a, base + SIGN_Y0 * floorH - 0.02, 0, asx, 1, metal ? null : "awning");
        }
      }
      for (let b = 1; b < bays; b += 1) if ((shopBays.includes(b) || shopBays.includes(b - 1)) && !onMural(i, b * bl - 0.2, b * bl + 0.2, base, base + floorH)) add("trim_pilaster", i, w, b * bl, base, 0, 1, floorH - 0.14);
      if (floors >= 2) run(out, "belt_course_segment", i, w, base + floorH - 0.13, add);
    }

    // Upper windows (and the ground floor of a non-storefront style), in the
    // bays of the facade shader, so a module frame covers a shader window.
    // The shader paints shop glass on every ground-floor wall of a storefront
    // style, so no window module goes there (as wallDepth() puts no sill).
    const firstFloor = style.storefront ? 1 : 0;
    if (windowModule && !(style.id === "glass-office")) {
      const [mw, mh] = MODULES[windowModule];
      const sx = ((style.window[0] + FRAME) * bl) / mw;
      const sy = ((style.window[1] + FRAME) * floorH) / mh;
      const yOff = (WINDOW_CENTER - (style.window[1] + FRAME) / 2) * floorH;
      for (let f = firstFloor; f < floors; f += 1) {
        const yf = base + f * floorH;
        if (yf + yOff + (style.window[1] + FRAME) * floorH > top - 0.1) break;
        for (let b = 0; b < bays; b += 1) {
          const a = (b + 0.5) * bl;
          if (b === fireBay && f >= 1) continue;
          // The frame's own bounds, as wallDepth() tests the sill's.
          if (onMural(i, a - (sx * mw) / 2, a + (sx * mw) / 2, yf + yOff, yf + yOff + sy * mh)) continue;
          if (inRange(sx, SCALE.window) && inRange(sy, SCALE.window)) add(windowModule, i, w, a, yf + yOff, 0, sx, sy);
          const r = rand();
          if (f >= 1 && BALCONY[style.id] && fronts.has(i) && r < 0.18) add(BALCONY[style.id], i, w, a, yf, 0, Math.min(1.3, bl / MODULES[BALCONY[style.id]][0]));
          else if (AC_UNITS.has(style.id) && !fronts.has(i) && r > 0.9 && !onMural(i, a + 0.2 * bl - 0.33, a + 0.2 * bl + 0.33, yf + yOff - 0.45, yf + yOff + 0.33)) add("ac_unit_wall", i, w, a + 0.2 * bl, yf + yOff - 0.45, 0);
        }
      }
    }

    // A fire escape: one unit per floor from the second floor, a top unit,
    // and a ladder under the lowest platform.
    if (fireBay >= 0) {
      const a = (fireBay + 0.5) * bl;
      add("fire_escape_ladder", i, w, a, base + floorH, 0);
      for (let f = 1; f < floors - 1; f += 1) add("fire_escape_floor", i, w, a, base + f * floorH, 0, 1, floorH / FIRE_ESCAPE_RISE);
      add("fire_escape_top", i, w, a, base + (floors - 1) * floorH, 0);
      add("trim_downspout", i, w, Math.min(w.len - 0.3, a + 2.2), base + 0.5, 0, 1, height - 1.12, "trim");
      add("trim_downspout_shoe", i, w, Math.min(w.len - 0.3, a + 2.2), base, 0, 1, 1, "trim");
      add("trim_downspout_head", i, w, Math.min(w.len - 0.3, a + 2.2), top - 0.62, 0, 1, 1, "trim");
    }

    // The roof line, as buildingKit(): a cornice at the wall top on the front
    // walls of a tall parapet style (every wall without a shop front), and a
    // cap on the parapet top (top + parapet) of every wall that has one.
    if (flatRoof && corniceRoof && (fronts.has(i) || !shop)) run(out, "cornice_segment", i, w, top - 0.76, add);
    if (flatRoof && parapet > 0) run(out, "parapet_cap_segment", i, w, top + parapet, add);
  }

  // Corner pieces at the outside corners near 90 degrees.
  for (let i = 0; i < ring.length; i += 1) {
    const turn = turnAt(ring, i);
    if (!flatRoof || turn < CORNER.min || turn > CORNER.max) continue;
    const prev = (i - 1 + ring.length) % ring.length;
    const wp = wallOf(ring, prev);
    if (wp.len < MIN_WALL || wallOf(ring, i).len < MIN_WALL) continue;
    if (corniceRoof && ((fronts.has(prev) && fronts.has(i)) || !shop)) add("cornice_corner", prev, wp, wp.len, top - 0.76, 0, 1, 1, "trim");
    if (parapet > 0) add("parapet_cap_corner", prev, wp, wp.len, top + parapet, 0, 1, 1, "trim");
    if (shop && fronts.has(prev) && fronts.has(i) && floors >= 2) add("belt_course_corner", prev, wp, wp.len, base + floorH - 0.13, 0, 1, 1, "trim");
  }

  if (flatRoof) roofUnits(out, ring, holes, top, style, rand);
  return out;
}

function run(out, module, i, w, y, add) {
  const n = Math.max(1, Math.round(w.len / RUN));
  const sx = w.len / n / RUN;
  if (!inRange(sx, SCALE.run)) return;
  for (let k = 0; k < n; k += 1) add(module, i, w, (k + 0.5) * w.len / n, y, 0, sx, 1, "trim");
}

// The longest wall that is not a front wall (the side or back of the
// building), if it is long enough for a fire escape (and a 1-in-2 chance).
function pickFireWall(ring, fronts, rand, mural) {
  let best = -1;
  for (let i = 0; i < ring.length; i += 1) if (!fronts.has(i) && mural?.edge !== i && wallOf(ring, i).len >= 8 && (best < 0 || wallOf(ring, i).len > wallOf(ring, best).len)) best = i;
  return best >= 0 && rand() < 0.5 ? best : -1;
}

// Roof units at least 1.5 m from every wall and courtyard edge, never over a
// courtyard: one big unit over 300 m2, condensers by area, and vent clusters.
function roofUnits(out, ring, holes, top, style, rand) {
  const area = ringArea(ring) - holes.reduce((s, h) => s + ringArea(h), 0);
  if (area < 60) return;
  // Sample the outer footprint's bounds (a courtyard can cover the middle).
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const list = [];
  if (area > 300) list.push(["hvac_rooftop", 2.2]);
  for (let k = 0; k < Math.min(4, Math.floor(area / 150)); k += 1) list.push(["hvac_condenser", 1.2]);
  if (style.id === "storefront") list.push(["roof_exhaust", 1.0]);
  for (let k = 0; k < 2 + Math.floor(rand() * 3); k += 1) list.push(["roof_vent", 0.6]);
  const spots = [];
  for (const [module, clear] of list) {
    for (let tries = 0; tries < 48; tries += 1) {
      const x = x0 + rand() * (x1 - x0);
      const z = z0 + rand() * (z1 - z0);
      if (!inside(ring, x, z) || edgeDistance(ring, x, z) < 1.5 + clear) continue;
      if (holes.some((h) => inside(h, x, z) || edgeDistance(h, x, z) < 1.5 + clear)) continue;
      if (spots.some(([sx, sz, sc]) => Math.hypot(sx - x, sz - z) < sc + clear)) continue;
      spots.push([x, z, clear]);
      out.push({ module, wall: null, wallIndex: null, position: [x, top, z], rotationY: Math.round(rand() * 4) * (Math.PI / 2), scale: [1, 1, 1], tint: null });
      break;
    }
  }
}

// Groups the instances by module: Map(module -> [instance]), so each module
// becomes one InstancedMesh (LOD0) and one for its _lod1 node when it has one.
export function byModule(instances) {
  const m = new Map();
  for (const it of instances) {
    if (!m.has(it.module)) m.set(it.module, []);
    m.get(it.module).push(it);
  }
  return m;
}
