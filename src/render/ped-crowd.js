import * as THREE from "three";

// The far walkers of the pbr look as the same Meshy people as the near ones
// (ped-models.js), so a walker no longer turns from a blocky figure into a
// person as the camera comes near. Each person's LOD0 (15,600 triangles)
// and LOD1 (1,200) are baked into CROWD_FRAMES poses of its walk clip and
// one idle pose: static geometry, no skinning, no mixer. One BatchedMesh
// per kind (one draw call with WEBGL_multi_draw) holds the poses; each
// walker picks the pose of its stride phase (src/sim/peds.js), so the legs
// keep pace with the ground, and the LOD of its distance, as the rigs do
// (LOD1 is torn up close).

export const CROWD_FRAMES = 8;
// Under this speed (m/s) a walker shows the idle pose.
export const CROWD_IDLE_SPEED = 0.15;

// Pure: the pose index of a walker: 0..frames-1 for the walk (from its
// stride phase, radians, one turn per stride), `frames` for the idle pose.
export function crowdFrame(phase, speed, frames = CROWD_FRAMES) {
  if (!(speed >= CROWD_IDLE_SPEED)) return frames;
  const turn = phase / (Math.PI * 2);
  const f = Math.floor((turn - Math.floor(turn)) * frames);
  return Math.min(frames - 1, Math.max(0, f));
}

// Pure: the scale of a walker in the outer band of the pool (it grows in,
// as in peds-view.js), 0 outside the pool.
export function crowdGrow(x, z, focus, radius, band = 0.15) {
  const d = Math.hypot(x - focus[0], z - focus[1]);
  return Math.max(0, Math.min(1, (radius - d) / (band * radius)));
}

const _bone = new THREE.Matrix4();

// The skinned mesh posed now, as a static geometry in the space of `root`.
// Each bone's full matrix (root space <- bind) is made once; a vertex then
// takes the weighted sum of its bones' matrices (the outer matrices are
// linear, so this equals the skinning shader). Normals take the same 3x3
// part, normalized (the rigs have no shear).
export function bakePose(mesh, root) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const bones = mesh.skeleton.bones;
  const inverses = mesh.skeleton.boneInverses;
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
  const full = new Float32Array(bones.length * 16);
  for (let b = 0; b < bones.length; b += 1) {
    _bone.multiplyMatrices(bones[b].matrixWorld, inverses[b]).premultiply(toRoot).multiply(mesh.bindMatrix);
    full.set(_bone.elements, b * 16);
  }
  const n = pos.count;
  const outP = new Float32Array(n * 3);
  const outN = nor ? new Float32Array(n * 3) : null;
  const m = new Float32Array(16);
  for (let i = 0; i < n; i += 1) {
    m.fill(0);
    for (let k = 0; k < 4; k += 1) {
      const w = sw.getComponent(i, k);
      if (w === 0) continue;
      const o = si.getComponent(i, k) * 16;
      for (let j = 0; j < 16; j += 1) m[j] += full[o + j] * w;
    }
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    outP[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    outP[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    outP[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    if (outN) {
      const a = nor.getX(i);
      const b = nor.getY(i);
      const c = nor.getZ(i);
      const nx = m[0] * a + m[4] * b + m[8] * c;
      const ny = m[1] * a + m[5] * b + m[9] * c;
      const nz = m[2] * a + m[6] * b + m[10] * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      outN[i * 3] = nx / l;
      outN[i * 3 + 1] = ny / l;
      outN[i * 3 + 2] = nz / l;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(outP, 3));
  if (outN) out.setAttribute("normal", new THREE.BufferAttribute(outN, 3));
  if (g.attributes.uv) out.setAttribute("uv", g.attributes.uv.clone());
  if (g.index) out.setIndex(g.index.clone());
  return out;
}

// The poses of one GLB by LOD: levels[l] = [walk frames..., idle], and
// the distance (m) from which each LOD shows (the node's lodDistance).
// A mesh with no skin (the stroller) gives one pose for all frames.
function bakeKind(gltf, walkName, frames) {
  const scene = gltf.scene;
  const meshes = [];
  scene.traverse((o) => {
    const m = o.isMesh && /_lod(\d)$/.exec(o.name);
    if (m) meshes[Number(m[1])] = o;
  });
  const lods = meshes.filter(Boolean);
  if (!lods.length) return null;
  const clip = (n) => gltf.animations.find((c) => c.name === n);
  const walk = clip(walkName) ?? clip("walk") ?? gltf.animations[0];
  const idle = clip("idle");
  const mixer = new THREE.AnimationMixer(scene);
  const at = (mesh, c, t) => {
    mixer.stopAllAction();
    if (c) mixer.clipAction(c).play();
    mixer.setTime(t);
    scene.updateMatrixWorld(true);
    return bakePose(mesh, scene);
  };
  const levels = lods.map((mesh) => {
    if (!mesh.isSkinnedMesh) {
      scene.updateMatrixWorld(true);
      const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
      return Array.from({ length: frames + 1 }, () => g);
    }
    const poses = [];
    for (let f = 0; f < frames; f += 1) poses.push(at(mesh, walk, walk ? (f / frames) * walk.duration : 0));
    poses.push(at(mesh, idle ?? walk, 0));
    return poses;
  });
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  return { material: lods[0].material, levels, distances: lods.map((m) => m.userData.lodDistance ?? 0) };
}

// Pure: the LOD for a walker `d` m away, from the LOD start distances.
export function crowdLod(d, distances) {
  let k = 0;
  distances.forEach((start, i) => {
    if (d >= start) k = i;
  });
  return k;
}

// gltfs: { kind: gltf } (ped-models.js). people: the walker kinds; kindOf(id)
// picks the kind of walker `id`; companions: { kind: { kind, x, z } }.
// walkClip: { kind: clip name }. size: the walker pool size. The bake
// yields to the frame loop after each kind, so no one task is long.
export async function createPedCrowd(gltfs, { people, kindOf, companions = {}, walkClip = {}, size, frames = CROWD_FRAMES }) {
  const group = new THREE.Group();
  group.name = "ped-crowd";
  const kinds = new Set(people);
  for (const p of people) if (companions[p]) kinds.add(companions[p].kind);
  const batches = new Map();
  let bakeMs = 0;
  for (const kind of kinds) {
    if (!gltfs[kind]) continue;
    if (bakeMs > 0) await new Promise((done) => setTimeout(done, 0));
    const t0 = performance.now();
    const baked = bakeKind(gltfs[kind], walkClip[kind] ?? "walk", frames);
    bakeMs += performance.now() - t0;
    if (!baked) continue;
    const unique = [...new Set(baked.levels.flat())];
    const verts = unique.reduce((n, g) => n + g.attributes.position.count, 0);
    const idx = unique.reduce((n, g) => n + (g.index ? g.index.count : g.attributes.position.count), 0);
    const mesh = new THREE.BatchedMesh(size, verts, idx, baked.material);
    mesh.name = `ped-crowd-${kind}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const ids = new Map(unique.map((g) => [g, mesh.addGeometry(g)]));
    const geometry = baked.levels.map((poses) => poses.map((g) => ids.get(g)));
    group.add(mesh);
    batches.set(kind, { mesh, geometry, distances: baked.distances, slot: new Map(), seen: new Set() });
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  // bakeMs: the main-thread time of the bake, at load.
  const stats = { drawn: 0, kinds: batches.size, bakeMs: Math.round(bakeMs) };

  // The instance of walker `id` in a batch, made on first use.
  function instance(b, id) {
    let k = b.slot.get(id);
    if (k === undefined) {
      k = b.mesh.addInstance(b.geometry[0][0]);
      b.slot.set(id, k);
    }
    return k;
  }
  function place(b, id, frame, d, x, y, z, yaw, scale) {
    const k = instance(b, id);
    b.mesh.setGeometryIdAt(k, b.geometry[crowdLod(d, b.distances)][frame]);
    q.setFromAxisAngle(up, yaw);
    m.compose(p.set(x, y, z), q, s.setScalar(scale));
    b.mesh.setMatrixAt(k, m);
    b.mesh.setVisibleAt(k, true);
    b.seen.add(id);
    return k;
  }
  return {
    group,
    stats,
    // state: the walker pool (src/sim/peds.js); skip: walker ids drawn as
    // rigged people (ped-models.js); eye: the camera position.
    update(state, skip, eye) {
      stats.drawn = 0;
      for (const b of batches.values()) b.seen.clear();
      for (const w of state.peds) {
        if (!w.live || skip.has(w.id)) continue;
        const scale = crowdGrow(w.x, w.z, state.focus, state.radius);
        if (scale <= 0) continue;
        const kind = kindOf(w.id);
        const b = batches.get(kind);
        if (!b) continue;
        const frame = crowdFrame(w.phase, w.speed, frames);
        const yaw = Math.atan2(w.fx, w.fz);
        const d = Math.hypot(w.x - eye.x, w.y - eye.y, w.z - eye.z);
        place(b, w.id, frame, d, w.x, w.y, w.z, yaw, scale);
        stats.drawn += 1;
        const c = companions[kind];
        const cb = c && batches.get(c.kind);
        if (cb) {
          const ox = Math.cos(yaw) * c.x + Math.sin(yaw) * c.z;
          const oz = -Math.sin(yaw) * c.x + Math.cos(yaw) * c.z;
          place(cb, w.id, frame, d, w.x + ox * scale, w.y, w.z + oz * scale, yaw, scale);
        }
      }
      for (const b of batches.values()) for (const [id, k] of b.slot) if (!b.seen.has(id)) b.mesh.setVisibleAt(k, false);
    },
    // Pure-ish: the walker kinds this crowd draws.
    has(kind) {
      return batches.has(kind);
    },
  };
}
