// Terrain for a geodata level. Pure.
//
// `level.terrain` is a grid of `cell` meters from (x0, z0), with the heights
// in cm (int16, base64), from scripts/terrain-dem.py (USGS 3DEP). The height
// between the nodes is piecewise linear on two triangles per cell, split on
// the diagonal from (1, 0) to (0, 1). So the terrain is a triangle mesh, and
// a flat piece inside one terrain triangle stays flat when it is moved up by
// the terrain height. drapeMesh() uses that: it cuts each triangle of a mesh
// on the terrain triangles, so a street a few cm over the ground stays a few
// cm over the ground everywhere, with no gap and no overlap.
//
// A level with no terrain gets the flat terrain (height 0 everywhere).

const cache = new WeakMap();
const UP = [0, 1, 0];

export const FLAT_TERRAIN = {
  flat: true,
  height: () => 0,
  normal: () => UP,
};

export function encodeHeights(heights) {
  const view = new DataView(new ArrayBuffer(heights.length * 2));
  heights.forEach((h, i) => view.setInt16(i * 2, Math.round(h * 100), true));
  const bytes = new Uint8Array(view.buffer);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function decodeHeights(base64, count) {
  return decode(base64, count);
}

function decode(base64, count) {
  let bytes;
  if (typeof Buffer !== "undefined") bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  else bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) out[i] = view.getInt16(i * 2, true) / 100;
  return out;
}

// Makes a terrain from a grid { cell, x0, z0, cols, rows, heights } (heights
// in meters, row-major). Exported for the tests.
export function createTerrain({ cell, x0, z0, cols, rows, heights }) {
  function node(i, j) {
    const ci = Math.max(0, Math.min(cols - 1, i));
    const cj = Math.max(0, Math.min(rows - 1, j));
    return heights[cj * cols + ci];
  }
  // The terrain triangle under (x, z): its 3 corner nodes as [x, y, z].
  function triangle(x, z) {
    const fx = (x - x0) / cell;
    const fz = (z - z0) / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const X = (k) => x0 + k * cell;
    const Z = (k) => z0 + k * cell;
    if (u + v <= 1) return [[X(i), node(i, j), Z(j)], [X(i + 1), node(i + 1, j), Z(j)], [X(i), node(i, j + 1), Z(j + 1)]];
    return [[X(i + 1), node(i + 1, j + 1), Z(j + 1)], [X(i), node(i, j + 1), Z(j + 1)], [X(i + 1), node(i + 1, j), Z(j)]];
  }
  function height(x, z) {
    const fx = (x - x0) / cell;
    const fz = (z - z0) / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    if (u + v <= 1) {
      const h = node(i, j);
      return h + u * (node(i + 1, j) - h) + v * (node(i, j + 1) - h);
    }
    const h = node(i + 1, j + 1);
    return h + (1 - u) * (node(i, j + 1) - h) + (1 - v) * (node(i + 1, j) - h);
  }
  function normal(x, z) {
    const [a, b, c] = triangle(x, z);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }
  return { flat: false, cell, x0, z0, cols, rows, height, normal };
}

// The terrain of a level (cached per level object).
export function terrainOf(level) {
  if (!level?.terrain) return FLAT_TERRAIN;
  let t = cache.get(level);
  if (!t) {
    const g = level.terrain;
    t = createTerrain({ ...g, heights: decode(g.data, g.cols * g.rows) });
    cache.set(level, t);
  }
  return t;
}

const coarse = new WeakMap();
// The level terrain with every `step`-th node (for a far level of detail).
// The same function on the shared nodes; between them it is coarser.
export function coarseTerrainOf(level, step = 2) {
  const t = terrainOf(level);
  if (t.flat || step <= 1) return t;
  let m = coarse.get(level);
  if (!m) coarse.set(level, (m = new Map()));
  if (!m.has(step)) {
    const g = level.terrain;
    const h = decode(g.data, g.cols * g.rows);
    const cols = Math.ceil((g.cols - 1) / step) + 1;
    const rows = Math.ceil((g.rows - 1) / step) + 1;
    const heights = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j += 1) for (let i = 0; i < cols; i += 1) heights[j * cols + i] = h[Math.min(g.rows - 1, j * step) * g.cols + Math.min(g.cols - 1, i * step)];
    m.set(step, createTerrain({ cell: g.cell * step, x0: g.x0, z0: g.z0, cols, rows, heights }));
  }
  return m.get(step);
}

const spans = new WeakMap();
// Where a building stands: its walls go from `base` (under the lowest
// footprint corner, so no wall floats on a slope) to `top` (its data height
// over the mean ground of its corners).
export function buildingSpan(level, b) {
  let m = spans.get(level);
  if (!m) spans.set(level, (m = new Map()));
  let s = m.get(b.id);
  if (s) return s;
  const t = terrainOf(level);
  if (t.flat) s = { base: 0, ground: 0, top: b.height };
  else {
    let lo = Infinity;
    let sum = 0;
    for (const [x, z] of b.outer) {
      const h = t.height(x, z);
      lo = Math.min(lo, h);
      sum += h;
    }
    const ground = sum / b.outer.length;
    s = { base: lo - 0.5, ground, top: ground + b.height };
  }
  m.set(b.id, s);
  return s;
}

// A bridge deck: the strip runs straight in height from the ground at its
// first point to the ground at its last point (the bridge ends sit on the
// approach grade). Where the deck crosses a way at grade with less than
// DECK_CLEARANCE, the deck rises in a smooth arch to that clearance, and the
// ends stay on the approach grade. Returns deck(x, z), the deck height
// (without the surface offset) at the nearest point of the center line.
export const DECK_CLEARANCE = 4.5;
const ARCH_GRADE = 0.12;
const decks = new WeakMap();

export function bridgeDeck(level, s) {
  let m = decks.get(level);
  if (!m) decks.set(level, (m = new Map()));
  if (m.has(s.id)) return m.get(s.id);
  const t = terrainOf(level);
  const pts = s.points;
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  const h0 = t.height(pts[0][0], pts[0][1]);
  const h1 = t.height(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  const line = (a) => h0 + (h1 - h0) * (a / total);
  // The arch: the largest lift that a crossing needs, at its distance along.
  let lift = 0;
  let at = total / 2;
  for (let i = 0; i < pts.length - 1; i += 1) {
    for (const o of level.strips ?? []) {
      if (o.bridge) continue;
      for (let j = 0; j < o.points.length - 1; j += 1) {
        const x = segmentsCross(pts[i], pts[i + 1], o.points[j], o.points[j + 1]);
        if (!x) continue;
        const a = cum[i] + Math.hypot(x[0] - pts[i][0], x[1] - pts[i][1]);
        if (a < 3 || a > total - 3) continue;
        const need = t.height(x[0], x[1]) + DECK_CLEARANCE - line(a);
        if (need > lift) {
          lift = need;
          at = a;
        }
      }
    }
  }
  function along(x, z) {
    let best = { d: Infinity, s: 0 };
    for (let i = 0; i < pts.length - 1; i += 1) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const k = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      const d = Math.hypot(x - (ax + k * dx), z - (az + k * dz));
      if (d < best.d) best = { d, s: cum[i] + k * Math.sqrt(l2) };
    }
    return best.s;
  }
  // No arch steeper than ARCH_GRADE on average (a short span gets less lift).
  lift = Math.min(lift, ARCH_GRADE * Math.min(at, total - at));
  // A sine arch from 0 at each end to `lift` at `at`.
  const arch = (a) => (lift > 0 ? lift * Math.sin((Math.PI / 2) * (a < at ? a / at : (total - a) / (total - at))) : 0);
  const deck = (x, z) => {
    const a = along(x, z);
    return line(a) + arch(a);
  };
  deck.slope = (h1 - h0) / total;
  deck.ends = [h0, h1];
  deck.lift = lift;
  m.set(s.id, deck);
  return deck;
}

// A bridge: the slab under the deck and a parapet on each side (m).
export const BRIDGE = { slab: 0.9, parapet: 1.0, parapetWidth: 0.25, color: [0.8, 0.78, 0.74] };

// The clearance under a bridge deck over a way at grade (m).
export const BRIDGE_CLEARANCE = 5;
const EMBANKMENT = { length: 80, side: 6 };

function segmentsCross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const q = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * q[1] - r[1] * q[0];
  if (Math.abs(den) < 1e-9) return null;
  const u = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den;
  const v = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [a[0] + u * r[0], a[1] + u * r[1]] : null;
}

// Raises the terrain grid into an embankment at each end of a bridge that
// is too low over a way at grade. A 4 m grid smooths a railroad embankment,
// so the DEM alone gives the BeltLine bridges about 2 m of clearance. Each
// end rises to the height that gives BRIDGE_CLEARANCE over the lowest way
// under the deck, and falls back to the terrain over EMBANKMENT.length m.
// Pure: returns new heights and a list of the changes.
export function raiseEmbankments(grid, strips) {
  const t = createTerrain(grid);
  const heights = Float32Array.from(grid.heights);
  const { cell, x0, z0, cols, rows } = grid;
  const changes = [];
  const atGrade = strips.filter((s) => !s.bridge);
  for (const b of strips.filter((s) => s.bridge)) {
    const p = b.points;
    let need = -Infinity;
    for (let i = 0; i < p.length - 1; i += 1) {
      for (const o of atGrade) {
        for (let j = 0; j < o.points.length - 1; j += 1) {
          const x = segmentsCross(p[i], p[i + 1], o.points[j], o.points[j + 1]);
          // A way that joins the bridge at an end is its approach, not a way under it.
          const nearEnd = x && Math.min(Math.hypot(x[0] - p[0][0], x[1] - p[0][1]), Math.hypot(x[0] - p[p.length - 1][0], x[1] - p[p.length - 1][1])) < 3;
          if (x && !nearEnd) need = Math.max(need, t.height(x[0], x[1]) + BRIDGE_CLEARANCE);
        }
      }
    }
    if (!(need > -Infinity)) continue;
    for (const [end, next] of [[p[0], p[1]], [p[p.length - 1], p[p.length - 2]]]) {
      const h0 = t.height(end[0], end[1]);
      if (h0 >= need) continue;
      // The outward direction of the approach, away from the span.
      const l = Math.hypot(end[0] - next[0], end[1] - next[1]) || 1;
      const ux = (end[0] - next[0]) / l;
      const uz = (end[1] - next[1]) / l;
      const half = b.width / 2 + 1;
      const reach = EMBANKMENT.length + half + EMBANKMENT.side;
      const i0 = Math.max(0, Math.floor((end[0] - reach - x0) / cell));
      const i1 = Math.min(cols - 1, Math.ceil((end[0] + reach - x0) / cell));
      const j0 = Math.max(0, Math.floor((end[1] - reach - z0) / cell));
      const j1 = Math.min(rows - 1, Math.ceil((end[1] + reach - z0) / cell));
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          const x = x0 + i * cell;
          const z = z0 + j * cell;
          const along = (x - end[0]) * ux + (z - end[1]) * uz;
          const side = Math.abs(-(x - end[0]) * uz + (z - end[1]) * ux);
          // Only past the end (not under the span), to cell / 2 back.
          if (along < -cell / 2 || along > EMBANKMENT.length || side > half + EMBANKMENT.side) continue;
          const k = 1 - Math.max(0, along) / EMBANKMENT.length;
          const s = side <= half ? 1 : 1 - (side - half) / EMBANKMENT.side;
          const k2 = k * k * (3 - 2 * k);
          // Toward `need`, never over it, and never lower than the ground.
          const g = heights[j * cols + i];
          if (g < need) heights[j * cols + i] = g + (need - g) * k2 * s;
        }
      }
      changes.push({ id: b.id, from: Math.round(h0 * 10) / 10, to: Math.round(need * 10) / 10 });
    }
  }
  return { heights, changes };
}

// The Eastside Trail is an old railroad bed: its real grade is a few percent.
// The DEM under it has the cuts and fills of the streets and buildings next
// to it, so its raw profile has short ramps of 40% and more. gradeTrail()
// sets the grid in the trail corridor to a smooth profile: at each point of
// the trail center line, the mean ground of the at-grade trail points within
// TRAIL_GRADE.radius. The middle half of each bridge (along its full length)
// keeps the ground under it (the road under the deck). Pure: returns new heights.
export const TRAIL_GRADE = { radius: 60, step: 4, side: 8 };

// True when (x, z) is within width / 2 + 2 m of the bridge center line, and
// its nearest point on the line is in the middle half of the full length.
// `cum` gives the length at each point, and `total` the full length.
export function bridgeMiddle(b, cum, total, x, z) {
  if (!(total > 0)) return false;
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < b.points.length - 1; i += 1) {
    const [ax, az] = b.points[i];
    const [bx, bz] = b.points[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) {
      best = d;
      at = cum[i] + t * (cum[i + 1] - cum[i]);
    }
  }
  const k = at / total;
  return k > 0.25 && k < 0.75 && best < b.width / 2 + 2;
}

export function gradeTrail(grid, strips) {
  const t = createTerrain(grid);
  const heights = Float32Array.from(grid.heights);
  const { cell, x0, z0, cols, rows } = grid;
  const trail = strips.filter((s) => s.kind === "trail" && !s.bridge);
  const spans = strips.filter((s) => s.bridge);
  // The center line points, each TRAIL_GRADE.step m.
  const pts = [];
  for (const s of trail) {
    for (let i = 0; i < s.points.length - 1; i += 1) {
      const [ax, az] = s.points[i];
      const [bx, bz] = s.points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / TRAIL_GRADE.step));
      for (let k = 0; k <= n; k += 1) {
        const x = ax + ((bx - ax) * k) / n;
        const z = az + ((bz - az) * k) / n;
        pts.push({ x, z, h: t.height(x, z), w: s.width });
      }
    }
  }
  if (!pts.length) return { heights, points: 0 };
  // A bucket grid for the neighbor search.
  const B = TRAIL_GRADE.radius;
  const buckets = new Map();
  const bkey = (x, z) => `${Math.floor(x / B)},${Math.floor(z / B)}`;
  for (const p of pts) {
    const k = bkey(p.x, p.z);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  }
  const near = (x, z, r) => {
    const out = [];
    const bx = Math.floor(x / B);
    const bz = Math.floor(z / B);
    for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) for (const p of buckets.get(`${bx + i},${bz + j}`) ?? []) if (Math.hypot(p.x - x, p.z - z) <= r) out.push(p);
    return out;
  };
  for (const p of pts) {
    const list = near(p.x, p.z, TRAIL_GRADE.radius);
    p.smooth = list.reduce((a, q) => a + q.h, 0) / list.length;
  }
  // The middle half of each bridge, along the full length of its polyline
  // (issue #59): the deck ends sit on the graded approach.
  const spanLines = spans.map((b) => {
    const cum = [0];
    for (let i = 0; i < b.points.length - 1; i += 1) cum.push(cum[i] + Math.hypot(b.points[i + 1][0] - b.points[i][0], b.points[i + 1][1] - b.points[i][1]));
    return { b, cum, total: cum[cum.length - 1] };
  });
  const underSpan = (x, z) => spanLines.some(({ b, cum, total }) => bridgeMiddle(b, cum, total, x, z));
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = x0 + i * cell;
      const z = z0 + j * cell;
      const list = near(x, z, 30);
      if (!list.length) continue;
      let best = list[0];
      let d = Infinity;
      for (const q of list) {
        const dq = Math.hypot(q.x - x, q.z - z);
        if (dq < d) {
          d = dq;
          best = q;
        }
      }
      const half = best.w / 2 + 1;
      if (d > half + TRAIL_GRADE.side || underSpan(x, z)) continue;
      const k = d <= half ? 1 : 1 - (d - half) / TRAIL_GRADE.side;
      const h = heights[j * cols + i];
      heights[j * cols + i] = h + (best.smooth - h) * k * k * (3 - 2 * k);
    }
  }
  return { heights, points: pts.length };
}

// --- Draping a mesh on the terrain ---

const ATTRS = [
  ["colors", 3],
  ["facade", 4],
  ["uvs", 2],
];

// Clips a polygon (a list of vertices { p: [x, y, z], a: { attr: [] } }) to
// the half-plane f(x, z) >= 0, where f is linear.
function clip(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const A = poly[i];
    const B = poly[(i + 1) % poly.length];
    const fa = f(A.p[0], A.p[2]);
    const fb = f(B.p[0], B.p[2]);
    if (fa >= 0) out.push(A);
    if ((fa >= 0) !== (fb >= 0)) {
      const k = fa / (fa - fb);
      const p = [A.p[0] + (B.p[0] - A.p[0]) * k, A.p[1] + (B.p[1] - A.p[1]) * k, A.p[2] + (B.p[2] - A.p[2]) * k];
      const a = {};
      for (const name in A.a) a[name] = A.a[name].map((v, n) => v + (B.a[name][n] - v) * k);
      out.push({ p, a });
    }
  }
  return out;
}

function area3(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

// Returns a new mesh: each triangle cut on the terrain triangles, and each
// vertex moved up by the terrain height under it. The colors, the facade
// attribute, and the uvs are kept (interpolated on the cut edges).
export function drapeMesh(mesh, terrain) {
  if (terrain.flat) return mesh;
  const { cell, x0, z0 } = terrain;
  const P = mesh.positions;
  const names = ATTRS.filter(([n]) => mesh[n]);
  const out = { positions: [], indices: [] };
  for (const [n] of names) out[n] = [];
  const vert = (k) => {
    const a = {};
    for (const [n, size] of names) a[n] = Array.from(mesh[n].slice(k * size, k * size + size));
    return { p: [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]], a };
  };
  // Shared vertices are welded (same position and attributes, to 0.1 mm),
  // so a draped mesh keeps about one vertex per corner. Only the faces of one
  // orientation weld (`facing`, from the flat triangle): the terrain gets
  // smooth normals, and a curb keeps a hard edge between its top and side.
  const welded = new Map();
  let facing = "";
  const vertexIndex = (V) => {
    let key = `${facing}:${Math.round(V.p[0] * 1e4)},${Math.round(V.p[1] * 1e4)},${Math.round(V.p[2] * 1e4)}`;
    for (const [n] of names) key += `|${V.a[n].map((v) => Math.round(v * 1e4)).join(",")}`;
    let k = welded.get(key);
    if (k === undefined) {
      k = out.positions.length / 3;
      welded.set(key, k);
      out.positions.push(V.p[0], V.p[1], V.p[2]);
      for (const [n] of names) out[n].push(...V.a[n]);
    }
    return k;
  };
  const I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    const tri = [vert(I[t]), vert(I[t + 1]), vert(I[t + 2])];
    {
      const [a, b, c] = tri.map((v) => v.p);
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      facing = `${Math.round((nx / l) * 4)},${Math.round((ny / l) * 4)},${Math.round((nz / l) * 4)}`;
    }
    const xs = tri.map((v) => v.p[0]);
    const zs = tri.map((v) => v.p[2]);
    const i0 = Math.floor((Math.min(...xs) - x0) / cell);
    const i1 = Math.floor((Math.max(...xs) - x0) / cell);
    const j0 = Math.floor((Math.min(...zs) - z0) / cell);
    const j1 = Math.floor((Math.max(...zs) - z0) / cell);
    // A triangle with a position that is not finite has no cells. Without
    // this check an infinite range makes the cell loop run without end.
    if (![i0, i1, j0, j1].every(Number.isFinite)) continue;
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const cx = x0 + i * cell;
        const cz = z0 + j * cell;
        const u = (x) => (x - cx) / cell;
        const v = (z) => (z - cz) / cell;
        let cellPoly = clip(clip(clip(clip(tri, (x) => u(x)), (x) => 1 - u(x)), (x, z) => v(z)), (x, z) => 1 - v(z));
        if (cellPoly.length < 3) continue;
        for (const half of [(x, z) => 1 - u(x) - v(z), (x, z) => u(x) + v(z) - 1]) {
          const poly = clip(cellPoly, half);
          if (poly.length < 3) continue;
          const moved = poly.map(({ p, a }) => ({ p: [p[0], p[1] + terrain.height(p[0], p[2]), p[2]], a }));
          for (let k = 1; k < moved.length - 1; k += 1) {
            const A = moved[0];
            const B = moved[k];
            const C = moved[k + 1];
            if (area3(A.p, B.p, C.p) < 1e-6) continue;
            for (const V of [A, B, C]) out.indices.push(vertexIndex(V));
          }
        }
        cellPoly = null;
      }
    }
  }
  const res = { positions: Float32Array.from(out.positions), indices: Uint32Array.from(out.indices) };
  for (const [n] of names) res[n] = Float32Array.from(out[n]);
  return res;
}

// Moves every vertex of a mesh up by `dy(x, z)` (for a mesh that must not be
// cut, for example a bridge deck that follows its own line).
export function liftMesh(mesh, dy) {
  const P = Float32Array.from(mesh.positions);
  for (let i = 0; i < P.length; i += 3) P[i + 1] += dy(P[i], P[i + 2]);
  return { ...mesh, positions: P };
}
