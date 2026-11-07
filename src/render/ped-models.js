import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { getDracoLoader } from "./skater-model.js";
import { PEDS } from "../sim/peds.js";
import { leashPoints } from "./leash.js";

// The Meshy people (assets/people/; docs/people-props.md) for the walkers
// nearest the camera (src/sim/peds.js), in the pbr look: each of those
// walkers is drawn as a rigged GLB person playing its walk clip at the
// walker's pace (idle when it stops), and peds-view.js skips it. The dog
// walker walks the dog on a leash (leash.js), the stroller dad pushes the
// stroller, its wheels turning. The other walkers keep the instanced
// figures. The cyclist and the seated pose are not walkers.

const url = (f) => new URL(`../../assets/people/${f}.glb`, import.meta.url).href;
export const PED_MODEL_URLS = {
  walker_sundress: url("walker_sundress"),
  elder_polo: url("elder_polo"),
  jogger: url("jogger"),
  dog_walker: url("dog_walker"),
  stroller_dad: url("stroller_dad"),
  dog: url("dog"),
  stroller: url("stroller"),
};
export const PED_MODEL_KINDS = ["walker_sundress", "elder_polo", "jogger", "dog_walker", "stroller_dad"];
// How many walkers get a GLB person, by quality tier, and out to what
// distance (m) from the camera.
export const PED_MODEL_COUNT = { low: 0, phone: 3, high: 8 };
export const PED_MODEL_RADIUS = 45;
// Each person's walking clip, and what walks with it (x, z in the person's
// frame, m; +z ahead, +x its left).
export const PED_WALK_CLIP = { stroller_dad: "push" };
export const PED_COMPANION = {
  dog_walker: { kind: "dog", x: 0.75, z: 0.25, leash: { hand: "LeftHand", collar: "neck", length: 1.1 } },
  stroller_dad: { kind: "stroller", x: 0, z: 0.64 },
};

// Pure: the person for walker `id` (a fixed spread over the kinds).
export function personFor(id, kinds = PED_MODEL_KINDS) {
  let h = (id + 1) * 2654435761;
  h ^= h >>> 15;
  return kinds[(h >>> 0) % kinds.length];
}

// Pure: the ids of the live walkers within `radius` of (x, z), nearest
// first, at most `count`.
export function nearestWalkers(peds, x, z, count, radius = PED_MODEL_RADIUS) {
  if (count <= 0) return [];
  return peds
    .filter((w) => w.live && Math.hypot(w.x - x, w.z - z) < radius)
    .map((w) => [Math.hypot(w.x - x, w.z - z), w.id])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .slice(0, count)
    .map(([, id]) => id);
}

// Pure: the clip time scale for a walk clip of `duration` s at `speed` m/s
// (a walk cycle covers PEDS.stride m).
export function walkTimeScale(speed, duration, stride = PEDS.stride) {
  return (speed * duration) / stride;
}

// `after` (a promise) holds the downloads back, for example until the first
// frame (#190).
export function createPedModels({ count = PED_MODEL_COUNT.high, urls = PED_MODEL_URLS, after = null } = {}) {
  const group = new THREE.Group();
  group.name = "ped-models";
  const skip = new Set();
  const stats = { count, drawn: 0, loaded: false, error: null };
  const gltfs = {};
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());
  const ready = Promise.resolve(after)
    .then(() => Promise.all(Object.entries(urls).map(async ([k, u]) => (gltfs[k] = await loader.loadAsync(u)))))
    .then(() => {
      stats.loaded = true;
    })
    .catch((err) => {
      stats.error = String(err);
      throw err;
    });

  // One rig: a clone of a GLB with a mixer, its walk and idle actions and
  // its LOD meshes.
  function rig(kind) {
    const g = gltfs[kind];
    const root = cloneSkinned(g.scene);
    const lods = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      // Keep the frustum culling on: a person behind the camera or out of
      // the shadow frustum then costs no draw call. The skinned bounds move
      // with the root, and the walk and idle clips stay inside them.
      o.frustumCulled = true;
      const m = /_lod(\d)$/.exec(o.name);
      if (m) lods[Number(m[1])] = { mesh: o, distance: o.userData.lodDistance ?? 0 };
    });
    const mixer = new THREE.AnimationMixer(root);
    const clip = (n) => g.animations.find((c) => c.name === n);
    const walkClip = clip(PED_WALK_CLIP[kind] ?? "walk") ?? clip("walk") ?? g.animations[0];
    const walk = walkClip ? mixer.clipAction(walkClip).play() : null;
    const idleClip = clip("idle");
    const idle = idleClip ? mixer.clipAction(idleClip).play() : null;
    return { kind, root, mixer, walk, idle, duration: walkClip?.duration ?? 1, lods: lods.filter(Boolean) };
  }

  // A person bound to a walker, with its companion and leash.
  const pool = [];
  function make(kind) {
    const person = rig(kind);
    group.add(person.root);
    const c = PED_COMPANION[kind];
    let companion = null;
    let leash = null;
    if (c) {
      companion = rig(c.kind);
      group.add(companion.root);
      if (c.leash) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x8a2f2a, roughness: 0.7 }));
        mesh.name = "ped-leash";
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        group.add(mesh);
        leash = { mesh, hand: person.root.getObjectByName(c.leash.hand), collar: companion.root.getObjectByName(c.leash.collar), a: new THREE.Vector3(), b: new THREE.Vector3(), pts: [] };
      }
    }
    const slot = { kind, person, companion, leash, id: -1 };
    pool.push(slot);
    return slot;
  }
  const show = (slot, on) => {
    slot.person.root.visible = on;
    if (slot.companion) slot.companion.root.visible = on;
    if (slot.leash) slot.leash.mesh.visible = on;
  };
  function pace(r, speed, dt, d) {
    const w = Math.min(1, speed / 0.3);
    if (r.walk) {
      r.walk.setEffectiveWeight(r.idle ? w : 1);
      r.walk.timeScale = walkTimeScale(speed, r.duration);
    }
    if (r.idle) r.idle.setEffectiveWeight(r.walk ? 1 - w : 1);
    r.mixer.update(dt);
    let k = 0;
    r.lods.forEach((l, i) => {
      if (d >= l.distance) k = i;
    });
    r.lods.forEach((l, i) => (l.mesh.visible = i === k));
  }

  const up = new THREE.Vector3(0, 1, 0);
  const off = new THREE.Vector3();
  return {
    group,
    ready,
    skip,
    stats,
    // view: { sees(x, y, z, r) } (src/render/view-cull.js) or null. A person
    // out of the view keeps its place but skips the clip and the leash.
    update(state, camera, dt, view = null) {
      skip.clear();
      stats.drawn = 0;
      if (!stats.loaded || !state) return;
      const want = nearestWalkers(state.peds, camera.x, camera.z, count);
      const byId = new Map(state.peds.map((w) => [w.id, w]));
      const keep = new Set(want);
      for (const slot of pool) if (!keep.has(slot.id)) slot.id = -1;
      for (const id of want) {
        const kind = personFor(id);
        const slot = pool.find((s) => s.id === id) ?? pool.find((s) => s.id === -1 && s.kind === kind) ?? make(kind);
        slot.id = id;
      }
      for (const slot of pool) {
        if (slot.id < 0) {
          show(slot, false);
          continue;
        }
        const w = byId.get(slot.id);
        show(slot, true);
        skip.add(slot.id);
        stats.drawn += 1;
        const yaw = Math.atan2(w.fx, w.fz);
        const d = Math.hypot(w.x - camera.x, w.y - camera.y, w.z - camera.z);
        slot.person.root.position.set(w.x, w.y, w.z);
        slot.person.root.rotation.y = yaw;
        const seen = !view || view.sees(w.x, w.y + 0.9, w.z, slot.companion ? 2 : 1);
        if (seen) pace(slot.person, w.speed, dt, d);
        if (slot.companion) {
          const c = PED_COMPANION[slot.kind];
          off.set(c.x, 0, c.z).applyAxisAngle(up, yaw);
          slot.companion.root.position.set(w.x + off.x, w.y, w.z + off.z);
          slot.companion.root.rotation.y = yaw;
          if (seen) pace(slot.companion, w.speed, dt, d);
        }
        if (seen && slot.leash?.hand && slot.leash.collar) {
          const l = slot.leash;
          l.mesh.parent.updateMatrixWorld();
          l.hand.getWorldPosition(l.a);
          l.collar.getWorldPosition(l.b);
          const pts = leashPoints(l.a, l.b, PED_COMPANION[slot.kind].leash.length, 12, l.pts);
          l.mesh.geometry.dispose();
          l.mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, p.y, p.z))), 16, 0.006, 5);
        }
      }
    },
  };
}
