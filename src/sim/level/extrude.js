// Turn a closed 2D outline into a solid triangle soup, extruded along Z and
// centred on it. Pure. The Three.js mesh and the Rapier trimesh are both built
// from this, so the ramp you see and the ramp you hit are the same triangles.
//
// Triangles are emitted un-indexed (three fresh vertices each) so the caps and
// the side walls keep their own normals and the lip stays a crease.
//
// Contract: the caps are fanned from the LAST point of the outline, so the
// outline must be star-shaped about that point. `quarterPipeOutline` ends at
// the bottom-back corner for exactly this reason.

export function signedArea(outline) {
  let sum = 0;
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function extrudeOutline(outline, depth) {
  if (!Array.isArray(outline) || outline.length < 3) {
    throw new Error("extrude: an outline needs at least three points");
  }
  if (!(depth > 0)) throw new Error("extrude: depth must be positive");

  // Work counter-clockwise so the front cap faces +Z and the walls face out.
  // Reversing to fix the winding must not move the fan hub: for a quarter-pipe
  // the outline is clockwise, and fanning from the roll-in origin instead of
  // the bottom-back corner covers the whole diagonal wedge with one triangle
  // and then subtracts it again with back-facing ones. The region under a
  // convex transition is not star-shaped about its origin.
  const ccw = signedArea(outline) >= 0;
  const loop = ccw ? [...outline] : [...outline].reverse();
  const hub = ccw ? loop.length - 1 : 0;
  const half = depth / 2;
  const positions = [];

  const push = (p, z) => positions.push(p.x, p.y, z);
  const triangle = (a, az, b, bz, c, cz) => {
    push(a, az);
    push(b, bz);
    push(c, cz);
  };

  // Caps, fanned from the hub, walking counter-clockwise around the loop.
  const count = loop.length;
  const cap = [];
  for (let k = 1; k <= count - 2; k += 1) {
    const i = (hub + k) % count;
    const j = (hub + k + 1) % count;
    cap.push([loop[hub], loop[i], loop[j]]);
  }

  // A fan is only valid from a point the whole outline can see. When it is
  // not, some triangles come out wound the other way and the cap covers
  // itself. Catching that here turns a silently corrupt ramp into a crash.
  if (hasMixedWinding(cap)) {
    throw new Error("extrude: the outline is not star-shaped about its last point, so its cap cannot be fanned");
  }

  for (const [a, b, c] of cap) {
    triangle(a, half, b, half, c, half);
    triangle(a, -half, c, -half, b, -half);
  }

  // Side walls.
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    triangle(a, half, a, -half, b, -half);
    triangle(a, half, b, -half, b, half);
  }

  const vertices = Float32Array.from(positions);
  const indices = Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  return { vertices, indices, triangleCount: indices.length / 3 };
}

function triangleArea2d([a, b, c]) {
  return ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

function hasMixedWinding(triangles, epsilon = 1e-12) {
  let positive = false;
  let negative = false;
  for (const tri of triangles) {
    const area = triangleArea2d(tri);
    if (area > epsilon) positive = true;
    else if (area < -epsilon) negative = true;
  }
  return positive && negative;
}
