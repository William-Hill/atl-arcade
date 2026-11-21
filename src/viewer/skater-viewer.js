import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createRenderer, fitToWindow } from "../render/renderer.js";
import { fetchSkaterModel, loadSkaterModel } from "../render/skater-model.js";
import { EYES, MOUTHS } from "../render/face-anim.js";
import { pbrSkater } from "../render/toon.js";
import { bodyFor, modelScale } from "../sim/skate/body.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// Test page for a skater model: skater.html?skater=nia&view=front.
// The model faces +x, as in the game. +z is the skater's right.
const VIEWS = {
  front: [1, 0],
  back: [-1, 0],
  left: [0, -1],
  right: [0, 1],
  "three-quarter": [Math.SQRT1_2, -Math.SQRT1_2],
};
// Until the model loads: a 1.7 m skater centered at hip height.
const TARGET = new THREE.Vector3(0, 0.85, 0);
// The face close-up: ?view=face. The face center is about 1.44 m up.
// The face of the 1.70 m GLB, before the dossier scale (body.js).
const FACE_Y = 1.44;
const FACE_TARGET = new THREE.Vector3(0, FACE_Y, 0);
let radius = 0.95;
let currentView = "three-quarter";
// True once the user rotates or zooms: a resize then keeps their camera.
let userMoved = false;

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
controls.addEventListener("start", () => {
  userMoved = true;
});

// The camera distance at which a sphere of `radius` fills the narrower of the
// vertical and horizontal fields of view, with a 10% margin.
export function fitDistance(radius, vfovDeg, aspect) {
  const vHalf = THREE.MathUtils.degToRad(vfovDeg) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  return (radius * 1.1) / Math.sin(Math.min(vHalf, hHalf));
}

function setView(name) {
  if (name === "face") {
    currentView = name;
    userMoved = false;
    camera.position.set(0.55, FACE_TARGET.y + 0.02, 0);
    controls.target.copy(FACE_TARGET);
    controls.update();
    renderer.render(scene, camera);
    return;
  }
  controls.target.copy(TARGET);
  const dir = VIEWS[name];
  if (!dir) throw new Error(`Unknown view: ${name}`);
  currentView = name;
  userMoved = false;
  const d = fitDistance(radius, camera.fov, camera.aspect);
  camera.position.set(TARGET.x + dir[0] * d, TARGET.y + 0.2, TARGET.z + dir[1] * d);
  controls.update();
  renderer.render(scene, camera);
}

fitToWindow(renderer, camera);
window.addEventListener("resize", () => {
  // fitToWindow updates the aspect and the projection. Fit the named view
  // again only while the user has not moved the camera.
  fitToWindow(renderer, camera);
  if (!userMoved) setView(currentView);
});

let paused = false;
let mixer = null;
let clips = [];
let face = null;

// Sets the face decal: ?face=happy,open or __skater.setFace("closed", "smile").
function setFace(eyes, mouth) {
  if (!face) throw new Error("This skater has no face decals");
  face.set(eyes, mouth);
  renderer.render(scene, camera);
  return { eyes: face.eyes, mouth: face.mouth };
}

// Draws one clip as a row of frames from the three-quarter view (or another
// VIEWS key): a contact sheet. The first frame is t = 0 and the last frame
// is the clip end.
function sheet(name, cols = 6, view = "three-quarter") {
  const clip = clips.find((c) => c.name === name);
  if (!clip) throw new Error(`Unknown clip: ${name}`);
  paused = true;
  mixer.stopAllAction();
  const action = mixer.clipAction(clip);
  action.reset().play();
  const dir = VIEWS[view] ?? VIEWS["three-quarter"];
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
  views: [...Object.keys(VIEWS), "face"],
  setView,
  setFace,
  sheet,
  get clips() {
    return clips.map((c) => c.name);
  },
};
window.__skater = state;

try {
  // ?small=1 shows the phone GLB (skater-1024.glb).
  const name = params.get("skater") ?? "nia";
  const small = params.get("small") === "1";
  const model = await loadSkaterModel(name, small ? fetchSkaterModel(name, null, { small }) : null);
  // ?look=pbr: the materials of the game's pbr look, lit by a room
  // environment map. Without it, the viewer shows the GLB materials.
  if (params.get("look") === "pbr") {
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    pbrSkater(model);
  }
  scene.add(model.root);
  // The model stands at the dossier height: the face moves with the scale.
  FACE_TARGET.y = FACE_Y * modelScale(bodyFor(name));
  clips = model.animations;
  face = model.face;
  if (face && params.get("face")) {
    const [eyes, mouth] = params.get("face").split(",");
    // An unknown state name only warns: the viewer still loads.
    if (EYES.includes(eyes ?? "open") && MOUTHS.includes(mouth ?? "neutral")) face.set(eyes ?? "open", mouth ?? "neutral");
    else console.warn(`Unknown face ${params.get("face")}: eyes are ${EYES.join("/")}, mouths are ${MOUTHS.join("/")}`);
  }
  mixer = new THREE.AnimationMixer(model.root);
  const box = new THREE.Box3().setFromObject(model.root, true);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  TARGET.copy(sphere.center);
  radius = sphere.radius;
  controls.target.copy(TARGET);
  state.info = {
    triangles: model.skinnedMesh.geometry.index.count / 3,
    bones: model.skinnedMesh.skeleton.bones.length,
    skinned: model.skinnedMesh.isSkinnedMesh,
    animations: model.animations.length,
    face: Boolean(face),
    meshMin: model.skinnedMesh.geometry.boundingBox?.min.toArray() ?? null,
    meshMax: model.skinnedMesh.geometry.boundingBox?.max.toArray() ?? null,
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
