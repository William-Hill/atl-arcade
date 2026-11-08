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
