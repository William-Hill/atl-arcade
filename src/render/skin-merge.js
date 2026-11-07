import * as THREE from "three";

// One skinned mesh in place of a skater's parts, where their textures do not
// matter (#188). A skater GLB is 22 (Nia) or 26 (Marcus) parts, each with its
// own material and textures, so the color pass draws each part. But the
// outline hull (one ink material), the shadow map (a depth material), and
// the GTAO normal pass (one override material) draw every part with the same
// material. There the parts merge into one geometry and one draw call per
// skater. The merged mesh shares the skeleton, so it moves with the parts.

// The attributes that the hull, the shadow, and the normal pass read.
const ATTRS = [
  ["position", 3, Float32Array],
  ["normal", 3, Float32Array],
  ["skinIndex", 4, Uint16Array],
  ["skinWeight", 4, Float32Array],
];

// The shadow stand-ins: hidden, and shown only while the shadow map draws
// (src/render/shadow-pass.js). A layer cannot do it: three.js r186 tests the
// main camera's layers in the shadow pass.
export const SHADOW_STAND_INS = new Set();

// Only the shadow pass (src/render/shadow-pass.js) shows the stand-ins. A
// page with no shadow pass (the greybox level, the animation lab) must keep
// the parts' own shadows, so mergeShadow() does nothing until a shadow pass
// turns the stand-ins on.
const standIns = { on: false };
export function enableShadowStandIns(on = true) {
  standIns.on = on;
}

function materials(mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

// Pure: true when a part draws the same depth as a plain material of its
// side: opaque, no alpha test, no alpha map, and no displacement.
export function plainDepth(mesh) {
  return materials(mesh).every((m) => !m.transparent && !(m.alphaTest > 0) && !m.alphaMap && !m.displacementMap && m.visible !== false);
}

// Pure: true when two skeletons pose the same: the same bones and the same
// bind inverses. SkeletonUtils.clone() gives each part of a clone its own
// skeleton over the one set of bones.
export function sameSkeleton(a, b) {
  if (a === b) return true;
  if (!a || !b || a.bones.length !== b.bones.length) return false;
  return a.bones.every((bone, i) => bone === b.bones[i] && a.boneInverses[i].equals(b.boneInverses[i]));
}

// Pure: true when the parts can draw as one skinned mesh: one skeleton, one
// bind matrix, one parent, the same local transform, one material side, and
// the attributes of ATTRS.
export function canMerge(parts) {
  if (parts.length < 2) return false;
  const [a] = parts;
  const side = materials(a)[0]?.side;
  return parts.every(
    (p) =>
      p.isSkinnedMesh &&
      sameSkeleton(p.skeleton, a.skeleton) &&
      p.parent === a.parent &&
      p.bindMatrix.equals(a.bindMatrix) &&
      p.position.equals(a.position) &&
      p.quaternion.equals(a.quaternion) &&
      p.scale.equals(a.scale) &&
      materials(p).every((m) => m.side === side) &&
      ATTRS.every(([name, size]) => p.geometry.attributes[name]?.itemSize === size) &&
      p.geometry.groups.length <= 1,
  );
}

// Pure: the parts' geometries as one, with only ATTRS and an index.
export function mergeGeometries(geometries) {
  let vertices = 0;
  let indices = 0;
  for (const g of geometries) {
    vertices += g.attributes.position.count;
    indices += g.index ? g.index.count : g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  for (const [name, size, Type] of ATTRS) {
    const array = new Type(vertices * size);
    let at = 0;
    for (const g of geometries) {
      const attr = g.attributes[name];
      // getComponent() reads interleaved and normalized attributes too.
      for (let i = 0; i < attr.count; i += 1) for (let k = 0; k < size; k += 1) array[at++] = attr.getComponent(i, k);
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  const index = new Uint32Array(indices);
  let at = 0;
  let base = 0;
  for (const g of geometries) {
    const n = g.attributes.position.count;
    if (g.index) for (let i = 0; i < g.index.count; i += 1) index[at++] = g.index.getX(i) + base;
    else for (let i = 0; i < n; i += 1) index[at++] = i + base;
    base += n;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

// The clones of one skater share the part geometries, so they share the
// merged geometry too: the key is the first part's geometry.
const cache = new WeakMap();

function mergedFor(parts) {
  const key = parts.map((p) => p.geometry.uuid).join(",");
  const hit = cache.get(parts[0].geometry);
  if (hit && hit.key === key) return hit.geometry;
  const geometry = mergeGeometries(parts.map((p) => p.geometry));
  geometry.name = "skater-merged";
  cache.set(parts[0].geometry, { key, geometry });
  return geometry;
}

// A skinned mesh of the merged parts, bound to their skeleton, next to them.
export function mergedSkin(parts, material, name) {
  const [a] = parts;
  const mesh = new THREE.SkinnedMesh(mergedFor(parts), material);
  mesh.name = name;
  mesh.frustumCulled = a.frustumCulled;
  mesh.position.copy(a.position);
  mesh.quaternion.copy(a.quaternion);
  mesh.scale.copy(a.scale);
  mesh.bind(a.skeleton, a.bindMatrix);
  a.parent.add(mesh);
  return mesh;
}

// The skater's parts that one depth draw can stand in for: the opaque
// skinned meshes of the GLB (not the hulls nor the stand-ins), that pass
// `keep`.
export function mergeableParts(root, keep = () => true) {
  const parts = [];
  root.traverse((o) => {
    if (o.isSkinnedMesh && !o.userData.standIn && !o.userData.outlineOf && plainDepth(o) && keep(o)) parts.push(o);
  });
  return canMerge(parts) ? parts : [];
}

// One shadow caster in place of the parts' shadows: the merged mesh with a
// plain material of the parts' side, so it draws the same depth. The parts
// stop casting. Returns the caster, or null when the parts do not merge or
// no shadow pass shows the stand-ins.
export function mergeShadow(root) {
  if (!standIns.on) return null;
  const parts = mergeableParts(root, (p) => p.castShadow);
  if (!parts.length) return null;
  const caster = mergedSkin(parts, new THREE.MeshBasicMaterial({ side: materials(parts[0])[0].side, colorWrite: false }), "skater-shadow");
  caster.castShadow = true;
  caster.receiveShadow = false;
  caster.visible = false;
  caster.userData.standIn = parts;
  for (const p of parts) p.castShadow = false;
  SHADOW_STAND_INS.add(caster);
  return caster;
}
