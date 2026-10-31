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

const state = { ready: false, error: null, views: Object.keys(VIEWS), setView };
window.__skater = state;

try {
  const model = await loadSkaterModel(params.get("skater") ?? "nia");
  scene.add(model.root);
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
  controls.update();
  renderer.render(scene, camera);
});
