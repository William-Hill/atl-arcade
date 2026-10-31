import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createKeyboardInput } from "./input/keyboard.js";
import { GREYBOX_BLOCK } from "./levels/greybox-block.js";
import { buildStaticWorld, initPhysics } from "./physics/rapier-world.js";
import { applyFixedCamera, createPerspectiveCamera } from "./render/camera.js";
import { createColliderDebug } from "./render/collider-debug.js";
import { buildLevelLighting, buildLevelMeshes } from "./render/level-mesh.js";
import { createRenderer, fitToWindow } from "./render/renderer.js";
import { createSkaterMesh, syncSkaterMesh } from "./render/skater.js";
import { advance, createStepper, FIXED_DT } from "./sim/fixed-step.js";
import { createSkater, createWorld, NO_INPUT, runScript, step } from "./sim/skate/controller.js";
import { expandScript } from "./sim/skate/input-script.js";

const params = new URLSearchParams(window.location.search);
const useFixedCamera = params.get("view") === "fixed";
const fixedCameraName = params.get("cam") ?? "wide";
const startWithColliders = params.get("debug") === "colliders";

const level = GREYBOX_BLOCK;

await initPhysics();
const physics = buildStaticWorld(level);
const skateWorld = createWorld(level);

const canvas = document.getElementById("stage");
const renderer = createRenderer(canvas);
const camera = createPerspectiveCamera();

const scene = new THREE.Scene();
buildLevelLighting(scene);
scene.add(buildLevelMeshes(level));

const skaterMesh = createSkaterMesh();
scene.add(skaterMesh.group);

const colliderDebug = createColliderDebug(physics.world);
scene.add(colliderDebug.object);
colliderDebug.visible = startWithColliders;

let skater = createSkater(level);
syncSkaterMesh(skaterMesh, skater);

const keyboard = createKeyboardInput();

let controls = null;
if (useFixedCamera) {
  const pose = level.fixedCameras[fixedCameraName];
  if (!pose) throw new Error(`main: no fixed camera named ${fixedCameraName}`);
  applyFixedCamera(camera, pose);
} else {
  camera.position.set(skater.position.x - 9, 6, skater.position.z + 11);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(skater.position.x, 1, skater.position.z);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
}

fitToWindow(renderer, camera);
window.addEventListener("resize", () => fitToWindow(renderer, camera));
window.addEventListener("keydown", (event) => {
  if (event.key === "p" || event.key === "P") colliderDebug.toggle();
  if (event.key === "r" || event.key === "R") resetSkater();
});

function resetSkater() {
  skater = createSkater(level);
  syncSkaterMesh(skaterMesh, skater);
  return skater;
}

let stepper = createStepper();
let ticks = 0;
let frames = 0;
let last = performance.now();
// While a script is driving, the hand controls are ignored.
let scriptedFrames = null;
let scriptCursor = 0;
let scriptEndState = null;

function nextInput() {
  if (scriptedFrames) {
    if (scriptCursor < scriptedFrames.length) return scriptedFrames[scriptCursor++];
    // Freeze the state at the exact frame the script ran out, so a test can
    // compare the frame-driven run with the batch run without racing the
    // coast that follows.
    scriptEndState = structuredClone(skater);
    scriptedFrames = null;
    return NO_INPUT;
  }
  return keyboard.sample();
}

function frame(now) {
  const stepped = advance(stepper, (now - last) / 1000);
  last = now;
  stepper = stepped.stepper;

  for (let i = 0; i < stepped.steps; i += 1) {
    skater = step(skater, nextInput(), FIXED_DT, skateWorld);
    ticks += 1;
  }

  syncSkaterMesh(skaterMesh, skater);

  if (controls) {
    // A proper follow camera arrives in M0-04. Until then the orbit target
    // trails the skater so the prototype is usable by hand.
    controls.target.lerp(new THREE.Vector3(skater.position.x, skater.position.y + 1, skater.position.z), 0.12);
    controls.update();
  }

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
    : "W/Shift push · A/D carve · S brake · Space jump · R reset · P colliders";
}

// Read and driven by the Playwright tests.
window.__atl = {
  build: "m0-03",
  levelId: level.id,
  objectCount: level.objects.length,
  colliderCount: physics.colliderCount,
  fixedDt: FIXED_DT,
  ready: true,
  get ticks() {
    return ticks;
  },
  get frames() {
    return frames;
  },
  get skater() {
    return structuredClone(skater);
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
  reset: () => structuredClone(resetSkater()),

  // Run an input script through the controller in one go, from a fresh
  // spawn, at the fixed timestep. No frames, no clock: this is the same call
  // Vitest makes, so a browser result can be compared with a Node result.
  runScript(segments) {
    const frameInputs = expandScript(segments, FIXED_DT);
    skater = runScript(createSkater(level), frameInputs, FIXED_DT, skateWorld);
    syncSkaterMesh(skaterMesh, skater);
    return structuredClone(skater);
  },

  // Play an input script out across real animation frames, so a screenshot
  // catches the skater mid-run.
  playScript(segments) {
    skater = createSkater(level);
    scriptedFrames = expandScript(segments, FIXED_DT);
    scriptCursor = 0;
    scriptEndState = null;
    return scriptedFrames.length;
  },
  get scriptRunning() {
    return scriptedFrames !== null;
  },
  get scriptEndState() {
    return scriptEndState ? structuredClone(scriptEndState) : null;
  },

  get rendererInfo() {
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  },
};
