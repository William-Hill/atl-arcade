// Quarter-pipe geometry. Pure: plain arrays, shared by the renderer (Three.js
// BufferGeometry) and physics (Rapier trimesh).
//
// A ramp object has `position` = [x0, y0, z0] (the flat lip, at ground),
// `radius` (the transition radius, also its height), `width` (along z), and
// `direction` (+1: the wall is at x0 + radius, the skater rides +x into it;
// -1: mirrored). The profile is a quarter circle with its center at
// (x0, y0 + radius): height(x) = radius - sqrt(radius^2 - (x - x0)^2).

export function rampProfile(ramp, segments = 12) {
  const pts = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = (Math.PI / 2) * (i / segments);
    const u = Math.sin(a) * ramp.radius; // along the ride direction
    const y = ramp.radius - Math.cos(a) * ramp.radius;
    pts.push([u, y]);
  }
  return pts;
}

// Height and surface normal at a point, or null when (x, z) is off the ramp.
export function rampSurface(ramp, x, z) {
  const [x0, y0, z0] = ramp.position;
  const half = ramp.width / 2;
  if (z < z0 - half || z > z0 + half) return null;
  const u = (x - x0) * ramp.direction;
  if (u < 0 || u > ramp.radius) return null;
  const r = ramp.radius;
  const y = y0 + r - Math.sqrt(Math.max(r * r - u * u, 0));
  // Normal points from the surface toward the circle center.
  const nx = (-u / r) * ramp.direction;
  const ny = Math.sqrt(Math.max(r * r - u * u, 0)) / r;
  return { height: y, normal: [nx, ny, 0] };
}

// Triangle mesh for the ramp: the curved face, the two side caps, and the
// back wall. Returns { positions: Float32Array, indices: Uint32Array }.
export function rampMesh(ramp, segments = 12) {
  const [x0, y0, z0] = ramp.position;
  const half = ramp.width / 2;
  const d = ramp.direction;
  const profile = rampProfile(ramp, segments);
  const positions = [];
  const indices = [];
  const push = (x, y, z) => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };

  // Curved face: two rows (near z, far z).
  const near = profile.map(([u, y]) => push(x0 + u * d, y0 + y, z0 - half));
  const far = profile.map(([u, y]) => push(x0 + u * d, y0 + y, z0 + half));
  for (let i = 0; i < segments; i += 1) {
    indices.push(near[i], far[i], near[i + 1], near[i + 1], far[i], far[i + 1]);
  }

  // Side caps: fans from the bottom back corner.
  for (const z of [z0 - half, z0 + half]) {
    const corner = push(x0 + ramp.radius * d, y0, z);
    const ring = profile.map(([u, y]) => push(x0 + u * d, y0 + y, z));
    for (let i = 0; i < segments; i += 1) indices.push(corner, ring[i], ring[i + 1]);
  }

  // Back wall.
  const bx = x0 + ramp.radius * d;
  const b0 = push(bx, y0, z0 - half);
  const b1 = push(bx, y0, z0 + half);
  const b2 = push(bx, y0 + ramp.radius, z0 + half);
  const b3 = push(bx, y0 + ramp.radius, z0 - half);
  indices.push(b0, b1, b2, b0, b2, b3);

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
