// Rapier static collision world built from level data. This file knows Rapier
// and plain arrays; it never imports Three.js and the simulation never
// imports it.

import RAPIER from "@dimforge/rapier3d-compat";
import { rampMesh } from "../level/ramp.js";
import { sampleSpline, sub, length } from "../level/splines.js";
import { buildGeoMeshes } from "../level/geo/geo-mesh.js";

// Collision groups (membership bits). The character controller and camera
// rays pick which ones they see.
export const GROUP = { ground: 0x0001, wall: 0x0002, rail: 0x0004, ledge: 0x0008 };
export const ALL_GROUPS = 0xffff;

const KIND_GROUP = {
  ground: GROUP.ground,
  ramp: GROUP.ground,
  ledge: GROUP.ledge,
  rail: GROUP.rail,
  building: GROUP.wall,
  barrier: GROUP.wall,
};

let rapierReady = null;

export function initPhysics() {
  if (!rapierReady) rapierReady = RAPIER.init().then(() => RAPIER);
  return rapierReady;
}

// Rapier packs membership in the high 16 bits and the filter in the low 16.
export function collisionGroups(membership, filter = ALL_GROUPS) {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

// Quaternion that rotates +y onto `dir` (unit vector), as [x, y, z, w].
export function quaternionFromY(dir) {
  const up = [0, 1, 0];
  const d = Math.min(Math.max(up[0] * dir[0] + up[1] * dir[1] + up[2] * dir[2], -1), 1);
  if (d > 1 - 1e-9) return [0, 0, 0, 1];
  if (d < -1 + 1e-9) return [1, 0, 0, 0];
  const axis = [up[1] * dir[2] - up[2] * dir[1], up[2] * dir[0] - up[0] * dir[2], up[0] * dir[1] - up[1] * dir[0]];
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  const angle = Math.acos(d);
  const s = Math.sin(angle / 2) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

export function isGeoLevel(level) {
  return typeof level.format === "string" && level.format.startsWith("geo-level/");
}

// A geodata level gets one static trimesh per merged mesh: the surfaces in
// the ground group and the buildings in the wall group. Pass `geoMeshes` to
// reuse the meshes that the render built.
export function createPhysicsWorld(R, level, { geoMeshes = null } = {}) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  const colliders = new Map();

  if (isGeoLevel(level)) {
    for (const { material, tile, mesh } of geoMeshes ?? buildGeoMeshes(level)) {
      // Murals sit 8 cm off a wall that already has a collider.
      if (material === "mural") continue;
      const group = collisionGroups(material === "building" ? GROUP.wall : GROUP.ground);
      const positions = mesh.positions instanceof Float32Array ? mesh.positions : new Float32Array(mesh.positions);
      const indices = mesh.indices instanceof Uint32Array ? mesh.indices : new Uint32Array(mesh.indices);
      const desc = R.ColliderDesc.trimesh(positions, indices).setCollisionGroups(group);
      colliders.set(`${material}-${tile}`, [world.createCollider(desc)]);
    }
  }

  for (const o of level.objects) {
    const group = collisionGroups(KIND_GROUP[o.kind] ?? GROUP.ground);
    const made = [];
    if (o.size) {
      const desc = R.ColliderDesc.cuboid(o.size[0] / 2, o.size[1] / 2, o.size[2] / 2)
        .setTranslation(o.position[0], o.position[1], o.position[2])
        .setCollisionGroups(group);
      made.push(world.createCollider(desc));
    } else if (o.kind === "rail") {
      const pts = sampleSpline(o.spline, 8);
      for (let i = 0; i < pts.length - 1; i += 1) {
        const a = pts[i];
        const b = pts[i + 1];
        const seg = sub(b, a);
        const len = length(seg);
        if (len <= 0) continue;
        const dir = [seg[0] / len, seg[1] / len, seg[2] / len];
        const q = quaternionFromY(dir);
        const desc = R.ColliderDesc.capsule(len / 2, o.radius ?? 0.05)
          .setTranslation((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
          .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
          .setCollisionGroups(group);
        made.push(world.createCollider(desc));
      }
    } else if (o.kind === "ramp") {
      const mesh = rampMesh(o, 12);
      const desc = R.ColliderDesc.trimesh(mesh.positions, mesh.indices).setCollisionGroups(group);
      made.push(world.createCollider(desc));
    } else {
      throw new Error(`physics: no collider rule for ${o.id} (${o.kind})`);
    }
    colliders.set(o.id, made);
  }

  let colliderCount = 0;
  for (const list of colliders.values()) colliderCount += list.length;

  // Ray casts see nothing until the query pipeline is built. The world is
  // static, so one update is enough.
  if (typeof world.updateSceneQueries === "function") world.updateSceneQueries();
  else world.step();

  return { world, colliders, colliderCount };
}
