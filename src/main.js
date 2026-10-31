import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createRenderer, fitToWindow } from "./render/renderer.js";
import { createLevelLights, createLevelView } from "./render/level-view.js";
import { createDebugColliders } from "./render/debug-colliders.js";
import { createSkaterView } from "./render/skater-view.js";
import { createFollowCamera } from "./render/follow-camera.js";
import { advance, createStepper } from "./sim/fixed-step.js";
import { createSkaterEnv } from "./sim/skate/skater.js";
import { createRun, stepRun } from "./sim/skate/run.js";
import { createHud } from "./ui/hud.js";
import { BeatClock } from "./audio/beat-clock.js";
import { GREYBOX } from "./level/greybox.js";
import { createLevelEnv } from "./level/ground.js";
import { createPhysicsWorld, initPhysics } from "./physics/world.js";
import { createKeyboard } from "./input/keyboard.js";
import { createScriptPlayer } from "./input/scripted.js";

const params = new URLSearchParams(window.location.search);
const level = GREYBOX;
const env = createLevelEnv(level);
const skaterEnv = createSkaterEnv(level);

const canvas = document.getElementById("stage");
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10101c);
scene.fog = new THREE.Fog(0x10101c, 60, 160);
scene.add(createLevelLights());

const levelView = createLevelView(level);
scene.add(levelView.root);

const skaterView = createSkaterView();
scene.add(skaterView.group);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
// view=follow (default), view=orbit (drag to look), view=fixed (screenshot reference).
const view = params.get("view") ?? "follow";
camera.position.set(-6, 38, 44);
camera.lookAt(0, 0, 2);

let controls = null;
if (view === "orbit") {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  camera.position.set(level.spawn.position[0] - 8, 6, level.spawn.position[2] + 10);
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

// Simulation.
const keyboard = createKeyboard(window);
let run = createRun(level);
let skater = run.skater;
const hud = createHud(document.getElementById("hud"));
// Simulation events for the tests and the playtest harness.
const events = [];

// Beat clock: starts on the first key or pointer press (browser audio
// policy). The beat never gates input; moves that land near a beat earn
// the on-beat bonus and a PERFECT / GOOD tag.
const beat = new BeatClock();
beat.muted = params.get("mute") === "1";
// Call start() on every gesture: a context made too early stays suspended
// until a gesture resumes it.
function startBeat() {
  if (!beat.running) beat.start().catch(() => {});
}
window.addEventListener("keydown", startBeat, { once: false });
window.addEventListener("pointerdown", startBeat);
let script = null;
let scriptResolve = null;

function sampleInput() {
  if (script) {
    const input = script.next();
    if (input) return input;
    const done = scriptResolve;
    script = null;
    scriptResolve = null;
    if (done) done({ ...skater, combo: run.combo });
  }
  return keyboard.sample();
}

function simulate(dt) {
  run = stepRun(run, sampleInput(), dt, env, skaterEnv, beat.running ? beat : null);
  skater = run.skater;
  for (const m of run.moves) events.push({ tick: run.tick, type: "move", ...m });
  if (run.banked) events.push({ tick: run.tick, type: "bank", points: run.banked, score: run.combo.score });
  if (skater.justFell || skater.respawned) events.push({ tick: run.tick, type: "bail" });
  if (skater.respawned) events.push({ tick: run.tick, type: "respawn" });
  if (skater.justSnapped) events.push({ tick: skater.tick, type: "snap", id: skater.grind.id, s: skater.grind.s });
  if (skater.justExited) events.push({ tick: skater.tick, type: "exit", reason: skater.exitReason, position: [...skater.position] });
  if (skater.justFell) events.push({ tick: skater.tick, type: "fall", position: [...skater.position] });
  if (skater.justLanded) events.push({ tick: skater.tick, type: "land", groundId: skater.groundId, speed: skater.speed });
  if (skater.justJumped) events.push({ tick: skater.tick, type: "jump" });
}

let follow = null;

function resetSkater(position = level.spawn.position, yaw = level.spawn.yaw) {
  run = createRun(level, { position, yaw });
  skater = run.skater;
  events.length = 0;
  if (follow) follow.reset(skater);
}

// Plays a scripted input list from a reset skater and resolves with the end
// state. Used by Playwright. Deterministic: one script tick per fixed step.
function runScript(entries, { position, yaw } = {}) {
  resetSkater(position, yaw);
  script = createScriptPlayer(entries);
  return new Promise((resolve) => {
    scriptResolve = resolve;
    if (script.done) {
      script = null;
      scriptResolve = null;
      resolve({ ...skater, combo: run.combo });
    }
  });
}

if (view === "follow") follow = createFollowCamera(camera, { RAPIER, world: physics.world, skater });

let stepper = createStepper();
let ticks = 0;
let last = performance.now();
let frames = 0;

// Screen-space recorder for the camera test: samples the skater's
// normalized device coordinates every `every` frames.
const recorder = { active: false, every: 10, samples: [] };
const projected = new THREE.Vector3();

function projectSkater() {
  projected.set(skater.position[0], skater.position[1] + 0.8, skater.position[2]).project(camera);
  return { x: projected.x, y: projected.y, z: projected.z };
}

// The beat alignment test pauses rendering: the software renderer in
// headless Chromium takes a frame's worth of time and delays timers.
let renderPaused = false;

function frame(now) {
  const elapsed = (now - last) / 1000;
  last = now;
  if (renderPaused) {
    requestAnimationFrame(frame);
    return;
  }

  const stepped = advance(stepper, elapsed);
  stepper = stepped.stepper;
  for (let i = 0; i < stepped.steps; i += 1) simulate(stepper.dt);
  ticks += stepped.steps;

  skaterView.sync(skater);
  if (controls) {
    controls.target.set(skater.position[0], skater.position[1] + 1, skater.position[2]);
    controls.update();
  }
  if (follow) follow.update(skater, Math.min(elapsed, 0.1));
  hud.update(run, now, beat.running ? beat.phase() : null);
  renderer.render(scene, camera);
  frames += 1;
  if (recorder.active && frames % recorder.every === 0) {
    recorder.samples.push({ frame: frames, tick: ticks, ...projectSkater(), wallHit: follow ? follow.lastHit : null, camera: [camera.position.x, camera.position.y, camera.position.z], skater: [...skater.position] });
  }
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
  get skater() {
    return skater;
  },
  get events() {
    return events;
  },
  get combo() {
    return run.combo;
  },
  beat,
  get renderPaused() {
    return renderPaused;
  },
  set renderPaused(v) {
    renderPaused = Boolean(v);
    last = performance.now();
  },
  get skaterRotation() {
    const r = skaterView.group.rotation;
    return { x: r.x, y: r.y, z: r.z };
  },
  get run() {
    return run;
  },
  resetSkater,
  runScript,
  view,
  projectSkater,
  get cameraState() {
    return follow ? follow.state : null;
  },
  get cameraPosition() {
    return [camera.position.x, camera.position.y, camera.position.z];
  },
  recorder: {
    start(every = 10) {
      recorder.active = true;
      recorder.every = every;
      recorder.samples = [];
    },
    stop() {
      recorder.active = false;
      return recorder.samples;
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
