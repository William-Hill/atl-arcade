import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GREYBOX_BLOCK } from "./levels/greybox-block.js";
import { applyFixedCamera, createPerspectiveCamera } from "./render/camera.js";
import { createColliderDebug } from "./render/collider-debug.js";
import { buildLevelLighting, buildLevelMeshes } from "./render/level-mesh.js";
import { createRenderer, fitToWindow } from "./render/renderer.js";
import { buildStaticWorld, initPhysics } from "./physics/rapier-world.js";
import { advance, createStepper } from "./sim/fixed-step.js";
import * as THREE from "three";

const params = new URLSearchParams(window.location.search);
const useFixedCamera = params.get("view") === "fixed";
const fixedCameraName = params.get("cam") ?? "wide";
const startWithColliders = params.get("debug") === "colliders";

const level = GREYBOX_BLOCK;

await initPhysics();
const physics = buildStaticWorld(level);

const canvas = document.getElementById("stage");
const renderer = createRenderer(canvas);
const camera = createPerspectiveCamera();

const scene = new THREE.Scene();
buildLevelLighting(scene);
scene.add(buildLevelMeshes(level));

const colliderDebug = createColliderDebug(physics.world);
scene.add(colliderDebug.object);
colliderDebug.visible = startWithColliders;

let controls = null;
if (useFixedCamera) {
  const pose = level.fixedCameras[fixedCameraName];
  if (!pose) throw new Error(`main: no fixed camera named ${fixedCameraName}`);
  applyFixedCamera(camera, pose);
} else {
  camera.position.set(level.spawn.position.x - 10, 8, level.spawn.position.z + 14);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.5, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
}

fitToWindow(renderer, camera);
window.addEventListener("resize", () => fitToWindow(renderer, camera));

window.addEventListener("keydown", (event) => {
  if (event.key === "p" || event.key === "P") colliderDebug.toggle();
});

let stepper = createStepper();
let ticks = 0;
let frames = 0;
let last = performance.now();

function frame(now) {
  const stepped = advance(stepper, (now - last) / 1000);
  last = now;
  stepper = stepped.stepper;
  ticks += stepped.steps;

  controls?.update();
  colliderDebug.update();
  renderer.render(scene, camera);
  frames += 1;
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

const info = document.getElementById("shell-info");
if (info) {
  info.querySelector("[data-role=hint]").textContent = useFixedCamera
    ? "Fixed screenshot camera."
    : "Drag to orbit, scroll to zoom. P toggles colliders.";
}

// Read by the Playwright tests.
window.__atl = {
  build: "m0-02",
  levelId: level.id,
  objectCount: level.objects.length,
  colliderCount: physics.colliderCount,
  ready: true,
  get ticks() {
    return ticks;
  },
  get frames() {
    return frames;
  },
  get collidersVisible() {
    return colliderDebug.visible;
  },
  get colliderDebugVertices() {
    return colliderDebug.vertexCount;
  },
  setColliderDebug(value) {
    colliderDebug.visible = Boolean(value);
    return colliderDebug.visible;
  },
  get rendererInfo() {
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  },
};
