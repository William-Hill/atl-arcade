import * as THREE from "three";
import { createRenderer, fitToWindow } from "../render/renderer.js";
import { cloneSkaterModel } from "../render/skater-model.js";
import { toonSkater } from "../render/toon.js";

// Test page for the LOD1 skater (#280): skater-lod.html?skater=nia.
// The LOD0 model is on the left and the LOD1 model is on the right. Both
// are NPC clones (cloneSkaterModel()) with the toon look and the ink hull.
// __lod.pose(clip, time) sets both models to the same pose.
// __lod.check() plays every clip and tests the skinned LOD1 vertices.

const params = new URLSearchParams(window.location.search);
const name = params.get("skater") ?? "nia";
const canvas = document.getElementById("stage");
const renderer = createRenderer(canvas);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2a3a);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 5, 2);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshStandardMaterial({ color: 0x55556a }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
fitToWindow(renderer, camera);
// The three-quarter view of both models. Each model faces +x.
camera.position.set(2.5, 1.25, 2.5);
camera.lookAt(0, 0.8, 0);

const state = { ready: false, error: null };
window.__lod = state;

// Pure: the number of values in `a` that are not finite.
function countNonFinite(a) {
  let n = 0;
  for (const v of a) if (!Number.isFinite(v)) n += 1;
  return n;
}

try {
  const lod0 = await cloneSkaterModel(name, null, { lod1: true });
  const lod1 = await cloneSkaterModel(name, null, { lod1: true });
  if (!lod1.lod1Mesh) throw new Error("No LOD1 mesh");
  toonSkater(lod0);
  toonSkater(lod1);
  // Show one level in each clone: the mesh and its own hull.
  const showLevel = (model, level) => {
    const keep = level === 0 ? model.skinnedMesh : model.lod1Mesh;
    model.root.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const src = o.userData.outlineOf ?? o;
      o.visible = src === keep;
    });
  };
  showLevel(lod0, 0);
  showLevel(lod1, 1);
  // Left and right of the camera view, 0.6 m apart.
  lod0.root.position.set(0.45, 0, -0.45);
  lod1.root.position.set(-0.45, 0, 0.45);
  scene.add(lod0.root, lod1.root);
  const models = [lod0, lod1];
  const mixers = models.map((m) => new THREE.AnimationMixer(m.root));
  const clips = lod0.animations;

  const pose = (clipName, t) => {
    const clip = clips.find((c) => c.name === clipName);
    if (!clip) throw new Error(`Unknown clip: ${clipName}`);
    for (const mixer of mixers) {
      mixer.stopAllAction();
      const action = mixer.clipAction(clip);
      action.reset().play();
      action.time = t * clip.duration;
      mixer.update(0);
    }
    scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
    return { clip: clip.name, time: action0Time(clip, t) };
  };
  const action0Time = (clip, t) => t * clip.duration;

  // Plays every clip at 5 times. Each LOD1 vertex is a copy of a LOD0
  // vertex with the same skin (scripts/skater-lod.mjs), so after skinning it
  // must be finite and on a skinned LOD0 vertex. `gap` is the largest
  // distance (m) from a LOD1 vertex to the nearest LOD0 vertex. A grid of
  // 2 cm cells finds the nearest LOD0 vertex.
  const check = () => {
    const v = new THREE.Vector3();
    const cell = 0.02;
    const key = (x, y, z) => `${x},${y},${z}`;
    const report = [];
    for (const clip of clips) {
      let nonFinite = 0;
      let gap = 0;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        pose(clip.name, t);
        const grid = new Map();
        const m0 = lod0.skinnedMesh;
        for (let i = 0; i < m0.geometry.attributes.position.count; i += 1) {
          m0.getVertexPosition(i, v);
          const k = key(Math.floor(v.x / cell), Math.floor(v.y / cell), Math.floor(v.z / cell));
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(v.x, v.y, v.z);
        }
        const m1 = lod1.lod1Mesh;
        for (let i = 0; i < m1.geometry.attributes.position.count; i += 1) {
          m1.getVertexPosition(i, v);
          if (countNonFinite(v.toArray()) > 0) {
            nonFinite += 1;
            continue;
          }
          const cx = Math.floor(v.x / cell);
          const cy = Math.floor(v.y / cell);
          const cz = Math.floor(v.z / cell);
          let best = Infinity;
          for (let dx = -1; dx <= 1; dx += 1)
            for (let dy = -1; dy <= 1; dy += 1)
              for (let dz = -1; dz <= 1; dz += 1) {
                const list = grid.get(key(cx + dx, cy + dy, cz + dz));
                if (!list) continue;
                for (let j = 0; j < list.length; j += 3) best = Math.min(best, Math.hypot(list[j] - v.x, list[j + 1] - v.y, list[j + 2] - v.z));
              }
          gap = Math.max(gap, best);
        }
      }
      report.push({ clip: clip.name, nonFinite, gap });
    }
    return report;
  };

  const tri = (g) => g.index.count / 3;
  state.info = {
    clips: clips.map((c) => c.name),
    lod0: { triangles: tri(lod0.skinnedMesh.geometry), vertices: lod0.skinnedMesh.geometry.attributes.position.count, bones: lod0.skinnedMesh.skeleton.bones.length },
    lod1: {
      triangles: tri(lod1.lod1Mesh.geometry),
      vertices: lod1.lod1Mesh.geometry.attributes.position.count,
      bones: lod1.lod1Mesh.skeleton.bones.length,
      sharesSkeleton: lod1.lod1Mesh.skeleton === lod1.skinnedMesh.skeleton,
      sharesMaterial: lod1.lod1Mesh.material === lod1.skinnedMesh.material,
      hull: Boolean(lod1.root.getObjectByName(`${lod1.lod1Mesh.name}-outline`)),
      hullGeometry: lod1.root.getObjectByName(`${lod1.lod1Mesh.name}-outline`)?.geometry === lod1.lod1Mesh.geometry,
    },
  };
  state.pose = pose;
  state.check = check;
  pose(clips.find((c) => c.name === "idle") ? "idle" : clips[0].name, 0);
  state.ready = true;
} catch (err) {
  state.error = String(err);
  console.error(err);
}
