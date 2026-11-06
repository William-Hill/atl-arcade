// Building styles: the facade kit for the real footprints. Pure data and a
// pure chooser. The render turns each style into shader uniforms; the mesh
// builder turns it into bays, floors, a parapet, awnings, and roof props.
//
// Colors are [r, g, b] in 0..1. The look follows Atlanta at its best: warm
// brick, painted stucco, bright storefronts, clean glass.

export const STYLES = [
  {
    id: "brick-loft",
    walls: [[0.62, 0.3, 0.24], [0.7, 0.36, 0.26], [0.55, 0.27, 0.22]],
    // The facade shader adds the brick scan detail (assets/landmarks/textures/brick).
    brick: true,
    trim: [0.9, 0.86, 0.78],
    glass: [0.2, 0.32, 0.42],
    floorHeight: 4.2,
    bay: 3.4,
    window: [0.55, 0.62],
    parapet: 0.9,
    storefront: true,
    awnings: 0.3,
    roof: { water_tower: 0.6, roof_unit: 1 / 400 },
    // The flat roof: a dark gray membrane, darker than the coping, so the
    // coping reads as a light line from above.
    roofColor: [0.3, 0.3, 0.31],
    // The crown (facade-kit.js crownKit()): a raised center parapet `step`
    // meters over the parapet, and a stair bulkhead box on the roof
    // ([along, across, height] in meters).
    crown: { step: 1.6, bulkhead: [3.0, 3.6, 2.8] },
    // Painted steel window frames: a mid sage, not darker than the brick.
    frame: [0.2, 0.3, 0.24],
  },
  {
    id: "brick-warehouse",
    walls: [[0.58, 0.28, 0.22], [0.66, 0.33, 0.25]],
    // The facade shader adds the brick scan detail (assets/landmarks/textures/brick).
    brick: true,
    trim: [0.84, 0.8, 0.72],
    glass: [0.18, 0.28, 0.36],
    floorHeight: 5,
    bay: 4.5,
    window: [0.6, 0.5],
    parapet: 1.1,
    storefront: true,
    awnings: 0.2,
    roof: { water_tower: 0.25, roof_unit: 1 / 500, solar: 0.4 },
    roofColor: [0.32, 0.31, 0.3],
    crown: { step: 1.6, bulkhead: [3.0, 3.6, 2.8] },
    frame: [0.2, 0.3, 0.24],
  },
  {
    id: "stucco-apartment",
    walls: [[0.95, 0.85, 0.7], [0.96, 0.75, 0.62], [0.86, 0.9, 0.84], [0.98, 0.9, 0.76]],
    trim: [1, 1, 0.98],
    glass: [0.28, 0.42, 0.55],
    floorHeight: 3.2,
    bay: 3.0,
    window: [0.45, 0.55],
    parapet: 0.6,
    storefront: false,
    awnings: 0,
    roof: { roof_unit: 1 / 250, solar: 0.3 },
  },
  {
    id: "modern-apartment",
    walls: [[0.9, 0.9, 0.9], [0.32, 0.36, 0.42], [0.95, 0.62, 0.4], [0.5, 0.66, 0.78]],
    trim: [0.22, 0.24, 0.28],
    glass: [0.36, 0.55, 0.7],
    floorHeight: 3.3,
    bay: 2.6,
    window: [0.7, 0.62],
    parapet: 0.5,
    storefront: true,
    awnings: 0,
    roof: { roof_unit: 1 / 200, solar: 0.5 },
  },
  {
    id: "glass-office",
    walls: [[0.42, 0.58, 0.7], [0.5, 0.62, 0.7]],
    trim: [0.85, 0.88, 0.9],
    glass: [0.3, 0.5, 0.68],
    floorHeight: 3.8,
    bay: 1.8,
    window: [0.86, 0.78],
    parapet: 0.8,
    storefront: true,
    awnings: 0,
    roof: { roof_unit: 1 / 300, solar: 0.4 },
  },
  {
    id: "storefront",
    walls: [[0.98, 0.78, 0.45], [0.55, 0.8, 0.85], [0.93, 0.6, 0.66], [0.62, 0.82, 0.6], [0.96, 0.64, 0.4]],
    trim: [1, 1, 1],
    glass: [0.22, 0.36, 0.46],
    floorHeight: 4,
    bay: 3.2,
    window: [0.6, 0.55],
    parapet: 0.9,
    storefront: true,
    awnings: 0.8,
    roof: { roof_unit: 1 / 250 },
  },
  {
    id: "shotgun-house",
    walls: [[0.98, 0.94, 0.85], [0.66, 0.82, 0.88], [0.98, 0.84, 0.6], [0.85, 0.72, 0.86], [0.7, 0.86, 0.7]],
    trim: [1, 1, 1],
    glass: [0.24, 0.34, 0.44],
    floorHeight: 3.4,
    bay: 2.6,
    window: [0.38, 0.5],
    parapet: 0.3,
    storefront: false,
    awnings: 0,
    roof: {},
  },
  {
    id: "craftsman-house",
    walls: [[0.75, 0.62, 0.48], [0.62, 0.7, 0.62], [0.88, 0.8, 0.66], [0.6, 0.66, 0.78]],
    trim: [0.98, 0.96, 0.9],
    glass: [0.22, 0.3, 0.4],
    floorHeight: 3.5,
    bay: 3.0,
    window: [0.42, 0.5],
    parapet: 0.35,
    storefront: false,
    awnings: 0,
    roof: {},
  },
  {
    id: "industrial-shed",
    walls: [[0.72, 0.74, 0.76], [0.6, 0.66, 0.7], [0.82, 0.78, 0.68]],
    trim: [0.95, 0.66, 0.2],
    glass: [0.3, 0.4, 0.48],
    floorHeight: 6,
    bay: 6,
    window: [0.4, 0.22],
    parapet: 0.4,
    storefront: false,
    awnings: 0,
    // The industrial sheds get the old water towers of the Atlanta mills.
    roof: { roof_unit: 1 / 600, water_tower: 0.5, solar: 0.6 },
  },
  {
    id: "parking-deck",
    walls: [[0.8, 0.8, 0.78]],
    trim: [0.96, 0.7, 0.3],
    glass: [0.12, 0.12, 0.14],
    floorHeight: 3.2,
    bay: 8,
    window: [0.92, 0.5],
    parapet: 1.0,
    storefront: false,
    awnings: 0,
    roof: {},
  },
  {
    id: "church",
    walls: [[0.62, 0.32, 0.26], [0.9, 0.88, 0.82]],
    trim: [1, 0.98, 0.94],
    glass: [0.45, 0.32, 0.6],
    floorHeight: 6,
    bay: 3.5,
    window: [0.3, 0.6],
    parapet: 1.2,
    storefront: false,
    awnings: 0,
    roof: {},
  },
  {
    // Krog Street Market: brick walls, shop windows, and no parapet, because
    // the metal sawtooth roof (assets/landmarks/krog-street-market-front.json)
    // starts right on top of the brick.
    id: "brick-market-hall",
    walls: [[0.6, 0.29, 0.23]],
    // The facade shader adds the brick scan detail (assets/landmarks/textures/brick).
    brick: true,
    trim: [0.42, 0.4, 0.38],
    glass: [0.2, 0.3, 0.38],
    floorHeight: 6,
    bay: 4.2,
    window: [0.62, 0.5],
    parapet: 0,
    storefront: true,
    awnings: 0,
    roof: { roof_unit: 1 / 700 },
  },
  {
    id: "garage",
    walls: [[0.78, 0.76, 0.72], [0.66, 0.6, 0.56]],
    trim: [0.9, 0.9, 0.9],
    glass: [0.4, 0.42, 0.44],
    floorHeight: 3,
    bay: 3,
    window: [0.7, 0.62],
    parapet: 0.15,
    storefront: false,
    awnings: 0,
    roof: {},
  },
];

// The belt course of the facade kit: a ledge over the ground floor of a
// storefront style. The murals (geo-mesh.js) start above it.
export const BELT = { out: 0.18, height: 0.28 };

// The painted sign bands over the shop windows (facade-kit.js shopFront()):
// one color for each building. The boards on them have no text.
export const SIGN_COLORS = [
  [0.06, 0.22, 0.13], // deep green
  [0.05, 0.09, 0.22], // navy
  [0.32, 0.05, 0.04], // oxblood
  [0.62, 0.42, 0.07], // mustard
];

// The height of the storefront awnings over the wall base (geo-mesh.js).
export function awningHeight(style) {
  return Math.min(style.floorHeight * 0.8, 3.4);
}

export const STYLE_INDEX = Object.fromEntries(STYLES.map((s, i) => [s.id, i]));

// A stable hash of a string (FNV-1a), for seeded choices.
export function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A seeded random number generator (mulberry32). Same seed, same numbers.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function footprintArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a / 2);
}

const BY_TYPE = {
  house: "craftsman-house",
  detached: "craftsman-house",
  semidetached_house: "shotgun-house",
  terrace: "shotgun-house",
  residential: "stucco-apartment",
  apartments: "modern-apartment",
  dormitory: "stucco-apartment",
  hotel: "modern-apartment",
  office: "glass-office",
  commercial: "storefront",
  retail: "storefront",
  industrial: "brick-warehouse",
  warehouse: "industrial-shed",
  church: "church",
  school: "brick-warehouse",
  garage: "garage",
  garages: "garage",
  shed: "garage",
  carport: "garage",
  roof: "garage",
  parking: "parking-deck",
};

// Named landmarks get a fixed style. Ponce City Market is the old Sears,
// Roebuck brick warehouse; Krog Street Market is a 1920s brick warehouse.
const BY_NAME = [
  [/ponce city market/i, "brick-warehouse"],
  [/krog street market/i, "brick-market-hall"],
  [/ford factory/i, "brick-loft"],
  [/stove works/i, "brick-loft"],
  [/studioplex/i, "brick-loft"],
  [/fourth ward offices/i, "glass-office"],
];

// The district table (after the teleoperator district map): each district
// anchors on a named building in the level, and mid-size stock near the
// anchor draws its style from the district's own mix, so a block reads as
// its neighborhood — the Inman Park houses, the Fourth Ward's newer
// apartments, the Poncey-Highland storefronts. The big-tower and garage
// rules stay by size, and named or typed buildings keep their style.
const DISTRICTS = [
  { id: "poncey-highland", anchor: "Ponce City Market", radius: 380 },
  { id: "old-fourth-ward", anchor: "Iris O4W", radius: 520 },
  { id: "inman-park", anchor: "Krog Street Market", radius: 380 },
];
const DISTRICT_MIX = {
  "poncey-highland": [["storefront", 45], ["brick-loft", 30], ["stucco-apartment", 25]],
  "old-fourth-ward": [["modern-apartment", 40], ["storefront", 30], ["stucco-apartment", 30]],
  "inman-park": [["craftsman-house", 35], ["shotgun-house", 20], ["brick-loft", 25], ["stucco-apartment", 20]],
};
const anchorCache = new WeakMap();
function anchors(level) {
  let list = anchorCache.get(level);
  if (!list) {
    const byName = new Map((level.buildings ?? []).map((b) => [b.name, b]));
    list = DISTRICTS.map((d) => ({ d, b: byName.get(d.anchor) }))
      .filter((e) => e.b)
      .map(({ d, b }) => {
        let x = 0, z = 0;
        for (const p of b.outer) { x += p[0]; z += p[1]; }
        return { id: d.id, radius: d.radius, x: x / b.outer.length, z: z / b.outer.length };
      });
    if (typeof level === "object" && level !== null) anchorCache.set(level, list);
  }
  return list;
}
// The district anchors of a level: { id, radius, x, z } for each district
// whose anchor building is in the level (for the pbr district grade,
// src/render/pbr-palette.js).
export function districtAnchors(level) {
  return anchors(level).map((a) => ({ ...a }));
}

// The district of a building: the nearest anchor within its radius.
function districtOf(b, level) {
  let x = 0, z = 0;
  for (const p of b.outer) { x += p[0]; z += p[1]; }
  x /= b.outer.length;
  z /= b.outer.length;
  let best = null;
  for (const a of anchors(level)) {
    const d = Math.hypot(x - a.x, z - a.z);
    if (d < a.radius && (!best || d < best.d)) best = { id: a.id, d };
  }
  return best?.id ?? null;
}

// The styles a district mix can change: the housing, apartment, loft, and
// warehouse stock. A storefront stays a storefront (the shop fronts, the
// aprons, and the street walls depend on it), and a garage or a tower keeps
// its rule.
const RESTYLEABLE = new Set(["modern-apartment", "stucco-apartment", "craftsman-house", "shotgun-house", "brick-loft", "brick-warehouse", "industrial-shed"]);

// Picks the style for one building: a landmark name, then the OSM building
// type, then the OSM wall material (brick), then the size and height, with
// the district mix for the stock that can change hands. Deterministic for a
// building id.
export function chooseStyle(b, level = null) {
  for (const [re, id] of BY_NAME) if (re.test(b.name ?? "")) return id;
  if (b.type && BY_TYPE[b.type]) return BY_TYPE[b.type];
  const area = footprintArea(b.outer);
  if (b.material === "brick" && area >= 220) return area > 2500 ? "brick-warehouse" : "brick-loft";
  const r = hash32(b.id) % 100;
  let pick;
  if (area < 40) pick = "garage";
  else if (b.height >= 30) pick = r < 50 ? "glass-office" : "modern-apartment";
  else if (b.height >= 14) pick = r < 60 ? "modern-apartment" : "stucco-apartment";
  else if (area < 220) pick = r < 55 ? "craftsman-house" : "shotgun-house";
  else if (area > 2500) pick = r < 50 ? "brick-warehouse" : "industrial-shed";
  else if (area > 900) pick = r < 60 ? "storefront" : "brick-loft";
  else pick = r < 40 ? "storefront" : r < 70 ? "stucco-apartment" : "brick-loft";
  const d = level && RESTYLEABLE.has(pick) ? districtOf(b, level) : null;
  const mix = d ? DISTRICT_MIX[d] : null;
  if (mix) {
    const wantShop = Boolean(STYLES[STYLE_INDEX[pick]].storefront);
    let acc = 0;
    for (const [id, w] of mix) {
      acc += w;
      // A storefront stays a storefront: the shop fronts, the aprons, and
      // the street walls depend on the flag.
      if (r < acc) return wantShop === Boolean(STYLES[STYLE_INDEX[id]].storefront) ? id : pick;
    }
  }
  return pick;
}

// The wall color for one building: one of the style's colors, by id.
export function wallColor(style, id) {
  return style.walls[hash32(`${id}:wall`) % style.walls.length];
}

// The floor height range (m) that an OSM `building:levels` count must give
// to count. Out of the range, the count does not match the height.
export const LEVEL_FLOOR = [2.6, 6.5];

// The floor count of a building with a wall height of `wall` m: the OSM
// level count (`b.levels`) when it gives a floor height in LEVEL_FLOOR, else
// the wall height over the style floor height. The facade shader
// (extrude.js) and the kit (facade-kit.js) use the same count.
export function floorCount(b, style, wall) {
  const n = b?.levels;
  if (Number.isInteger(n) && n > 0 && wall / n >= LEVEL_FLOOR[0] && wall / n <= LEVEL_FLOOR[1]) return n;
  return Math.max(1, Math.round(wall / style.floorHeight));
}

// The house styles: a gable roof and a porch.
export const HOUSE_STYLES = new Set(["craftsman-house", "shotgun-house"]);
// The OSM roof shapes that the kit builds as a gable roof.
const GABLE_SHAPES = new Set(["gabled", "hipped", "pyramidal", "half-hipped", "gambrel"]);

// The roof form of a building: "gable" or "flat". The OSM `roof:shape`
// (`b.roofShape`) comes first: "flat" keeps a house flat, and a gable
// shape gives a gable to a building with a low parapet. Else a house gets
// a gable and every other style a flat roof.
export function roofForm(b, style) {
  const shape = b?.roofShape;
  if (shape === "flat") return "flat";
  if (GABLE_SHAPES.has(shape) && (style.parapet ?? 0) <= 0.4) return "gable";
  return HOUSE_STYLES.has(style.id) ? "gable" : "flat";
}
