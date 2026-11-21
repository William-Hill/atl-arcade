// The level edge fence (#229). Pure: no Three.js, no DOM.
//
// A geodata level stops at its bounds: past them the ground sampler returns
// null, the skater falls, and the controller sends it back to the spawn.
// The fence is a construction fence a short distance inside the bounds, on
// all four sides. For the controller it is a wall: a band, `thickness` m
// wide, with its top `height` m above the ground under it, or above the
// skater when the skater is higher. A rise above maxStep is a wall, so the
// skater slides along the fence or stops at it, and a skater that falls off
// a roof near the edge cannot fly over it. The render shows a fence
// `height` m tall. The out-of-bounds respawn stays as the backstop
// (src/sim/skate/controller.js).
//
// The political rules (AGENTS.md): construction fencing, not police tape or
// traffic barriers.

export const EDGE_FENCE = {
  inset: 3, // m from the bounds to the inner face of the fence. min 1 / typical 3 / max 10.
  thickness: 0.5, // m of the wall band. More than one step of a skater at top speed (12 m/s / 60 = 0.2 m). min 0.4 / typical 0.5 / max 1.
  height: 2.2, // m: the fence top above the ground (render), and the wall top above the skater (controller). More than maxStep. min 1.5 / typical 2.2 / max 3.
  panel: 3.5, // m between two posts (render only).
  hint: 5, // m from the fence at which the HUD shows the edge hint. min 2 / typical 5 / max 10.
};

export const EDGE_FENCE_ID = "edge-fence";

// The fence of a level: its inner face as a rectangle, plus the band size.
// Returns null when the bounds are too small for a fence.
export function edgeFence(bounds, k = EDGE_FENCE) {
  const fence = {
    minX: bounds.minX + k.inset,
    maxX: bounds.maxX - k.inset,
    minZ: bounds.minZ + k.inset,
    maxZ: bounds.maxZ - k.inset,
    thickness: k.thickness,
    height: k.height,
  };
  if (!(fence.maxX - fence.minX > 0) || !(fence.maxZ - fence.minZ > 0)) return null;
  return fence;
}

// The distance from (x, z) to the inner face of the fence. Positive inside
// the fenced area, negative past the inner face.
export function fenceDistance(fence, x, z) {
  return Math.min(x - fence.minX, fence.maxX - x, z - fence.minZ, fence.maxZ - z);
}

// The distance along the ray from `from` to `to` (3D points, [x, y, z]) at
// which the ray crosses the inner face of the fence, or Infinity when it
// stays inside. The follow camera adds this to its wall ray: the fence has
// no physics collider, and past the bounds there is no ground to show. The
// fence height does not count, so the camera stays inside the inner face
// even above the fence top. A `from` on or past the inner face gives
// Infinity: a hit at 0 would put the camera on the skater.
export function fenceRayDistance(fence, from, to) {
  if (!fence || !(fenceDistance(fence, from[0], from[2]) > 0)) return Infinity;
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (fence.maxX - from[0]) / dx);
  else if (dx < 0) t = Math.min(t, (fence.minX - from[0]) / dx);
  if (dz > 0) t = Math.min(t, (fence.maxZ - from[2]) / dz);
  else if (dz < 0) t = Math.min(t, (fence.minZ - from[2]) / dz);
  if (!(t < 1)) return Infinity;
  return t * Math.hypot(dx, to[1] - from[1], dz);
}

// True when (x, z) is in the wall band of the fence.
export function inFence(fence, x, z) {
  const d = fenceDistance(fence, x, z);
  return d <= 0 && d > -fence.thickness;
}

// A ground sampler with the fence: in the band, a wall. Everywhere else, the
// sampler as it was. The wall top is `height` m above the ground under it,
// or above the height `y` of the query when that is higher. The controller
// gives `y` (the skater height) on each sample, so the wall is always
// taller than a step and a skater never lands on top of it. A sample with
// no `y` gets the fence top. A sampler user that is not the skater (the
// photo camera floor) must skip a sample with the id EDGE_FENCE_ID.
export function withEdgeFence(sampleGround, fence) {
  if (!fence) return sampleGround;
  const UP = [0, 1, 0];
  const sample = function sampleWithFence(x, z, y) {
    if (!inFence(fence, x, z)) return sampleGround(x, z, y);
    const ground = sampleGround(x, z, y)?.height ?? 0;
    const from = Number.isFinite(y) ? Math.max(ground, y) : ground;
    return { height: from + fence.height, normal: UP, id: EDGE_FENCE_ID };
  };
  sample.cellCount = sampleGround.cellCount;
  sample.shapeCount = sampleGround.shapeCount;
  return sample;
}

// True when the skater at (x, z) is near the fence: the HUD then shows the
// edge hint.
export function nearEdge(fence, x, z, distance = EDGE_FENCE.hint) {
  if (!fence) return false;
  return fenceDistance(fence, x, z) < distance;
}

// The fence line for the render: the middle of the wall band, as one closed
// rectangle cut into panels of about `panel` m. Returns the posts in order
// around the rectangle, [[x, z], ...], with the first corner again at the end.
export function fencePosts(fence, panel = EDGE_FENCE.panel) {
  const o = fence.thickness / 2;
  const corners = [
    [fence.minX - o, fence.minZ - o],
    [fence.maxX + o, fence.minZ - o],
    [fence.maxX + o, fence.maxZ + o],
    [fence.minX - o, fence.maxZ + o],
  ];
  const posts = [];
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / panel));
    for (let j = 0; j < n; j += 1) posts.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  posts.push([...corners[0]]);
  return posts;
}

// Pure: the grindables cut to the fenced area, `margin` m inside the inner
// face of the fence. A grind does not sample the ground, so a curb ledge
// that crosses the fence line would carry the skater through the fence. A
// cut grind ends before the fence; the skater then leaves the ledge and the
// fence wall stops it. A grindable cut in two parts becomes two grindables
// (ids ":a", ":b", ...). A part shorter than `minLength` m is dropped.
export function clipGrindables(grindables, fence, { margin = 1, minLength = 1 } = {}) {
  if (!fence) return grindables;
  const r = { minX: fence.minX + margin, maxX: fence.maxX - margin, minZ: fence.minZ + margin, maxZ: fence.maxZ - margin };
  const inside = ([x, , z]) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
  const out = [];
  for (const g of grindables) {
    if (g.points.every(inside)) {
      out.push(g);
      continue;
    }
    const runs = [];
    let run = null;
    for (let i = 0; i < g.points.length - 1; i += 1) {
      const part = clipSegment(g.points[i], g.points[i + 1], r);
      if (!part) {
        run = null;
        continue;
      }
      const [a, b] = part;
      const startsHere = a !== g.points[i];
      if (!run || startsHere) {
        run = [a];
        runs.push(run);
      }
      run.push(b);
      if (b !== g.points[i + 1]) run = null;
    }
    const kept = runs.filter((pts) => lineLength(pts) >= minLength);
    kept.forEach((pts, k) => {
      const id = kept.length === 1 ? g.id : `${g.id}:${String.fromCharCode(97 + k)}`;
      out.push({ ...g, id, points: pts, total: lineLength(pts), ...(g.box ? { box: lineBox(pts) } : {}) });
    });
  }
  return out;
}

// Liang-Barsky in the ground plane. Returns [a, b] (the input point objects
// where an end is not cut), or null when the segment is outside.
function clipSegment(p, q, r) {
  const dx = q[0] - p[0];
  const dz = q[2] - p[2];
  let t0 = 0;
  let t1 = 1;
  for (const [den, num] of [[-dx, p[0] - r.minX], [dx, r.maxX - p[0]], [-dz, p[2] - r.minZ], [dz, r.maxZ - p[2]]]) {
    if (den === 0) {
      if (num < 0) return null;
      continue;
    }
    const t = num / den;
    if (den < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  const at = (t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  return [t0 === 0 ? p : at(t0), t1 === 1 ? q : at(t1)];
}

function lineLength(points) {
  let s = 0;
  for (let i = 0; i < points.length - 1; i += 1) s += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1], points[i + 1][2] - points[i][2]);
  return s;
}

function lineBox(points) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const [x, , z] of points) {
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minZ = Math.min(b.minZ, z);
    b.maxZ = Math.max(b.maxZ, z);
  }
  return b;
}
