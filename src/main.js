import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createRenderer, fitToWindow } from "./render/renderer.js";
import { createLevelLights, createLevelView } from "./render/level-view.js";
import { createDebugColliders } from "./render/debug-colliders.js";
import { advance, createStepper } from "./sim/fixed-step.js";
import { GREYBOX } from "./level/greybox.js";
import { createPhysicsWorld, initPhysics } from "./physics/world.js";

const params = new URLSearchParams(window.location.search);
const level = GREYBOX;

const canvas = document.getElementById("stage");
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10101c);
scene.fog = new THREE.Fog(0x10101c, 60, 160);
scene.add(createLevelLights());

const levelView = createLevelView(level);
scene.add(levelView.root);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
const fixedView = params.get("view") === "fixed";
camera.position.set(-6, 38, 44);
camera.lookAt(0, 0, 2);

let controls = null;
if (!fixedView) {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 2);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
}

fitToWindow(renderer, camera);
window.addEventListener("resize", () => fitToWindow(renderer, camera));

const RAPIER = await initPhysics();
const physics = createPhysicsWorld(RAPIER, level);
const debug = createDebugColliders(physics.world);
scene.add(debug.lines);
debug.visible = params.get("debug") === "1";
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyH") debug.visible = !debug.visible;
});

let stepper = createStepper();
let ticks = 0;
let last = performance.now();
let frames = 0;

function frame(now) {
  const elapsed = (now - last) / 1000;
  last = now;

  const stepped = advance(stepper, elapsed);
  stepper = stepped.stepper;
  ticks += stepped.steps;

  if (controls) controls.update();
  renderer.render(scene, camera);
  frames += 1;
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Read by the Playwright tests.
window.__atl = {
  shell: "skate-atl",
  ready: true,
  level: { name: level.name, objectCount: level.objects.length, ids: level.objects.map((o) => o.id) },
  physics: {
    colliderCount: physics.colliderCount,
    collidersById: Object.fromEntries([...physics.colliders].map(([id, list]) => [id, list.length])),
  },
  debug: {
    get visible() {
      return debug.visible;
    },
    set visible(v) {
      debug.visible = v;
    },
    get vertexCount() {
      return debug.vertexCount;
    },
  },
  get ticks() {
    return ticks;
  },
  get frames() {
    return frames;
  },
  get rendererInfo() {
    return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  },
};
