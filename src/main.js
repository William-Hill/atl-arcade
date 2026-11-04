import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createRenderer, fitToWindow } from "./render/renderer.js";
import { createLevelLights, createLevelView } from "./render/level-view.js";
import { createDebugColliders } from "./render/debug-colliders.js";
import { createSkaterView } from "./render/skater-view.js";
import { loadSkaterModel } from "./render/skater-model.js";
import { toonSkater } from "./render/toon.js";
import { createSilhouette } from "./render/silhouette.js";
import { createFollowCamera } from "./render/follow-camera.js";
import { advance, createStepper } from "./sim/fixed-step.js";
import { createSkaterEnv } from "./sim/skate/skater.js";
import { createRun, stepRun } from "./sim/skate/run.js";
import { createHud } from "./ui/hud.js";
import { createSkaterSelect, resolveSkater } from "./ui/skater-select.js";
import { BeatClock } from "./audio/beat-clock.js";
import { loadLevel } from "./level/levels.js";
import { createLevelEnv } from "./level/ground.js";
import { buildGeoMeshes } from "./level/geo/geo-mesh.js";
import { terrainOf } from "./level/geo/terrain.js";
import { createGeoLights, createGeoView, loadKitTemplates } from "./render/geo-view.js";
import { createLandmarksView } from "./render/landmarks-view.js";
import { QUALITY, pixelRatioFor, qualityFor, rendererName } from "./render/quality.js";
import { GOVERNOR, createGovernor, currentRung, governorStep, ladderFor } from "./render/governor.js";
import { createSky } from "./render/sky.js";
import { createLitePost, createPost } from "./render/post.js";
import { addTiltShift } from "./render/tilt-shift.js";
import { createPhotoPanel } from "./ui/photo-panel.js";
import { createStreetSigns } from "./render/street-signs.js";
import { createPhysicsWorld, initPhysics, isGeoLevel } from "./physics/world.js";
import { createInput } from "./input/input.js";
import { createTouchInput } from "./input/touch.js";
import { wantsTouch } from "./input/touch-map.js";
import { createLookInput } from "./input/look.js";
import { mapLook } from "./sim/camera.js";
import { createScriptPlayer } from "./input/scripted.js";
import { createCrowd, minGap, stepCrowd } from "./sim/npc/crowd.js";
import { createNpcView } from "./render/npc-view.js";

const params = new URLSearchParams(window.location.search);
// ?level=greybox (default) or ?level=beltline-eastside (alias: beltline).
const level = await loadLevel(params.get("level"));
const geo = isGeoLevel(level);
const env = createLevelEnv(level, { props: params.get("props") !== "0" });
const skaterEnv = createSkaterEnv(level);

const canvas = document.getElementById("stage");
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
// The render tier (src/render/quality.js): low for a software GPU, phone
// for a touch device with a small screen, high for every other GPU.
// ?quality=low|phone|high sets it.
const gpuName = rendererName(renderer);
const device = {
  touch: (navigator.maxTouchPoints ?? 0) > 0 || (window.matchMedia?.("(pointer: coarse)").matches ?? false),
  width: window.screen?.width ?? window.innerWidth,
  height: window.screen?.height ?? window.innerHeight,
};
const quality = geo ? qualityFor(params.get("quality"), gpuName, device) : "low";
const tier = QUALITY[quality];
renderer.setPixelRatio(pixelRatioFor(window.devicePixelRatio, tier.pixelRatio));
// Count the draw calls of the whole frame (all post passes), not only the
// last pass. The frame loop resets the counters.
renderer.info.autoReset = false;
// Draw distance on a geodata level. The fog ends at the far plane, so the
// cut is not visible. On the low tier, 320 m keeps the playtest at 60 FPS
// in headless SwiftShader with video capture on (see docs/decisions.md).
const GEO_FAR = tier.far;
const GEO_FOG_NEAR = tier.fogNear;

// A geodata level gets a day sky, a far fog, and a sun that follows the
// skater. Its meshes are built once and shared with the physics.
const geoMeshes = geo ? buildGeoMeshes(level) : null;
let geoLights = null;
let sky = null;
if (geo) {
  // The low tier has no shadow map: in headless SwiftShader it halved the
  // frame rate. The kit trees carry a shadow disc and the skater a blob.
  renderer.shadowMap.enabled = tier.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (tier.post) {
    // Neutral tone mapping keeps the art colors and rolls off the bright sun.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
  }
  geoLights = createGeoLights({ shadowRadius: tier.shadows ? 70 : 45, shadowMapSize: tier.shadows ? 4096 : 2048 });
  scene.add(geoLights.group);
  // The low tier has no sky dome (a flat horizon color), to keep the
  // headless frame budget. ?sky=0 leaves it out on the high tier too.
  sky = tier.post !== "full" || params.get("sky") === "0" ? null : createSky({ radius: GEO_FAR * 0.9, sunDirection: geoLights.sunDirection, clouds: tier.clouds });
  if (sky) scene.add(sky.mesh);
  const horizon = sky ? sky.fogColor : new THREE.Color(0xbfe4ff);
  scene.background = horizon.clone();
  // ?fog=0 removes the fog (for an overview screenshot).
  scene.fog = params.get("fog") === "0" ? null : new THREE.Fog(horizon, GEO_FOG_NEAR, GEO_FAR);
} else {
  scene.background = new THREE.Color(0x10101c);
  scene.fog = new THREE.Fog(0x10101c, 60, 160);
  scene.add(createLevelLights());
}

// ODbL: a level built from OpenStreetMap shows its attribution on screen.
const attribution = document.getElementById("attribution");
if (attribution && level.attribution) {
  attribution.textContent = level.attribution;
  attribution.hidden = false;
}

// ?lod0=<m> and ?propdist=<m> tune the prop distances (for perf checks).
const numParam = (name) => (params.has(name) && Number.isFinite(Number(params.get(name))) ? Number(params.get(name)) : undefined);
const levelView = geo ? createGeoView(level, geoMeshes, { lod0Distance: numParam("lod0"), drawDistance: numParam("propdist"), groundDetail: tier.detail, markings: tier.detail && params.get("markings") !== "0", kit: tier.detail && params.get("kit") !== "0", depth: params.get("depth") !== "0", interiors: tier.detail && params.get("interiors") !== "0", farTerrain: quality === "low" && params.get("farterrain") !== "0", trees: params.get("trees") !== "kit", wind: params.get("wind") !== "0" }) : createLevelView(level);
scene.add(levelView.root);

// Street name signs at the real intersections (src/level/geo/signs.js).
// ?signs=0 leaves them out.
const streetSigns = geo && params.get("signs") !== "0" ? createStreetSigns(env.props.filter((p) => p.kind === "street_sign")) : null;
if (streetSigns) scene.add(streetSigns.group);

// Landmark models on the real roofs (img2threejs towers, rooftop signs).
// ?landmarks=0 leaves them out.
const landmarks = geo && params.get("landmarks") !== "0" ? createLandmarksView(level, { renderer }) : null;
if (landmarks) {
  scene.add(landmarks.root);
  landmarks.ready.catch((err) => console.error(err));
}

// The street kit (trees, lamps, benches, roof units) loads after the level
// shows. ?props=0 leaves it out.
if (geo && params.get("props") !== "0") {
  loadKitTemplates()
    .then((templates) => levelView.addProps(env.props, templates))
    .catch((err) => {
      levelView.props.error = String(err);
      console.error(err);
    });
}

// NPCs on the trail and the park paths (M1-09). ?npcs=0 leaves them out,
// and ?npcseed=<n> picks another seeded crowd.
const npcSeed = Number(params.get("npcseed") ?? 1) || 1;
const npcsOn = geo && params.get("npcs") !== "0";
let crowd = npcsOn ? createCrowd(level, { seed: npcSeed }) : null;
const npcView = crowd ? createNpcView(crowd) : null;
if (npcView) {
  npcView.sync(crowd);
  scene.add(npcView.group);
}

const skaterView = createSkaterView();
scene.add(skaterView.group);

// A blob shadow under the skater for a level with no shadow map.
let blob = null;
if (geo && !tier.shadows) {
  blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  blob.renderOrder = 1;
  scene.add(blob);
}

// The GLB skater replaces the capsule when it loads. ?skater=<id> picks the
// skater (src/ui/skater-select.js), and ?skater=capsule keeps the capsule.
// The skater gets the toon look (src/render/toon.js); ?toon=0 keeps the GLB
// materials.
const skaterName = resolveSkater(params.get("skater"));
createSkaterSelect(document.body, skaterName);
const skaterModel = { name: skaterName, loaded: false, error: null };
if (skaterName !== "capsule") {
  loadSkaterModel(skaterName)
    .then((loaded) => {
      if (params.get("toon") !== "0") toonSkater(loaded);
      skaterView.attachModel(loaded);
      skaterModel.loaded = true;
    })
    .catch((err) => {
      skaterModel.error = String(err);
      console.error(err);
    });
}

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, geo ? (params.get("fog") === "0" ? 4000 : GEO_FAR) : 500);
// view=follow (default), view=orbit (drag to look), view=fixed (screenshot reference).
const view = params.get("view") ?? "follow";
// ?cam=x,y,z,lookX,lookY,lookZ sets the fixed camera (for screenshots).
const camParam = (params.get("cam") ?? "").split(",").map(Number);
// On a level with terrain each height is over the terrain under that point,
// so a camera from before the terrain still sees the same place.
const terrainY = (x, z) => (geo ? terrainOf(level).height(x, z) : 0);
if (camParam.length === 6 && camParam.every(Number.isFinite)) {
  camera.position.set(camParam[0], camParam[1] + terrainY(camParam[0], camParam[2]), camParam[2]);
  camera.lookAt(camParam[3], camParam[4] + terrainY(camParam[3], camParam[5]), camParam[5]);
} else if (geo) {
  // The fixed view looks at the spawn on the trail from the south-west.
  const [sx, sy, sz] = level.spawn.position;
  camera.position.set(sx - 40, sy + 45, sz + 60);
  camera.lookAt(sx, sy, sz);
} else {
  camera.position.set(-6, 38, 44);
  camera.lookAt(0, 0, 2);
}

let controls = null;
if (view === "orbit") {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  camera.position.set(level.spawn.position[0] - 8, level.spawn.position[1] + 6, level.spawn.position[2] + 10);
}

// The post chain (src/render/post.js): the full chain on the high tier,
// the lite ink pass on the phone tier, none on the low tier.
const postOptions = { fadeNear: GEO_FOG_NEAR * 0.5, fadeFar: GEO_FAR * 0.8, halftone: params.get("halftone") !== "0" };
let post = tier.post === "full" ? createPost(renderer, scene, camera, postOptions) : tier.post === "lite" ? createLitePost(renderer, scene, camera, postOptions) : null;
// Photo mode's tilt-shift blur (src/render/tilt-shift.js): on the full
// chain only, and off in play.
let tiltShift = post && post.kind === "full" ? addTiltShift(post, camera, renderer) : null;
function draw() {
  renderer.info.reset();
  if (post) post.render();
  else renderer.render(scene, camera);
}

// The frame-time governor (src/render/governor.js) steps the phone and high
// tiers down when the frame rate is too low. The low tier is the floor of
// the headless playtest gate, so it has no governor. ?governor=0 turns it off,
// and ?govbudget=<ms> sets the frame budget (for tests and tuning).
const govBudget = Number(params.get("govbudget"));
const govConfig = Number.isFinite(govBudget) && govBudget > 0 ? { ...GOVERNOR, budgetMs: govBudget } : GOVERNOR;
let governor = geo && quality !== "low" && params.get("governor") !== "0" ? createGovernor(ladderFor(tier), govConfig) : null;
function applyRung(rung) {
  renderer.setPixelRatio(pixelRatioFor(window.devicePixelRatio, rung.pixelRatio));
  if (!rung.post && post) {
    post.dispose();
    post = null;
    tiltShift = null;
  }
  resize();
}
function resize() {
  fitToWindow(renderer, camera);
  if (post) post.setSize();
}
resize();
window.addEventListener("resize", resize);

const silhouette = createSilhouette(renderer);

const RAPIER = await initPhysics();
const physics = createPhysicsWorld(RAPIER, level, { geoMeshes });
const debug = createDebugColliders(physics.world);
scene.add(debug.lines);
debug.visible = params.get("debug") === "1";
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyH") debug.visible = !debug.visible;
});

// Simulation.
// Touch controls on a touch screen (?touch=1 forces them on, ?touch=0 off).
const touch = wantsTouch(params.get("touch"), { maxTouchPoints: navigator.maxTouchPoints ?? 0, coarse: window.matchMedia?.("(pointer: coarse)").matches ?? false })
  ? createTouchInput({ parent: document.body })
  : null;
if (touch) document.body.classList.add("touch");
const input = createInput({ target: window, touch });
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
  return input.sample();
}

function simulate(dt) {
  run = stepRun(run, sampleInput(), dt, env, skaterEnv, beat.running ? beat : null);
  skater = run.skater;
  if (crowd) crowd = stepCrowd(crowd, dt, skater.position);
  for (const m of run.moves) events.push({ tick: run.tick, type: "move", ...m });
  if (run.banked) {
    events.push({ tick: run.tick, type: "bank", points: run.banked, score: run.combo.score });
    skaterView.cheer();
  }
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
  if (crowd) crowd = createCrowd(level, { seed: npcSeed });
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

// Mouse drag on the canvas and the right stick turn the follow camera.
let lookInput = null;
if (view === "follow") {
  follow = createFollowCamera(camera, { RAPIER, world: physics.world, skater });
  lookInput = createLookInput({ element: renderer.domElement });
}

// Photo mode (#90, src/ui/photo-panel.js): P or the PHOTO button. The
// simulation stops and a free camera moves while it is open.
const photoLook = lookInput ?? createLookInput({ element: renderer.domElement });
const photo = createPhotoPanel({
  canvas,
  camera,
  tiltShift: () => tiltShift,
  render: draw,
  sampleLook: (dt) => mapLook(photoLook.sample(), dt),
  // The camera height selects the floor below the camera, not a bridge deck above it.
  floor: (x, z, y) => env.sampleGround(x, z, y)?.height ?? null,
  onChange: (open) => {
    if (controls) controls.enabled = !open;
    input.reset();
  },
});

let stepper = createStepper();
let ticks = 0;
let last = performance.now();
let frames = 0;

// Screen-space recorder for the camera test: samples the skater's
// normalized device coordinates every `every` frames.
const recorder = { active: false, every: 10, samples: [] };

// Frame-time sampler for the playtest harness: milliseconds per frame.
const fps = { active: false, frameMs: [] };
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
  if (fps.active) fps.frameMs.push(elapsed * 1000);
  if (renderPaused) {
    requestAnimationFrame(frame);
    return;
  }
  // Photo mode pauses the governor: the blur is slow and the game is stopped.
  if (governor && !photo.isOpen) {
    governor = governorStep(governor, elapsed * 1000);
    if (governor.changed) applyRung(currentRung(governor));
  }

  if (photo.isOpen) {
    // Photo mode stops the simulation and the skater animation.
    stepper = { ...stepper, leftover: 0 };
  } else {
    const stepped = advance(stepper, elapsed);
    stepper = stepped.stepper;
    for (let i = 0; i < stepped.steps; i += 1) simulate(stepper.dt);
    ticks += stepped.steps;
  }

  skaterView.sync(skater, photo.isOpen ? 0 : Math.min(elapsed, 0.1), beat.running ? { time: beat.now(), bpm: beat.bpm } : null);
  if (photo.isOpen) {
    photo.update(Math.min(elapsed, 0.1));
  } else if (controls) {
    controls.target.set(skater.position[0], skater.position[1] + 1, skater.position[2]);
    controls.update();
  }
  if (follow && !photo.isOpen) {
    const dt = Math.min(elapsed, 0.1);
    follow.update(skater, dt, lookInput ? mapLook(lookInput.sample(), dt) : null);
  }
  hud.update(run, now, beat.running ? beat.phase() : null);
  if (geoLights) geoLights.follow(skater.position[0], skater.position[2], skater.position[1]);
  if (blob) {
    // With the skater height, as the controller samples: under a bridge the
    // blob stays on the road, not on the deck.
    const g = env.sampleGround(skater.position[0], skater.position[2], skater.position[1]);
    blob.position.set(skater.position[0], (g ? g.height : 0) + 0.02, skater.position[2]);
  }
  if (levelView.update) levelView.update(camera.position);
  if (sky) sky.update(camera, now / 1000);
  if (streetSigns) streetSigns.update(camera.position);
  if (npcView) npcView.sync(crowd, camera.position);
  draw();
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
  quality,
  gpu: gpuName,
  // The post chain, to tune the effects from the console.
  get post() {
    return post;
  },
  // The render settings now, after any governor step.
  get render() {
    return { quality, pixelRatio: renderer.getPixelRatio(), post: post ? post.kind : null, rung: governor ? governor.rung : null, lastMedianMs: governor ? governor.last : null };
  },
  // Photo mode (#90): open, close, toggle, set({ center, strength }), save().
  photo: {
    get isOpen() {
      return photo.isOpen;
    },
    get state() {
      return photo.state;
    },
    // The blur pass state, or null on the low tier (no blur).
    get blur() {
      return tiltShift ? { enabled: tiltShift.enabled, ...tiltShift.params } : null;
    },
    open: () => photo.open(),
    close: () => photo.close(),
    toggle: () => photo.toggle(),
    set: (params) => photo.set(params),
    save: () => photo.save()
  },
  level: {
    name: level.name,
    format: level.format ?? "greybox",
    objectCount: level.objects.length,
    // Every id that has colliders: the level objects, and for a geodata
    // level, the merged meshes.
    ids: [...level.objects.map((o) => o.id), ...(geoMeshes ? geoMeshes.filter((m) => m.material !== "mural").map((m) => `${m.material}-${m.tile}`) : [])],
    stats: level.stats ?? null,
    bounds: level.bounds,
    spawn: level.spawn,
    get meshCount() {
      return geo ? levelView.meshCount : level.objects.length;
    },
    get props() {
      return geo ? { ...levelView.props } : null;
    },
    signs: streetSigns ? { count: streetSigns.count, names: streetSigns.names } : null,
    kit: geo ? levelView.kit : null,
    get facadeDepth() {
      return geo && levelView.facadeDepth ? { ...levelView.facadeDepth } : null;
    },
    get landmarks() {
      return landmarks ? { ...landmarks.info } : null;
    },
    // The ground under (x, z), from the pure sampler. With `y`, a bridge
    // high over y is left out (the skater is under it).
    sample: (x, z, y) => env.sampleGround(x, z, y),
  },
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
  // The crowd (M1-09), or null on the greybox and with ?npcs=0.
  npcs: crowd
    ? {
        get count() {
          return crowd.npcs.length;
        },
        get onTrail() {
          return crowd.npcs.filter((n) => crowd.lines[n.line].kind === "trail").length;
        },
        get bumps() {
          return crowd.bumps;
        },
        get minGap() {
          return minGap(crowd.npcs);
        },
        get drawCalls() {
          return npcView.drawCalls;
        },
        get drawn() {
          return npcView.drawn;
        },
        get list() {
          return crowd.npcs.map((n) => ({ id: n.id, type: n.type, kind: crowd.lines[n.line].kind, x: n.x, y: n.y, z: n.z, lean: n.lean }));
        },
        // The NPCs on screen: in front of the camera, inside the view, and
        // nearer than the fog end.
        inView() {
          const v = new THREE.Vector3();
          return crowd.npcs.filter((n) => {
            v.set(n.x, n.y + 1, n.z);
            if (v.distanceTo(camera.position) > camera.far * 0.9) return false;
            v.project(camera);
            return v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
          }).map((n) => n.id);
        },
      }
    : null,
  get events() {
    return events;
  },
  get combo() {
    return run.combo;
  },
  beat,
  input: {
    get source() {
      return input.source;
    },
    get gamepadId() {
      return input.gamepadId;
    },
    get bindings() {
      return input.bindings;
    },
    get touch() {
      return Boolean(touch);
    },
  },
  get renderPaused() {
    return renderPaused;
  },
  set renderPaused(v) {
    renderPaused = Boolean(v);
    last = performance.now();
  },
  skaterModel: {
    get name() {
      return skaterModel.name;
    },
    get loaded() {
      return skaterModel.loaded;
    },
    get error() {
      return skaterModel.error;
    },
    get clip() {
      return skaterView.clip;
    },
    get weights() {
      return skaterView.weights;
    },
    // The face decal state: { eyes, mouth }.
    get face() {
      return skaterView.face;
    },
    // Holds the face in one state: holdFace("closed", "smile"). holdFace()
    // gives the face back to the animation.
    holdFace(eyes, mouth) {
      skaterView.holdFace(eyes ? { eyes, mouth } : null);
    },
    // Stops the clips (true) or plays them again (false).
    freezePose(frozen) {
      skaterView.freezePose(frozen);
    },
    // The shader program key of the skater material ("skater-face",
    // "skater-toon-rim", or both).
    get materialKey() {
      const m = skaterView.model;
      return m ? m.skinnedMesh.material.customProgramCacheKey() : null;
    },
    // The model yaw offset: PI when the skater rides backward.
    get facing() {
      return skaterView.facing;
    },
    // The skater mask from a camera in front of it (for the T-pose check).
    silhouette() {
      const m = skaterView.model;
      return m ? Array.from(silhouette(skaterView.group, m.skinnedMesh)) : null;
    },
    // The same mask with the skeleton in the bind pose (the T-pose).
    tposeSilhouette() {
      const m = skaterView.model;
      if (!m) return null;
      m.skinnedMesh.skeleton.pose();
      const mask = Array.from(silhouette(skaterView.group, m.skinnedMesh));
      skaterView.sync(skater, 0);
      return mask;
    },
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
  get cameraLook() {
    return follow ? { ...follow.look } : null;
  },
  // Moves the fixed camera (view=fixed only), for screenshots of things
  // that move, such as the crowd.
  setFixedCamera(x, y, z, lookX, lookY, lookZ) {
    if (view !== "fixed") return false;
    camera.position.set(x, y, z);
    camera.lookAt(lookX, lookY, lookZ);
    return true;
  },
  get cameraPosition() {
    return [camera.position.x, camera.position.y, camera.position.z];
  },
  fps: {
    start() {
      fps.active = true;
      fps.frameMs = [];
    },
    stop() {
      fps.active = false;
      return fps.frameMs;
    },
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

// Autopilot (an automated playtest agent) connects only in a dev build
// (npm run dev) with ?autopilot=1. A production build has no bridge: Vite
// removes this branch, so a link cannot connect a player's page to a port.
if (import.meta.env.DEV && params.get("autopilot") === "1") {
  import("./autopilot/connect.js").then(({ connectAutopilot }) =>
    connectAutopilot({ params, scene, camera, canvas, renderer, atl: window.__atl, level, skaterObject: skaterView.group, threeRevision: THREE.REVISION }),
  );
}
