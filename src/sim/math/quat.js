// Quaternions as plain {x, y, z, w}. Pure, so the same rotation feeds the
// Three.js mesh and the Rapier collider without either library in scope.

import { cross, dot, normalize } from "./vec3.js";

export const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export function quatFromAxisAngle(axis, angle) {
  const unit = normalize(axis);
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: unit.x * s, y: unit.y * s, z: unit.z * s, w: Math.cos(half) };
}

export const quatFromYaw = (yaw) => quatFromAxisAngle({ x: 0, y: 1, z: 0 }, yaw);

// Shortest rotation taking one unit vector onto another.
export function quatFromUnitVectors(from, to) {
  const a = normalize(from);
  const b = normalize(to);
  const r = dot(a, b) + 1;

  if (r < 1e-9) {
    // Opposite vectors: any perpendicular axis will do, so pick a stable one.
    const axis = Math.abs(a.x) > Math.abs(a.z) ? { x: -a.y, y: a.x, z: 0 } : { x: 0, y: -a.z, z: a.y };
    return quatFromAxisAngle(axis, Math.PI);
  }

  const axis = cross(a, b);
  const q = { x: axis.x, y: axis.y, z: axis.z, w: r };
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

export function rotateVector(q, v) {
  // v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
  const u = { x: q.x, y: q.y, z: q.z };
  const t = cross(u, { x: v.x + 0, y: v.y, z: v.z });
  const inner = { x: t.x + q.w * v.x, y: t.y + q.w * v.y, z: t.z + q.w * v.z };
  const outer = cross(u, inner);
  return { x: v.x + 2 * outer.x, y: v.y + 2 * outer.y, z: v.z + 2 * outer.z };
}
