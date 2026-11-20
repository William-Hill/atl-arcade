// Skate features (assets/skate-features, scripts/blender/skate_features.py)
// placed in a level. Pure: plain arrays, no Three.js.
//
// A feature entry of assets/skate-features/features.json is in model space
// (the glTF frame: +y up, +z forward, origin at the ground center). A
// placement is { id, position: [x, y, z], yaw }: yaw turns the model about
// +y like Three.js `rotation.y` (the props convention in
// src/level/geo/props.js: yaw = atan2(vx, vz) turns the front, +z, toward
// (vx, vz)).
//
// featureLevelObjects() gives the grind edges as level objects with a
// `spline` ({ points }), which prepareGrindables() in src/sim/skate/grind.js
// takes as is. featureGround() gives the ground of the placed features (the
// solid boxes, ramp profiles, and polygons) as a sampler like
// src/level/ground.js.

export function rotateYaw(p, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

export function toWorld(p, placement) {
  const [x, y, z] = rotateYaw(p, placement.yaw ?? 0);
  const o = placement.position;
  return [x + o[0], y + o[1], z + o[2]];
}

export function toModel(x, z, placement) {
  const o = placement.position;
  const [mx, , mz] = rotateYaw([x - o[0], 0, z - o[2]], -(placement.yaw ?? 0));
  return [mx, mz];
}

// The grind edges of a placed feature, as level objects for prepareGrindables().
// Every edge is kind "rail" (the manifest kind is kept in `edge`), so
// createPhysicsWorld() gives each a thin capsule instead of throwing on a
// spline-only ledge/bench/coping object.
export function featureLevelObjects(feature, placement) {
  return feature.grind.map((e) => ({
    id: `${placement.id}:${e.id}`,
    kind: "rail",
    edge: e.kind,
    feature: placement.id,
    radius: e.radius,
    spline: { points: e.points.map((p) => toWorld(p, placement)) },
  }));
}

// The footprint of a placed feature: its four world corners [x, z].
export function featureFootprint(feature, placement) {
  const { min, max } = feature.footprint;
  return [
    [min[0], min[1]],
    [max[0], min[1]],
    [max[0], max[1]],
    [min[0], max[1]],
  ].map(([x, z]) => {
    const w = toWorld([x, 0, z], placement);
    return [w[0], w[2]];
  });
}

function profileAt(surface, mx, mz) {
  const [x0, x1] = surface.x;
  if (mx < x0 || mx > x1) return null;
  const pts = surface.points;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [za, ya] = pts[i];
    const [zb, yb] = pts[i + 1];
    if (mz > za || mz < zb || za === zb) continue;
    const t = (za - mz) / (za - zb);
    // Up-facing normal of the segment in model space (y, z plane).
    const dz = za - zb;
    const dy = yb - ya;
    const n = Math.hypot(dz, dy);
    return { height: ya + (yb - ya) * t, normal: [0, dz / n, dy / n] };
  }
  return null;
}

function polygonAt(surface, mx, mz) {
  const p = surface.points;
  // Inside test on the xz projection (convex polygon, either winding).
  let sign = 0;
  for (let i = 0; i < p.length; i += 1) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const cr = (b[0] - a[0]) * (mz - a[2]) - (b[2] - a[2]) * (mx - a[0]);
    if (Math.abs(cr) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(cr);
    else if (Math.sign(cr) !== sign) return null;
  }
  const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  let n = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  if (n[1] < 0) n = n.map((c) => -c);
  const len = Math.hypot(n[0], n[1], n[2]);
  n = n.map((c) => c / len);
  const height =
    p[0][1] - (n[0] * (mx - p[0][0]) + n[2] * (mz - p[0][2])) / n[1];
  return { height, normal: n };
}

// Height and normal of one placed feature at world (x, z), or null.
export function featureSurfaceAt(feature, placement, x, z) {
  const [mx, mz] = toModel(x, z, placement);
  let best = null;
  const take = (s, id) => {
    if (s && (!best || s.height > best.height)) best = { ...s, id };
  };
  for (const b of feature.solids) {
    const [cx, cy, cz] = b.center;
    const [sx, sy, sz] = b.size;
    if (Math.abs(mx - cx) <= sx / 2 && Math.abs(mz - cz) <= sz / 2)
      take({ height: cy + sy / 2, normal: [0, 1, 0] }, b.id);
  }
  for (const s of feature.surfaces)
    take(
      s.kind === "profile" ? profileAt(s, mx, mz) : polygonAt(s, mx, mz),
      s.id,
    );
  if (!best) return null;
  return {
    height: best.height + placement.position[1],
    normal: rotateYaw(best.normal, placement.yaw ?? 0),
    id: `${placement.id}:${best.id}`,
  };
}

// A ground sampler over placed features: placed = [{ feature, placement }].
// Returns (x, z) => { height, normal, id } | null, the highest surface.
export function featureGround(placed) {
  const items = placed.map(({ feature, placement }) => {
    const fp = featureFootprint(feature, placement);
    const xs = fp.map((p) => p[0]);
    const zs = fp.map((p) => p[1]);
    return {
      feature,
      placement,
      box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)],
    };
  });
  return function sampleFeatures(x, z) {
    let best = null;
    for (const it of items) {
      const [x0, x1, z0, z1] = it.box;
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      const s = featureSurfaceAt(it.feature, it.placement, x, z);
      if (s && (!best || s.height > best.height)) best = s;
    }
    return best;
  };
}
