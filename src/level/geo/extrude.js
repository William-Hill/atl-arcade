// Mesh builders for geodata levels. Pure: plain arrays in, plain arrays out.
// No Three.js and no Rapier, so the render and the physics use the same
// triangles, and Vitest can check them.
//
// Every 2D point is [x, z] in level meters (+x east, +z south). Every mesh is
// { positions: number[] (x, y, z), indices: number[], colors?: number[] }.
// Faces do not share vertices across a corner, so a flat-shaded or toon
// material gets one normal per face.

import earcut from "earcut";

// Signed area in the x-z plane. Positive is counterclockwise when x points
// right and z points down the page.
export function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

// Removes a closing point that repeats the first point, and repeated points.
export function cleanRing(ring) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-6 || Math.abs(q[1] - p[1]) > 1e-6) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) <= 1e-6 && Math.abs(a[1] - b[1]) <= 1e-6) out.pop();
  }
  return out;
}

// Gives a ring the winding that makes the wall normals point out of the
// solid: negative signed area for an outer ring, positive for a hole.
function orient(ring, hole) {
  const r = cleanRing(ring);
  const a = signedArea(r);
  return (hole ? a < 0 : a > 0) ? r.slice().reverse() : r;
}

function emptyMesh(withColors) {
  return withColors ? { positions: [], indices: [], colors: [] } : { positions: [], indices: [] };
}

function pushVertex(mesh, x, y, z, color) {
  mesh.positions.push(x, y, z);
  if (mesh.colors) mesh.colors.push(color[0], color[1], color[2]);
  return mesh.positions.length / 3 - 1;
}

// Adds a triangle so that its normal has a positive y.
function pushUpTriangle(mesh, a, b, c) {
  const p = mesh.positions;
  const ax = p[a * 3];
  const az = p[a * 3 + 2];
  const ny = (p[b * 3 + 2] - az) * (p[c * 3] - ax) - (p[b * 3] - ax) * (p[c * 3 + 2] - az);
  if (ny >= 0) mesh.indices.push(a, b, c);
  else mesh.indices.push(a, c, b);
}

// A flat polygon at height y, normal up. `holes` is a list of rings.
export function flatPolygon(outer, holes = [], y = 0, { color = null, mesh = null } = {}) {
  const m = mesh ?? emptyMesh(Boolean(color));
  const rings = [cleanRing(outer), ...holes.map(cleanRing)].filter((r) => r.length >= 3);
  if (rings.length === 0 || rings[0].length < 3) return m;
  const flat = [];
  const holeIndex = [];
  for (let i = 0; i < rings.length; i += 1) {
    if (i > 0) holeIndex.push(flat.length / 2);
    for (const [x, z] of rings[i]) flat.push(x, z);
  }
  const base = m.positions.length / 3;
  for (let i = 0; i < flat.length; i += 2) pushVertex(m, flat[i], y, flat[i + 1], color);
  const tris = earcut(flat, holeIndex, 2);
  for (let i = 0; i < tris.length; i += 3) pushUpTriangle(m, base + tris[i], base + tris[i + 1], base + tris[i + 2]);
  return m;
}

// Vertical walls along a ring from y0 to y1. Normals point out of the solid
// for an outer ring and into the hole for a hole.
function walls(m, ring, y0, y1, color) {
  for (let i = 0; i < ring.length; i += 1) {
    const [px, pz] = ring[i];
    const [qx, qz] = ring[(i + 1) % ring.length];
    const a = pushVertex(m, px, y0, pz, color);
    const b = pushVertex(m, qx, y0, qz, color);
    const c = pushVertex(m, qx, y1, qz, color);
    const d = pushVertex(m, px, y1, pz, color);
    m.indices.push(a, b, d, b, c, d);
  }
}

// A building: walls from `base` to `top` and a flat roof. The roof can have
// its own color.
export function extrudeFootprint({ outer, holes = [], base = 0, top }, { color = null, roofColor = null, mesh = null } = {}) {
  const m = mesh ?? emptyMesh(Boolean(color));
  const o = orient(outer, false);
  if (o.length < 3 || !(top > base)) return m;
  const hs = holes.map((h) => orient(h, true)).filter((h) => h.length >= 3);
  walls(m, o, base, top, color);
  for (const h of hs) walls(m, h, base, top, color);
  flatPolygon(o, hs, top, { color: roofColor ?? color, mesh: m });
  return m;
}

// A ribbon of `width` along a polyline at height `top`, with a disk at each
// inner joint so turns have no gap. With `curb` it also gets side walls down
// to `bottom` (a raised sidewalk).
export function stripMesh(points, width, top, { bottom = 0, curb = false, color = null, mesh = null, jointSides = 8 } = {}) {
  const m = mesh ?? emptyMesh(Boolean(color));
  const r = width / 2;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const nx = (-dz / len) * r;
    const nz = (dx / len) * r;
    const quad = [
      [ax + nx, az + nz],
      [bx + nx, bz + nz],
      [bx - nx, bz - nz],
      [ax - nx, az - nz],
    ];
    const v = quad.map(([x, z]) => pushVertex(m, x, top, z, color));
    pushUpTriangle(m, v[0], v[1], v[2]);
    pushUpTriangle(m, v[0], v[2], v[3]);
    if (curb && top > bottom) {
      // Each side as an outward wall: the quad order gives one side each way.
      walls(m, orient(quad, false), bottom, top, color);
    }
  }
  for (let i = 1; i < points.length - 1; i += 1) {
    const [cx, cz] = points[i];
    const ring = [];
    for (let k = 0; k < jointSides; k += 1) {
      const t = (k / jointSides) * Math.PI * 2;
      ring.push([cx + Math.cos(t) * r, cz + Math.sin(t) * r]);
    }
    flatPolygon(ring, [], top, { color, mesh: m });
  }
  return m;
}

// Joins meshes into one. Colors are kept only when every part has them.
export function mergeMeshes(meshes) {
  const withColors = meshes.length > 0 && meshes.every((x) => x.colors);
  let vertexCount = 0;
  let indexCount = 0;
  for (const x of meshes) {
    vertexCount += x.positions.length / 3;
    indexCount += x.indices.length;
  }
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  const colors = withColors ? new Float32Array(vertexCount * 3) : null;
  let vo = 0;
  let io = 0;
  for (const x of meshes) {
    positions.set(x.positions, vo * 3);
    if (colors) colors.set(x.colors, vo * 3);
    for (let i = 0; i < x.indices.length; i += 1) indices[io + i] = x.indices[i] + vo;
    vo += x.positions.length / 3;
    io += x.indices.length;
  }
  return colors ? { positions, indices, colors } : { positions, indices };
}
