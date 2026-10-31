import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createRenderer, fitToWindow } from "../render/renderer.js";
import { loadSkaterModel } from "../render/skater-model.js";

// Test page for a skater model: skater.html?skater=nia&view=front.
// The model faces +x, as in the game. +z is the skater's right.
const VIEWS = {
  front: [1, 0],
  back: [-1, 0],
  left: [0, -1],
  right: [0, 1],
  "three-quarter": [Math.SQRT1_2, -Math.SQRT1_2],
};
const DISTANCE = 3.2;
const TARGET = new THREE.Vector3(0, 0.85, 0);

const params = new URLSearchParams(window.location.search);
const canvas = document.getElementById("stage");
const renderer = createRenderer(canvas);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2a3a);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 5, 2);
sun.castShadow = true;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(1.5, 48), new THREE.MeshStandardMaterial({ color: 0x55556a }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(TARGET);

function setView(name) {
  const dir = VIEWS[name];
  if (!dir) throw new Error(`Unknown view: ${name}`);
  camera.position.set(TARGET.x + dir[0] * DISTANCE, TARGET.y + 0.2, TARGET.z + dir[1] * DISTANCE);
  controls.update();
  renderer.render(scene, camera);
}

fitToWindow(renderer, camera);
window.addEventListener("resize", () => fitToWindow(renderer, camera));

let paused = false;
let mixer = null;
let clips = [];

// Draws one clip as a row of frames from the three-quarter view: a contact
// sheet. The first frame is t = 0 and the last frame is the clip end.
function sheet(name, cols = 6) {
  const clip = clips.find((c) => c.name === name);
  if (!clip) throw new Error(`Unknown clip: ${name}`);
  paused = true;
  mixer.stopAllAction();
  const action = mixer.clipAction(clip);
  action.reset().play();
  const dir = VIEWS["three-quarter"];
  camera.position.set(TARGET.x + dir[0] * 4.2, TARGET.y + 0.3, TARGET.z + dir[1] * 4.2);
  camera.lookAt(TARGET);
  const size = renderer.getSize(new THREE.Vector2());
  const w = Math.floor(size.x / cols);
  camera.aspect = w / size.y;
  camera.updateProjectionMatrix();
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, size.x, size.y);
  renderer.setScissor(0, 0, size.x, size.y);
  renderer.clear();
  for (let i = 0; i < cols; i += 1) {
    action.time = (clip.duration * i) / (cols - 1);
    mixer.update(0);
    renderer.setViewport(i * w, 0, w, size.y);
    renderer.setScissor(i * w, 0, w, size.y);
    renderer.render(scene, camera);
  }
  renderer.setScissorTest(false);
  renderer.autoClear = true;
  return { name, duration: clip.duration, tracks: clip.tracks.length };
}

const state = {
  ready: false,
  error: null,
  views: Object.keys(VIEWS),
  setView,
  sheet,
  get clips() {
    return clips.map((c) => c.name);
  },
};
window.__skater = state;

try {
  const model = await loadSkaterModel(params.get("skater") ?? "nia");
  scene.add(model.root);
  clips = model.animations;
  mixer = new THREE.AnimationMixer(model.root);
  const box = new THREE.Box3().setFromObject(model.root, true);
  state.info = {
    triangles: model.skinnedMesh.geometry.index.count / 3,
    bones: model.skinnedMesh.skeleton.bones.length,
    skinned: model.skinnedMesh.isSkinnedMesh,
    animations: model.animations.length,
    min: box.min.toArray(),
    max: box.max.toArray(),
  };
  setView(params.get("view") ?? "three-quarter");
  state.ready = true;
} catch (err) {
  state.error = String(err);
  console.error(err);
}

renderer.setAnimationLoop(() => {
  if (paused) return;
  controls.update();
  renderer.render(scene, camera);
});
