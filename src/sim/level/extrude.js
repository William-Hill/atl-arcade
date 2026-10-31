// Turn a closed 2D outline into a solid triangle soup, extruded along Z and
// centred on it. Pure. The Three.js mesh and the Rapier trimesh are both built
// from this, so the ramp you see and the ramp you hit are the same triangles.
//
// Triangles are emitted un-indexed (three fresh vertices each) so the caps and
// the side walls keep their own normals and the lip stays a crease.

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
  const loop = signedArea(outline) < 0 ? [...outline].reverse() : [...outline];
  const half = depth / 2;
  const positions = [];

  const push = (p, z) => positions.push(p.x, p.y, z);
  const triangle = (a, az, b, bz, c, cz) => {
    push(a, az);
    push(b, bz);
    push(c, cz);
  };

  // Caps, fanned from the last point. Every outline this project extrudes is
  // star-shaped about it, which is what a fan needs.
  const hub = loop[loop.length - 1];
  for (let i = 0; i < loop.length - 2; i += 1) {
    triangle(hub, half, loop[i], half, loop[i + 1], half);
    triangle(hub, -half, loop[i + 1], -half, loop[i], -half);
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
