import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { getDracoLoader } from "./skater-model.js";
import { PEDS } from "../sim/peds.js";
import { ACT, POSE } from "../sim/ped-activity.js";
import { leashPoints } from "./leash.js";
import { createPedCrowd } from "./ped-crowd.js";
import { PED_VARIANTS, PED_VARIANT_URLS, atlasMaterial, createLookPicker, lookAtlas, lookTile, pedLooks } from "./ped-variants.js";

// The Meshy people (assets/people/; docs/people-props.md) for the walkers
// nearest the camera (src/sim/peds.js), in the pbr look: each of those
// walkers is drawn as a rigged GLB person playing its walk clip at the
// walker's pace (idle when it stops), and peds-view.js skips it. The dog
// walker walks the dog on a leash (leash.js), the stroller dad pushes the
// stroller, its wheels turning. The other walkers keep the instanced
// figures, or, with `crowd` (#190), the same people as baked poses
// (ped-crowd.js), so no walker turns from a figure into a person.
// The cyclist and the seated pose are not walkers.

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
// distance (m) from the camera. Each walker shows its look (ped-variants.js):
// a person and an outfit variant that no other walker within 40 m has.
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

// The clip of each pose (#133); every person GLB has them
// (assets/people/manifest.json). A talk plays the idle clip.
export const POSE_CLIP = { [POSE.sit]: "sit", [POSE.cheer]: "cheer", [POSE.talk]: "idle", [POSE.jog]: "run" };

// Pure: the clip a walker plays: { name, pace } (pace: true when the clip
// time follows the walker's speed). A walk is null: the walk and idle blend.
export function poseClip(pose) {
  const name = POSE_CLIP[pose];
  if (!name) return null;
  return { name, pace: pose === POSE.jog };
}

// `after` (a promise) holds the downloads back, for example until the first
// frame (#190).
// `crowd` (the walker pool size, needs WEBGL_multi_draw) draws the other
// walkers as baked people too; figureSkip then hides every instanced figure
// of peds-view.js, also while the GLBs load (unless they fail).
export function createPedModels({ count = PED_MODEL_COUNT.high, urls = PED_MODEL_URLS, after = null, crowd = 0, variants = PED_VARIANTS, variantUrls = PED_VARIANT_URLS } = {}) {
  const group = new THREE.Group();
  group.name = "ped-models";
  const skip = new Set();
  const stats = { count, drawn: 0, crowd: 0, loaded: false, error: null };
  let crowdView = null;
  const ALL = { has: () => true };
  const gltfs = {};
  const images = {};
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDracoLoader());
  const imageLoader = new THREE.ImageLoader();
  // The looks (ped-variants.js): a person and an outfit variant per walker.
  const looks = createLookPicker(pedLooks(PED_MODEL_KINDS, variants));
  const variantMats = new Map();
  // The material of a rig mesh for variant `v`: a clone with the variant
  // base color, made once per material and variant.
  function variantMaterial(material, kind, v) {
    if (!v || !material.map) return material;
    const key = `${material.uuid}:${v}`;
    if (!variantMats.has(key)) {
      const img = images[variants[kind][v - 1]];
      if (!img) return material;
      const mat = material.clone();
      // A new texture: a clone would share the image source.
      const src = material.map;
      const tex = new THREE.Texture(img);
      tex.flipY = src.flipY;
      tex.colorSpace = src.colorSpace;
      tex.wrapS = src.wrapS;
      tex.wrapT = src.wrapT;
      tex.channel = src.channel;
      tex.anisotropy = src.anisotropy;
      tex.needsUpdate = true;
      mat.map = tex;
      variantMats.set(key, mat);
    }
    return variantMats.get(key);
  }
  const ready = Promise.resolve(after)
    .then(() =>
      Promise.all([
        ...Object.entries(urls).map(async ([k, u]) => (gltfs[k] = await loader.loadAsync(u))),
        // A variant that fails to load leaves its walkers in the person's
        // own texture.
        ...Object.entries(variantUrls).map(async ([k, u]) => (images[k] = await imageLoader.loadAsync(u).catch(() => null))),
      ]),
    )
    .then(async () => {
      if (crowd > 0) {
        const atlases = {};
        for (const kind of PED_MODEL_KINDS) {
          const mesh = gltfs[kind]?.scene.getObjectByName(`${kind}_lod0`);
          const base = mesh?.material?.map?.image;
          if (base && variants[kind]?.length) atlases[kind] = (material) => atlasMaterial(material, lookAtlas(base, variants[kind].map((f) => images[f])));
        }
        const tile = new THREE.Color();
        crowdView = await createPedCrowd(gltfs, {
          people: PED_MODEL_KINDS,
          kindOf: (id) => looks.of(id)?.kind ?? personFor(id),
          // The batch color of a walker: its atlas tile (atlasMaterial).
          colorOf: (id) => {
            const [u, w] = lookTile(looks.of(id)?.v ?? 0);
            return tile.setRGB(u, w, 0);
          },
          materials: atlases,
          companions: PED_COMPANION,
          walkClip: PED_WALK_CLIP,
          size: crowd,
        });
        group.add(crowdView.group);
      }
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
    // The pose clips (a seat, a cheer, a run), made on first use.
    const poses = new Map();
    const poseAction = (name) => {
      if (!poses.has(name)) {
        const c = clip(name);
        const a = c ? mixer.clipAction(c) : null;
        if (a) a.play().setEffectiveWeight(0);
        poses.set(name, a);
      }
      return poses.get(name);
    };
    return { kind, root, mixer, walk, idle, poseAction, pose: null, duration: walkClip?.duration ?? 1, lods: lods.filter(Boolean) };
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
    const meshes = [];
    person.root.traverse((o) => {
      if (o.isMesh) meshes.push({ mesh: o, material: o.material });
    });
    const slot = { kind, person, companion, leash, meshes, v: 0, id: -1 };
    pool.push(slot);
    return slot;
  }
  const show = (slot, on) => {
    slot.person.root.visible = on;
    if (slot.companion) slot.companion.root.visible = on;
    if (slot.leash) slot.leash.mesh.visible = on;
  };
  function pace(r, speed, dt, d, pose = POSE.walk) {
    const pc = r.poseAction ? poseClip(pose) : null;
    const act = pc ? r.poseAction(pc.name) : null;
    if (r.pose && r.pose !== act && r.pose !== r.idle && r.pose !== r.walk) r.pose.setEffectiveWeight(0);
    if (act && r.pose !== act && act !== r.idle) act.reset();
    r.pose = act;
    if (act) {
      // A pose clip alone; the run keeps pace with the jog.
      act.setEffectiveWeight(1);
      act.timeScale = pc.pace ? walkTimeScale(speed, act.getClip().duration, ACT.jogStride) : 1;
      // The talk pose is the idle action itself (one action per clip).
      if (r.walk && r.walk !== act) r.walk.setEffectiveWeight(0);
      if (r.idle && r.idle !== act) r.idle.setEffectiveWeight(0);
    }
    const w = Math.min(1, speed / 0.3);
    if (r.walk && !act) {
      r.walk.setEffectiveWeight(r.idle ? w : 1);
      r.walk.timeScale = walkTimeScale(speed, r.duration);
    }
    if (r.idle && !act) r.idle.setEffectiveWeight(r.walk ? 1 - w : 1);
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
    // The look drawn for walker `id` ("kind" or "kind:v"), or null.
    kindOf(id) {
      const rig = pool.find((s) => s.id === id);
      if (!rig && !crowdView) return null;
      const l = looks.of(id);
      return l ? (l.v ? `${l.kind}:${l.v}` : l.kind) : null;
    },
    // The walker ids that peds-view.js must not draw.
    get figureSkip() {
      return crowd > 0 && !stats.error ? ALL : skip;
    },
    // view: { sees(x, y, z, r) } (src/render/view-cull.js) or null. A person
    // out of the view keeps its place but skips the clip and the leash.
    update(state, camera, dt, view = null) {
      skip.clear();
      stats.drawn = 0;
      stats.crowd = 0;
      if (!stats.loaded || !state) return;
      looks.refresh(state);
      const want = nearestWalkers(state.peds, camera.x, camera.z, count);
      const byId = new Map(state.peds.map((w) => [w.id, w]));
      const people = new Map(want.map((id) => [id, looks.of(id) ?? { kind: personFor(id), v: 0 }]));
      for (const slot of pool) if (people.get(slot.id)?.kind !== slot.kind) slot.id = -1;
      for (const [id, look] of people) {
        const slot = pool.find((s) => s.id === id) ?? pool.find((s) => s.id === -1 && s.kind === look.kind) ?? make(look.kind);
        slot.id = id;
        if (slot.v !== look.v) {
          slot.v = look.v;
          for (const m of slot.meshes) m.mesh.material = variantMaterial(m.material, slot.kind, look.v);
        }
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
        if (seen) pace(slot.person, w.speed, dt, d, w.pose);
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
      // Every other walker as a baked person (ped-crowd.js).
      if (crowdView) {
        crowdView.update(state, skip, camera);
        stats.crowd = crowdView.stats.drawn;
        stats.crowdBakeMs = crowdView.stats.bakeMs;
      }
    },
  };
}
