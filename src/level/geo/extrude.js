// Mesh builders for geodata levels. Pure: plain arrays in, plain arrays out.
// No Three.js and no Rapier, so the render and the physics use the same
// triangles, and Vitest can check them.
//
// Every 2D point is [x, z] in level meters (+x east, +z south). Every mesh is
// { positions: number[] (x, y, z), indices: number[], colors?: number[],
//   facade?: number[] }.
// `facade` has 4 numbers per vertex: [style, u, v, kind]. u counts window
// bays along a wall, v counts floors up a wall, and kind is FACE.roof,
// FACE.wall, or FACE.cornice. The facade shader draws windows from it.
// Faces do not share vertices across a corner, so a flat-shaded or toon
// material gets one normal per face.

import earcut from "earcut";

export const FACE = { roof: 0, wall: 1, cornice: 2 };
const NO_FACADE = [0, 0, 0, FACE.roof];

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
export function orientRing(ring, hole = false) {
  return orient(ring, hole);
}

function orient(ring, hole) {
  const r = cleanRing(ring);
  const a = signedArea(r);
  return (hole ? a < 0 : a > 0) ? r.slice().reverse() : r;
}

function emptyMesh(withColors, withFacade = false) {
  const m = withColors ? { positions: [], indices: [], colors: [] } : { positions: [], indices: [] };
  if (withFacade) m.facade = [];
  return m;
}

function pushVertex(mesh, x, y, z, color, facade = NO_FACADE) {
  mesh.positions.push(x, y, z);
  if (mesh.colors) mesh.colors.push(color[0], color[1], color[2]);
  if (mesh.facade) mesh.facade.push(facade[0], facade[1], facade[2], facade[3]);
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
export function flatPolygon(outer, holes = [], y = 0, { color = null, mesh = null, facade = NO_FACADE } = {}) {
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
  for (let i = 0; i < flat.length; i += 2) pushVertex(m, flat[i], y, flat[i + 1], color, facade);
  const tris = earcut(flat, holeIndex, 2);
  for (let i = 0; i < tris.length; i += 3) pushUpTriangle(m, base + tris[i], base + tris[i + 1], base + tris[i + 2]);
  return m;
}

// Vertical walls along a ring from y0 to y1. Normals point out of the solid
// for an outer ring and into the hole for a hole. With `facade`
// ({ style, bay, floors, kind }) each wall gets a whole number of window
// bays (at least 1) of about `bay` meters, and v runs 0 to `floors`.
function walls(m, ring, y0, y1, color, facade = null) {
  for (let i = 0; i < ring.length; i += 1) {
    const [px, pz] = ring[i];
    const [qx, qz] = ring[(i + 1) % ring.length];
    let fa = NO_FACADE;
    let fb = NO_FACADE;
    let fc = NO_FACADE;
    let fd = NO_FACADE;
    if (facade) {
      const len = Math.hypot(qx - px, qz - pz);
      const bays = Math.max(1, Math.round(len / facade.bay));
      const v0 = facade.v0 ?? 0;
      const v1 = facade.v1 ?? facade.floors;
      fa = [facade.style, 0, v0, facade.kind];
      fb = [facade.style, bays, v0, facade.kind];
      fc = [facade.style, bays, v1, facade.kind];
      fd = [facade.style, 0, v1, facade.kind];
    }
    const a = pushVertex(m, px, y0, pz, color, fa);
    const b = pushVertex(m, qx, y0, qz, color, fb);
    const c = pushVertex(m, qx, y1, qz, color, fc);
    const d = pushVertex(m, px, y1, pz, color, fd);
    m.indices.push(a, b, d, b, c, d);
  }
}

// A building: walls from `base` to `top` and a flat roof. The roof can have
// its own color.
//
// With `facade` ({ style, bay, floorHeight, parapet, corniceColor }) the
// mesh gets the facade attribute: the walls count bays and floors for the
// window shader, and a parapet of `parapet` meters rises above the roof
// with its outer face marked as cornice and an inner face.
export function extrudeFootprint({ outer, holes = [], base = 0, top }, { color = null, roofColor = null, mesh = null, facade = null } = {}) {
  const m = mesh ?? emptyMesh(Boolean(color), Boolean(facade));
  const o = orient(outer, false);
  if (o.length < 3 || !(top > base)) return m;
  const hs = holes.map((h) => orient(h, true)).filter((h) => h.length >= 3);
  if (facade) {
    const floors = Math.max(1, Math.round((top - base) / facade.floorHeight));
    const wall = { style: facade.style, bay: facade.bay, floors, kind: FACE.wall };
    walls(m, o, base, top, color, wall);
    for (const h of hs) walls(m, h, base, top, color, wall);
    const parapet = facade.parapet ?? 0;
    if (parapet > 0) {
      const trim = facade.corniceColor ?? color;
      const cornice = { style: facade.style, bay: facade.bay, floors: 1, kind: FACE.cornice };
      walls(m, o, top, top + parapet, trim, cornice);
      // The inner face of the parapet, seen from the roof.
      walls(m, o.slice().reverse(), top, top + parapet, trim, cornice);
    }
    flatPolygon(o, hs, top, { color: roofColor ?? color, mesh: m, facade: [facade.style, 0, 0, FACE.roof] });
    return m;
  }
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

// Joins meshes into one. Colors and the facade attribute are kept only
// when every part has them.
export function mergeMeshes(meshes) {
  const withColors = meshes.length > 0 && meshes.every((x) => x.colors);
  const withFacade = meshes.length > 0 && meshes.every((x) => x.facade);
  const withUvs = meshes.length > 0 && meshes.every((x) => x.uvs);
  let vertexCount = 0;
  let indexCount = 0;
  for (const x of meshes) {
    vertexCount += x.positions.length / 3;
    indexCount += x.indices.length;
  }
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  const colors = withColors ? new Float32Array(vertexCount * 3) : null;
  const facade = withFacade ? new Float32Array(vertexCount * 4) : null;
  const uvs = withUvs ? new Float32Array(vertexCount * 2) : null;
  let vo = 0;
  let io = 0;
  for (const x of meshes) {
    positions.set(x.positions, vo * 3);
    if (colors) colors.set(x.colors, vo * 3);
    if (facade) facade.set(x.facade, vo * 4);
    if (uvs) uvs.set(x.uvs, vo * 2);
    for (let i = 0; i < x.indices.length; i += 1) indices[io + i] = x.indices[i] + vo;
    vo += x.positions.length / 3;
    io += x.indices.length;
  }
  const out = { positions, indices };
  if (colors) out.colors = colors;
  if (facade) out.facade = facade;
  if (uvs) out.uvs = uvs;
  return out;
}

// Adds a template mesh (for example a kit prop) moved to (x, y, z), turned
// by `yaw` about +y, and scaled by `scale`. Pure. The template is
// { positions, indices, colors } with typed or plain arrays.
export function placeTemplate(mesh, template, { x = 0, y = 0, z = 0, yaw = 0, scale = 1 } = {}) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const base = mesh.positions.length / 3;
  const p = template.positions;
  for (let i = 0; i < p.length; i += 3) {
    const px = p[i] * scale;
    const pz = p[i + 2] * scale;
    // Positive yaw turns +x toward -z, the same as the skater yaw.
    mesh.positions.push(x + px * c + pz * s, y + p[i + 1] * scale, z - px * s + pz * c);
    if (mesh.colors) {
      const k = i;
      mesh.colors.push(template.colors ? template.colors[k] : 1, template.colors ? template.colors[k + 1] : 1, template.colors ? template.colors[k + 2] : 1);
    }
  }
  for (const i of template.indices) mesh.indices.push(base + i);
  return mesh;
}
