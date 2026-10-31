import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createRenderer, fitToWindow } from "./render/renderer.js";
import { createShellCamera, createShellScene } from "./render/shell-scene.js";
import { advance, createStepper } from "./sim/fixed-step.js";

const canvas = document.getElementById("stage");
const renderer = createRenderer(canvas);
const camera = createShellCamera();
const { scene, marker } = createShellScene();

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.05;

fitToWindow(renderer, camera);
window.addEventListener("resize", () => fitToWindow(renderer, camera));

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

  // Nothing simulates yet. The marker spins off the tick count so the shell
  // proves the fixed-step loop is driving the frame, not the frame rate.
  marker.rotation.y = ticks * (1 / 60) * 0.6;

  controls.update();
  renderer.render(scene, camera);
  frames += 1;
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Read by the Playwright shell test.
window.__atl = {
  shell: "m0-01",
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
