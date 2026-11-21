import * as THREE from "three";
import { SHADOW_STAND_INS, enableShadowStandIns } from "./skin-merge.js";

// The sun shadow map pass (#188). It wraps renderer.shadowMap.render:
//
// - The shadow stand-ins (src/render/skin-merge.js) show only while the map
//   draws: one merged caster per skater in place of its 22 to 26 parts.
// - A caster whose shadow cannot reach the view draws no shadow (and the
//   same for each instance of a batch: the props, the cars). Its shadow
//   volume is its bounding sphere swept along the sun direction, down to
//   SHADOW_DROP meters under it. When that capsule is outside one plane of
//   the camera frustum, no visible pixel can be in its shadow. The shadow
//   box (140 m around the skater) holds the casters behind the camera too,
//   such as the people and the NPC skaters there.
//
// The picture does not change: a culled caster's shadow was off screen.

// How far under a caster its shadow may still land (m): a person on a
// bridge over the trail (the BeltLine bridges are 6 to 9 m over it), a
// skater at the top of a stair.
export const SHADOW_DROP = 15;

// Added to a caster's radius (m): the soft shadow filter reaches a few
// texels (3.4 cm each on the 4096 px, 140 m map) past the shadow's edge.
export const SHADOW_MARGIN = 1;

// The casters are listed again after this many shadow passes, so the NPC
// skaters and the people that load later join.
const RELIST = 30;

// Pure: true when a sphere (center c, radius r) swept from c along the unit
// direction `dir` for `length` meters is on the outside of one of the
// frustum planes ({ normal, constant }, normal inward as in THREE.Frustum).
export function capsuleOutside(c, r, dir, length, planes) {
  const ex = c.x + dir.x * length;
  const ey = c.y + dir.y * length;
  const ez = c.z + dir.z * length;
  for (const p of planes) {
    const n = p.normal;
    const d0 = n.x * c.x + n.y * c.y + n.z * c.z + p.constant;
    const d1 = n.x * ex + n.y * ey + n.z * ez + p.constant;
    if (d0 < -r && d1 < -r) return true;
  }
  return false;
}

// Pure: the length of a shadow volume: down to SHADOW_DROP under the
// sphere's bottom. Null when the light does not point down.
export function shadowLength(radius, dirY, drop = SHADOW_DROP) {
  if (!(dirY < -0.05)) return null;
  return (2 * radius + drop) / -dirY;
}

// A caster the cull may skip: a mesh that casts a shadow and has a bounding
// sphere for itself (not a batch nor an instanced mesh, whose sphere holds
// every instance).
function cullable(o) {
  return o.isMesh && o.castShadow && o.frustumCulled && !o.isBatchedMesh && !o.isInstancedMesh;
}

export function createShadowPass(renderer, { cull = true } = {}) {
  const shadowMap = renderer.shadowMap;
  const draw = shadowMap.render;
  const frustum = new THREE.Frustum();
  const m = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const dir = new THREE.Vector3();
  const a = new THREE.Vector3();
  let casters = [];
  let passes = 0;
  const off = [];
  const shown = [];
  const info = { casters: 0, culled: 0, culledInstances: 0, standIns: 0 };
  // From now on, a skater's parts may cast through one stand-in.
  enableShadowStandIns();

  // The sun and the view planes of the shadow pass running now, for the
  // batches; null outside a pass or with no cull.
  let current = null;

  // A batch (the props, the cars) culls each instance against the shadow
  // camera while it builds its draw list (BatchedMesh.onBeforeShadow). Here
  // an instance whose shadow cannot reach the view is hidden for that build.
  function wrapBatch(batch) {
    batch.userData.shadowCull = true;
    const before = batch.onBeforeShadow;
    const hidden = [];
    const box = new THREE.Sphere();
    const at = new THREE.Matrix4();
    batch.onBeforeShadow = function (...args) {
      if (current && batch.perObjectFrustumCulled) {
        for (let i = 0, n = batch._instanceInfo.length; i < n; i += 1) {
          const inst = batch._instanceInfo[i];
          if (!inst.active || !inst.visible) continue;
          batch.getBoundingSphereAt(inst.geometryIndex, box).applyMatrix4(batch.getMatrixAt(i, at)).applyMatrix4(batch.matrixWorld);
          box.radius += SHADOW_MARGIN;
          const length = shadowLength(box.radius, current.sun.y);
          if (length !== null && capsuleOutside(box.center, box.radius, current.sun, length, current.planes)) {
            batch.setVisibleAt(i, false);
            hidden.push(i);
          }
        }
      }
      try {
        return before.apply(this, args);
      } finally {
        // The draw list is built: the instances show again for the view.
        for (const i of hidden) batch.setVisibleAt(i, true);
        info.culledInstances += hidden.length;
        hidden.length = 0;
      }
    };
  }

  function list(scene) {
    casters = [];
    scene.traverse((o) => {
      if (cullable(o) || o.userData.standIn) casters.push(o);
      else if (o.isBatchedMesh && o.castShadow && !o.userData.shadowCull) wrapBatch(o);
    });
  }

  // The sun direction (unit, from the light to its target) when every
  // shadow light is a directional light that points the same way, else null.
  function sunDirection(lights) {
    let out = null;
    for (const l of lights) {
      if (!l.isDirectionalLight) return null;
      a.setFromMatrixPosition(l.target.matrixWorld);
      dir.setFromMatrixPosition(l.matrixWorld);
      a.sub(dir).normalize();
      if (out && out.dot(a) < 0.9999) return null;
      out = (out ?? new THREE.Vector3()).copy(a);
    }
    return out;
  }

  shadowMap.render = function (lights, scene, camera) {
    if (!shadowMap.enabled || (!shadowMap.autoUpdate && !shadowMap.needsUpdate) || !lights.length) return draw.call(this, lights, scene, camera);
    for (const s of SHADOW_STAND_INS) {
      if (s.visible) continue;
      s.visible = true;
      shown.push(s);
    }
    const sun = cull ? sunDirection(lights) : null;
    info.culledInstances = 0;
    if (sun) {
      if (passes++ % RELIST === 0) list(scene);
      frustum.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem, camera.reversedDepth);
      current = { sun, planes: frustum.planes };
      for (const o of casters) {
        if (!o.castShadow) continue;
        // A skinned mesh's sphere holds its pose; three.js makes it at the
        // first cull. Until then the mesh stays.
        const bounds = o.isSkinnedMesh ? o.boundingSphere : o.geometry.boundingSphere;
        if (!bounds) continue;
        sphere.copy(bounds).applyMatrix4(o.matrixWorld);
        sphere.radius += SHADOW_MARGIN;
        const length = shadowLength(sphere.radius, sun.y);
        if (length === null) break;
        if (capsuleOutside(sphere.center, sphere.radius, sun, length, frustum.planes)) {
          o.castShadow = false;
          off.push(o);
        }
      }
    }
    info.casters = casters.length;
    info.culled = off.length;
    info.standIns = shown.length;
    try {
      return draw.call(this, lights, scene, camera);
    } finally {
      current = null;
      for (const o of off) o.castShadow = true;
      for (const s of shown) s.visible = false;
      off.length = 0;
      shown.length = 0;
    }
  };
  return { info };
}
