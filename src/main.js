import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createRenderer, fitToWindow } from "./render/renderer.js";
import { createLevelLights, createLevelView } from "./render/level-view.js";
import { createDebugColliders } from "./render/debug-colliders.js";
import { createSkaterView } from "./render/skater-view.js";
import { cloneSkaterModel, fetchSkaterModel, loadSkaterModel } from "./render/skater-model.js";
import { createLoader } from "./ui/loader.js";
import { pbrSkater, toonSkater } from "./render/toon.js";
import { createSilhouette } from "./render/silhouette.js";
import { createFollowCamera } from "./render/follow-camera.js";
import { advance, createStepper } from "./sim/fixed-step.js";
import { createSkaterEnv } from "./sim/skate/skater.js";
import { createRun, stepRun } from "./sim/skate/run.js";
import { createHud } from "./ui/hud.js";
import { createMinimap } from "./ui/minimap.js";
import { createSkaterSelect, resolveSkater } from "./ui/skater-select.js";
import { shortAttribution } from "./ui/layout.js";
import { BeatClock } from "./audio/beat-clock.js";
import { loadLevel, resolveLevelName } from "./level/levels.js";
import { goalsFor } from "./level/goals.js";
import { computeResults, createGoals, goalsJson, stepGoals } from "./sim/skate/goals.js";
import { createResults } from "./ui/results.js";
import { createLevelEnv } from "./level/ground.js";
import { buildGeoMeshes } from "./level/geo/geo-mesh.js";
import { terrainOf } from "./level/geo/terrain.js";
import { createGeoLights, createGeoView, loadPropTemplates } from "./render/geo-view.js";
import { createLandmarksView } from "./render/landmarks-view.js";
import { QUALITY, isPhone, pixelRatioFor, qualityFor, rendererName } from "./render/quality.js";
import { GOVERNOR, createGovernor, currentRung, governorStep, ladderFor } from "./render/governor.js";
import { createSky } from "./render/sky.js";
import { LOOKS, createSkyEnvironment, lookFor, toneMappingOf } from "./render/look.js";
import { labBuildings, labCamera } from "./level/geo/lab.js";
import { createLitePost, createPost } from "./render/post.js";
import { createWeatherView, weatherClock } from "./render/weather-view.js";
import { createRain } from "./render/rain.js";
import { ATLANTA } from "./sim/weather.js";
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
import { carGroundSampler, carPitch, createTraffic, stepTraffic, streetHeightSampler, streetsOnly } from "./sim/traffic/traffic.js";
import { createGeoGroundSampler } from "./level/geo/geo-ground.js";
import { parkedCars } from "./sim/traffic/parking.js";
import { createCarView } from "./render/car-view.js";
import { createCarModelView, loadCarModels } from "./render/car-models.js";
import { createNpcSkaters, skaterObstacles, stepNpcSkaters } from "./sim/npc/skaters.js";
import { NPC_DRAW, createNpcSkatersView } from "./render/npc-skaters-view.js";
import { factsMode, fixtureFacts, loadFacts } from "./facts/client.js";
import { LEVEL_FACTS, factsBase } from "./facts/level-facts.js";
import { createFactCardsView } from "./render/fact-cards-view.js";
import { createFactPopup } from "./ui/fact-popup.js";

const params = new URLSearchParams(window.location.search);
// Start the slow downloads at once, in parallel with the level (#74): the
// physics WASM and the skater GLB. A test that started the GLB after the
// physics gave the same first frame (the WASM compile, not the link, is the
// limit) and a skater 1.6 s later.
const physicsReady = initPhysics();
const skaterName = resolveSkater(params.get("skater"));
const loader = createLoader(document.getElementById("loader"), { skater: skaterName !== "capsule" });
// A phone gets the skater with a 1024 px base color (#74). The tier is not
// known yet (it needs the WebGL renderer), so this uses the same device test
// as the phone tier. ?quality=phone forces it, and ?quality=high keeps 2048 px.
const smallSkater = params.get("quality") === "phone" || (params.get("quality") !== "high" && isPhone({ touch: (navigator.maxTouchPoints ?? 0) > 0 || (window.matchMedia?.("(pointer: coarse)").matches ?? false), width: window.screen?.width ?? window.innerWidth, height: window.screen?.height ?? window.innerHeight }));
const skaterBytes = skaterName !== "capsule" ? fetchSkaterModel(skaterName, (n, total) => loader.progress("skater", n, total), { small: smallSkater }) : null;
// A failed download is reported where the model loads, not here.
skaterBytes?.catch(() => {});
// ?level=greybox (default) or ?level=beltline-eastside (alias: beltline).
const level = await loadLevel(params.get("level"));
performance.mark("atl:level");
loader.step("level");
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
// The city look (src/render/look.js): pbr on the high tier, toon on the
// others. ?look=toon|pbr sets it.
const look = geo ? lookFor(params.get("look"), quality) : "toon";

// A geodata level gets a day sky, a far fog, and a sun that follows the
// skater. Its meshes are built once and shared with the physics.
const geoMeshes = geo ? buildGeoMeshes(level) : null;
performance.mark("atl:meshes");
let geoLights = null;
let sky = null;
if (geo) {
  // The low tier has no shadow map: in headless SwiftShader it halved the
  // frame rate. The kit trees carry a shadow disc and the skater a blob.
  renderer.shadowMap.enabled = tier.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (tier.post || look === "pbr") {
    // Toon: neutral tone mapping keeps the art colors and rolls off the
    // bright sun. Pbr uses the same curve (see src/render/look.js).
    renderer.toneMapping = toneMappingOf(look);
    renderer.toneMappingExposure = LOOKS[look].exposure;
  }
  geoLights = createGeoLights({ shadowRadius: tier.shadows ? 70 : 45, shadowMapSize: tier.shadows ? 4096 : 2048, look });
  scene.add(geoLights.group);
  // The low tier has no sky dome (a flat horizon color), to keep the
  // headless frame budget. ?sky=0 leaves it out on the high tier too.
  sky = tier.post !== "full" || params.get("sky") === "0" ? null : createSky({ radius: GEO_FAR * 0.9, sunDirection: geoLights.sunDirection, clouds: tier.clouds });
  if (sky) scene.add(sky.mesh);
  if (look === "pbr") {
    // The sky environment map: ambient light and reflections. A tier with
    // no sky dome gets one made only for the map.
    const envSky = sky ?? createSky({ radius: 400, sunDirection: geoLights.sunDirection });
    scene.environment = createSkyEnvironment(renderer, envSky);
    scene.environmentIntensity = LOOKS.pbr.environment;
    if (!sky) {
      envSky.mesh.geometry.dispose();
      envSky.mesh.material.dispose();
    }
  }
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
  // A compact screen shows the short credit; a tap shows the full text (#73).
  const short = Object.assign(document.createElement("button"), { type: "button", className: "attr-short", textContent: shortAttribution(level.attribution) });
  const full = Object.assign(document.createElement("span"), { id: "attr-full", className: "attr-full", textContent: level.attribution });
  short.setAttribute("aria-expanded", "false");
  short.setAttribute("aria-controls", full.id);
  short.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = attribution.classList.toggle("open");
    short.setAttribute("aria-expanded", String(open));
    // A tap or a mouse click (detail > 0) removes the focus, so the Space key
    // jumps and does not toggle the credit. A keyboard user keeps the focus.
    if (e.detail > 0) short.blur();
  });
  attribution.replaceChildren(short, full);
  attribution.hidden = false;
}
// ?dev=1 or ?debug=1 shows the developer hints.
if (params.get("dev") === "1" || params.get("debug") === "1") document.body.classList.add("dev");

// ?lod0=<m> and ?propdist=<m> tune the prop distances (for perf checks).
const numParam = (name) => (params.has(name) && Number.isFinite(Number(params.get(name))) ? Number(params.get(name)) : undefined);
const levelView = geo ? createGeoView(level, geoMeshes, { lod0Distance: numParam("lod0"), drawDistance: numParam("propdist"), groundDetail: tier.detail, markings: tier.detail && params.get("markings") !== "0", aprons: tier.detail && params.get("aprons") !== "0", kit: tier.detail && params.get("kit") !== "0", depth: params.get("depth") !== "0", interiors: tier.detail && params.get("interiors") !== "0", farTerrain: quality === "low" && params.get("farterrain") !== "0", trees: params.get("trees") !== "kit", wind: params.get("wind") !== "0", season: params.get("season") ?? "summer", look }) : createLevelView(level);
scene.add(levelView.root);
performance.mark("atl:view");

// The day and season weather (src/sim/weather.js, render/weather-view.js):
// the sun, the sky, the fog, the windows, and the wet streets follow the
// date and the time of day at the level's own latitude. ?date=MM-DD and
// ?time=HH.HH set the clock, ?weather=clear|clouds|rain|storm picks the
// weather, ?timescale=<s clock / s real> speeds the clock, and ?weather=0
// turns the system off.
let weatherView = null;
let rain = null;
if (geo && params.get("weather") !== "0") {
  rain = createRain({ count: quality === "high" ? 1800 : 600 });
  scene.add(rain.mesh);
  weatherView = createWeatherView({
    scene,
    renderer,
    geoLights,
    sky,
    levelView,
    fog: { near: GEO_FOG_NEAR, far: GEO_FAR },
    place: level.origin ?? ATLANTA,
    clock: weatherClock(params),
    exposureBase: 1.05,
  });
}

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
  loadPropTemplates({ glbTrees: look === "pbr" && params.get("glbtrees") !== "0" })
    .then((templates) => levelView.addProps(env.props, templates, { renderer: params.get("impostors") !== "0" ? renderer : null }))
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

// Parked cars and calm traffic on the main streets (#132). ?cars=0 leaves
// them out, ?traffic=0 keeps only the parked cars, and ?carseed=<n> picks
// another seeded traffic. A car is a solid box for the skater: the
// controller bonks or slides on it as on a wall.
const carsOn = geo && params.get("cars") !== "0";
const carSeed = Number(params.get("carseed") ?? 1) || 1;
const levelSample = env.sampleGround;
const levelTerrain = geo ? terrainOf(level) : null;
// The car heights come from the streets alone (streetsOnly).
const carHeight = carsOn ? streetHeightSampler(createGeoGroundSampler(streetsOnly(level)), (x, z) => (levelTerrain && !levelTerrain.flat ? levelTerrain.height(x, z) : 0)) : null;
const parked = carsOn
  ? parkedCars(level, levelSample, { heightAt: (x, z) => carHeight(x, z, -Infinity) }).map((c) => ({ ...c, pitch: carPitch(c, (x, z) => carHeight(x, z, c.y)) }))
  : [];
const makeTraffic = () => createTraffic(level, { seed: carSeed, heightAt: carHeight });
let traffic = carsOn && params.get("traffic") !== "0" ? makeTraffic() : null;
const carView = carsOn ? createCarView(parked, traffic ? traffic.cars : [], { pitchAt: (c) => carPitch(c, (x, z) => carHeight(x, z, c.y)) }) : null;
if (carView) {
  carView.update({ x: level.spawn.position[0], z: level.spawn.position[2] }, traffic?.cars);
  scene.add(carView.mesh);
  env.sampleGround = carGroundSampler(levelSample, parked, () => (traffic ? traffic.cars : []));
  // The pbr look swaps the near cars for the rigged GLB vehicles
  // (src/render/car-models.js). ?carglb=0 keeps the kit cars.
  if (look === "pbr" && params.get("carglb") !== "0") {
    const cars = [...parked, ...(traffic ? traffic.cars : [])];
    loadCarModels([...new Set(cars.map((c) => c.kind))])
      .then((models) => {
        const view = createCarModelView(models, cars);
        scene.add(view.group);
        carView.setModels(view);
      })
      .catch((err) => {
        carView.info.modelError = String(err);
        console.error(err);
      });
  }
}

// Fact cards (M1-07): 3 cards on the trail, from the open-data-atl site.
// The cards show at once with the fixture text; a live text replaces it when
// the call returns. ?facts=fixture|live|0 sets the mode (src/facts/client.js).
const facts = { mode: factsMode(params.get("facts"), { webdriver: Boolean(navigator.webdriver) }), cards: [], live: "none" };
const factData = facts.mode !== "off" && Object.hasOwn(LEVEL_FACTS, level.name) ? await LEVEL_FACTS[level.name]() : null;
if (factData) {
  facts.cards = fixtureFacts(factData.specs, factData.fixture).map((card, i) => {
    const [x, z] = factData.specs[i].at;
    const g = env.sampleGround(x, z);
    return { ...card, position: [x, g ? g.height : 0, z] };
  });
  if (facts.mode === "live") {
    facts.live = "pending";
    loadFacts(factData.specs, factData.fixture, { base: factsBase(import.meta.env.DEV) }).then((loaded) => {
      facts.cards = facts.cards.map((c, i) => ({ ...loaded[i], position: c.position }));
      facts.live = loaded.some((c) => c.origin === "live") ? "live" : "fixture";
    });
  }
}
const factCardsView = facts.cards.length ? createFactCardsView(facts.cards) : null;
if (factCardsView) scene.add(factCardsView.group);
const factPopup = facts.cards.length ? createFactPopup(document.body) : null;
const factCardSpots = () => facts.cards.map((c) => ({ id: c.id, position: c.position }));

const skaterView = createSkaterView();
scene.add(skaterView.group);

// NPC skaters (#134): other skaters on the trail, on the same controller as
// the player. On by default on a geodata level; ?skaters=0 turns them off,
// and ?skaters=1 turns them on for the greybox. Each skater GLB is parsed
// once: the player and the NPCs share the parse.
const skatersOn = params.get("skaters") === "1" || (geo && params.get("skaters") !== "0");
let npcSkaters = skatersOn ? createNpcSkaters(level, { env, avoid: crowd ? crowd.npcs : [] }) : null;
// One download for each model: the NPCs of one model share the bytes.
const npcByteCache = new Map();
const npcBytes = (model) => {
  if (model === skaterName) return skaterBytes;
  if (!npcByteCache.has(model)) {
    const bytes = fetchSkaterModel(model, null, { small: smallSkater });
    // A failed download is reported where the model loads, not here.
    bytes.catch(() => {});
    npcByteCache.set(model, bytes);
  }
  return npcByteCache.get(model);
};
const npcSkatersView = npcSkaters ? createNpcSkatersView(npcSkaters, { load: (model) => cloneSkaterModel(model, npcBytes(model)), toon: params.get("toon") !== "0", draw: NPC_DRAW[quality] ?? NPC_DRAW.low, look }) : null;
if (npcSkatersView) scene.add(npcSkatersView.group);

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
createSkaterSelect(document.body, skaterName);
const skaterModel = { name: skaterName, loaded: false, error: null };
if (skaterName !== "capsule") {
  loadSkaterModel(skaterName, skaterBytes)
    .then((loaded) => {
      loader.step("skater");
      // The look picks the skater's materials: toon swap + ink hull, or the
      // pbr env-lit standard materials. ?toon=0 keeps the raw GLB shading.
      if (params.get("toon") !== "0") (look === "pbr" ? pbrSkater : toonSkater)(loaded);
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
// ?lab=building&kind=<style>&pick=<n>&labview=<view> (src/level/geo/lab.js)
// sets the fixed camera on one building, for the art loop.
const labBuilding = geo && params.get("lab") === "building" ? labBuildings(level, params.get("kind") || null)[Number(params.get("pick") ?? 0)] ?? null : null;
const camParam = labBuilding ? labCamera(labBuilding, params.get("labview") ?? "street", level, (x, z) => terrainOf(level).height(x, z)) : (params.get("cam") ?? "").split(",").map(Number);
// On a level with terrain each height is over the terrain under that point,
// so a camera from before the terrain still sees the same place.
const terrainY = (x, z) => (geo ? terrainOf(level).height(x, z) : 0);
// The place a fixed camera looks at, over the terrain: the shadow box goes
// there (see the frame loop).
const shadowFocus = view === "fixed" && camParam.length === 6 && camParam.every(Number.isFinite) ? [camParam[3], camParam[4] + terrainY(camParam[3], camParam[5]), camParam[5]] : null;
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
// The pbr look has no halftone dots: on glass and in shade they read as speckle
// (docs/art-loop/reports/brick-loft-r0-judge.md).
const postOptions = { fadeNear: GEO_FOG_NEAR * 0.5, fadeFar: GEO_FAR * 0.8, halftone: look !== "pbr" && params.get("halftone") !== "0", look };
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

performance.mark("atl:scene");
const RAPIER = await physicsReady;
performance.mark("atl:physics");
loader.step("physics");
const physics = createPhysicsWorld(RAPIER, level, { geoMeshes });
performance.mark("atl:world");
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
let run = createRun(level, { cards: factCardSpots() });
let skater = run.skater;
const hud = createHud(document.getElementById("hud"), { touch: Boolean(touch) });
// Goals, the run timer, and the results screen (M1-05). The goal list is
// data per level (src/level/goals.js). ?run=free turns the timer off.
const goalDef = params.get("run") === "free" ? null : goalsFor(resolveLevelName(params.get("level")));
let goals = goalDef ? createGoals(goalDef) : null;
// The fact cards for the goal list. The run collects the cards on the trail
// (run.cards, #17). collectFactCard(id) also adds a card, for the tests. A
// card counts once, by its id; the goal module reads only the count.
const factCards = new Set();
const cardCount = () => new Set([...run.cards.collected, ...factCards]).size;
function collectFactCard(id) {
  if (!goals || goals.ended || factCards.has(id)) return false;
  factCards.add(id);
  events.push({ tick: run.tick, type: "card", id, count: cardCount() });
  return true;
}
const results = goalDef ? createResults(document.body, { title: level.title ?? "", onReplay: () => resetSkater() }) : null;
// The minimap (#86) on a geodata level. ?minimap=0 leaves it out, and
// ?minimap=north or ?minimap=heading sets the mode.
const minimapParam = params.get("minimap");
const minimap = geo && minimapParam !== "0" ? createMinimap(document.body, level, { mode: ["north", "heading"].includes(minimapParam) ? minimapParam : undefined }) : null;
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
  // After the run ends the skater gets no input and rolls to a stop.
  const sampled = sampleInput();
  run = stepRun(run, goals && goals.ended ? {} : sampled, dt, env, skaterEnv, beat.running ? beat : null);
  skater = run.skater;
  if (goals && !goals.ended) {
    goals = stepGoals(goals, run, goalDef, dt, { cards: cardCount() });
    for (const id of goals.justCleared) events.push({ tick: run.tick, type: "gap", id });
    if (goals.ended) events.push({ tick: run.tick, type: "run-end", ...goalsJson(goals, goalDef) });
  }
  if (crowd) crowd = stepCrowd(crowd, dt, skater.position, npcSkaters ? skaterObstacles(npcSkaters) : []);
  if (traffic) traffic = stepTraffic(traffic, dt, skater.position);
  if (npcSkaters) npcSkaters = stepNpcSkaters(npcSkaters, dt, env, skaterEnv, { player: skater.position, crowd: crowd ? crowd.npcs : [], beat: beat.running ? { time: beat.now(), bpm: beat.bpm } : null });
  for (const m of run.moves) events.push({ tick: run.tick, type: "move", ...m });
  if (run.banked) {
    events.push({ tick: run.tick, type: "bank", points: run.banked, score: run.combo.score });
    skaterView.cheer();
  }
  if (skater.justFell || skater.respawned) events.push({ tick: run.tick, type: "bail" });
  if (skater.respawned) events.push({ tick: run.tick, type: "respawn" });
  for (const id of run.factsCollected) {
    events.push({ tick: run.tick, type: "fact", id, count: run.cards.count });
    const card = facts.cards.find((c) => c.id === id);
    if (card && factPopup) factPopup.show(card, performance.now(), { count: run.cards.count, total: run.cards.total });
  }
  if (skater.justSnapped) events.push({ tick: skater.tick, type: "snap", id: skater.grind.id, s: skater.grind.s });
  if (skater.justExited) events.push({ tick: skater.tick, type: "exit", reason: skater.exitReason, position: [...skater.position] });
  if (skater.justFell) events.push({ tick: skater.tick, type: "fall", position: [...skater.position] });
  if (skater.justLanded) events.push({ tick: skater.tick, type: "land", groundId: skater.groundId, speed: skater.speed });
  if (skater.justJumped) events.push({ tick: skater.tick, type: "jump" });
}

let follow = null;

function resetSkater(position = level.spawn.position, yaw = level.spawn.yaw) {
  run = createRun(level, { position, yaw, cards: factCardSpots() });
  skater = run.skater;
  if (goalDef) {
    goals = createGoals(goalDef);
    factCards.clear();
    results.hide();
  }
  if (crowd) crowd = createCrowd(level, { seed: npcSeed });
  if (traffic) traffic = makeTraffic();
  if (npcSkaters) npcSkaters = createNpcSkaters(level, { env, avoid: crowd ? crowd.npcs : [] });
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

// The skater height on the screen, as a fraction of the screen height
// (feet to 1.7 m), for the phone layout test (#73).
function skaterScreenHeight() {
  const feet = new THREE.Vector3(skater.position[0], skater.position[1], skater.position[2]).project(camera);
  const head = new THREE.Vector3(skater.position[0], skater.position[1] + 1.7, skater.position[2]).project(camera);
  return Math.abs(head.y - feet.y) / 2;
}

function projectSkater() {
  projected.set(skater.position[0], skater.position[1] + 0.8, skater.position[2]).project(camera);
  return { x: projected.x, y: projected.y, z: projected.z };
}

// The beat alignment test pauses rendering: the software renderer in
// headless Chromium takes a frame's worth of time and delays timers.
let renderPaused = false;

// The NPC skater programs compile once, after the NPC models load.
let npcWarm = false;

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
  hud.update(run, now, beat.running ? beat.phase() : null, goals);
  if (results && goals.ended && !results.shown) results.show(computeResults(goalsJson(goals, goalDef), goalDef));
  if (minimap) minimap.update(skater);
  if (factCardsView) factCardsView.update(run.cards.collected, now / 1000);
  if (factPopup) factPopup.update(now);
  // A fixed camera (a screenshot or the lab) gets the shadow box at the place
  // it looks at; the skater can be far away.
  if (geoLights && shadowFocus) geoLights.follow(shadowFocus[0], shadowFocus[2], shadowFocus[1]);
  else if (geoLights) geoLights.follow(skater.position[0], skater.position[2], skater.position[1]);
  if (blob) {
    // With the skater height, as the controller samples: under a bridge the
    // blob stays on the road, not on the deck.
    const g = env.sampleGround(skater.position[0], skater.position[2], skater.position[1]);
    blob.position.set(skater.position[0], (g ? g.height : 0) + 0.02, skater.position[2]);
  }
  if (levelView.update) levelView.update(camera.position);
  if (sky) sky.update(camera, now / 1000);
  if (weatherView) weatherView.update(elapsed, camera);
  if (rain) rain.update(camera, now / 1000, weatherView?.state, renderer.domElement.height);
  if (streetSigns) streetSigns.update(camera.position);
  if (npcView) npcView.sync(crowd, camera.position);
  if (carView) carView.update(camera.position, traffic?.cars);
  if (npcSkatersView && !npcWarm && npcSkatersView.loaded + npcSkatersView.failed === npcSkaters.npcs.length) {
    npcWarm = true;
    npcSkatersView.warm(renderer, camera, scene).catch(() => {});
  }
  if (npcSkatersView) npcSkatersView.sync(npcSkaters, photo.isOpen ? 0 : Math.min(elapsed, 0.1), beat.running ? { time: beat.now(), bpm: beat.bpm } : null, camera.position);
  draw();
  frames += 1;
  if (frames === 1) {
    loader.hide();
    performance.mark("atl:first-frame");
  }
  if (recorder.active && frames % recorder.every === 0) {
    recorder.samples.push({ frame: frames, tick: ticks, ...projectSkater(), wallHit: follow ? follow.lastHit : null, camera: [camera.position.x, camera.position.y, camera.position.z], skater: [...skater.position] });
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Read by the Playwright tests.
window.__atl = {
  // The far tree impostors (tree-impostors.js): atlas bytes, bake time, kinds.
  get trees() {
    return geo && levelView.treeCost ? { ...levelView.treeCost } : null;
  },
  shell: "skate-atl",
  ready: true,
  quality,
  look,
  // The lab building (?lab=building), for the lab spec and the judge.
  lab: labBuilding ? { id: labBuilding.id, name: labBuilding.name ?? null, height: labBuilding.height } : null,
  // Tune the light from the console or a test, for example
  // __atl.tuneLook({ toneMapping: "Neutral", exposure: 1.2, sun: 3 }).
  tuneLook(t = {}) {
    if (t.toneMapping) renderer.toneMapping = THREE[`${t.toneMapping}ToneMapping`];
    if (t.exposure !== undefined) renderer.toneMappingExposure = t.exposure;
    if (t.environment !== undefined) scene.environmentIntensity = t.environment;
    if (geoLights && t.sun !== undefined) geoLights.sun.intensity = t.sun;
    if (geoLights && t.hemisphere !== undefined) geoLights.group.children.find((c) => c.isHemisphereLight).intensity = t.hemisphere;
    return { toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, environment: scene.environmentIntensity, sun: geoLights?.sun.intensity };
  },
  gpu: gpuName,
  // The post chain, to tune the effects from the console.
  get post() {
    return post;
  },
  // Debug handles for the sky dome and the scene (weather tuning).
  get scene() {
    return scene;
  },
  get sky() {
    return sky;
  },
  // The render settings now, after any governor step.
  get render() {
    return { quality, pixelRatio: renderer.getPixelRatio(), post: post ? post.kind : null, rung: governor ? governor.rung : null, lastMedianMs: governor ? governor.last : null };
  },
  // The day/season weather (src/render/weather-view.js): the kind, the
  // clock, the sun elevation, and the window/wet/rain factors. Null on the
  // greybox level or with ?weather=0.
  get weather() {
    return weatherView ? weatherView.info() : null;
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
    get terrainLod() {
      return geo && levelView.terrainLod ? { ...levelView.terrainLod } : null;
    },
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
  // The minimap (#86), or null on the greybox and with ?minimap=0.
  minimap: minimap
    ? {
        get state() {
          return { ...minimap.state };
        },
        icons: minimap.icons,
        setMode: minimap.setMode,
        setHidden: minimap.setHidden,
      }
    : null,
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
  // The cars (#132), or null on the greybox and with ?cars=0.
  cars: carView
    ? {
        parked: parked.length,
        get moving() {
          return traffic ? traffic.cars.length : 0;
        },
        get lanes() {
          return traffic ? traffic.lanes.length : 0;
        },
        get drawCalls() {
          return carView.drawCalls;
        },
        get drawn() {
          return carView.info.drawn;
        },
        // The near cars drawn as rigged GLBs (pbr look), and the load error.
        get models() {
          return carView.models ? { kinds: carView.models.drawCalls, drawn: carView.info.models } : { error: carView.info.modelError ?? null };
        },
        get lod0() {
          return carView.info.lod0;
        },
        get triangles() {
          return carView.info.triangles;
        },
        // The smallest distance from a car body to the skater in the last
        // step (m), and the count of yields to the skater.
        get minSkaterGap() {
          return traffic ? traffic.minSkaterGap : Infinity;
        },
        // The smallest gap since the last reset (m).
        get closest() {
          return traffic ? traffic.closest : Infinity;
        },
        get yields() {
          return traffic ? traffic.yields : 0;
        },
        get list() {
          return traffic ? traffic.cars.map((c) => ({ id: c.id, kind: c.kind, lane: c.lane, x: c.x, y: c.y, z: c.z, yaw: c.yaw, speed: c.speed, yielding: c.yielding })) : [];
        },
        parkedList: parked.map((c) => ({ kind: c.kind, x: c.x, y: c.y, z: c.z, yaw: c.yaw })),
        // The ground sample at (x, z) with the cars, for the tests.
        sample: (x, z, y) => env.sampleGround(x, z, y),
      }
    : null,
  // The NPC skaters (#134), or null with ?skaters=0 and on the greybox.
  skaters: npcSkaters
    ? {
        get count() {
          return npcSkaters.npcs.length;
        },
        get loaded() {
          return npcSkatersView.loaded;
        },
        get failed() {
          return npcSkatersView.failed;
        },
        get drawn() {
          return npcSkatersView.drawn;
        },
        get drawCalls() {
          return npcSkatersView.drawCalls;
        },
        get list() {
          return npcSkaters.npcs.map((n) => ({ id: n.id, model: n.spec.model, outfit: n.spec.outfit, position: [...n.skater.position], state: n.skater.state, speed: n.skater.speed, style: n.skater.style ? n.skater.style.name : null, groundId: n.skater.groundId, clip: npcSkatersView.clipOf(n.id), visible: npcSkatersView.visible(n.id), stats: { ...n.stats } }));
        },
      }
    : null,
  get events() {
    return events;
  },
  // Fact cards (M1-07). `collected` is the count in this run (the same as
  // run.cards.count), for the goal list (#15) and the tests.
  facts: {
    mode: facts.mode,
    get live() {
      return facts.live;
    },
    get collected() {
      return run.cards.count;
    },
    get total() {
      return run.cards.total;
    },
    get cards() {
      return facts.cards.map((c) => ({ id: c.id, text: c.text, dataset: c.dataset, sourceUrl: c.sourceUrl, origin: c.origin, position: [...c.position], collected: run.cards.collected.includes(c.id) }));
    },
    get popup() {
      return factPopup ? factPopup.state : null;
    },
    get visibleCards() {
      return factCardsView ? factCardsView.visibleCount : 0;
    },
  },
  get combo() {
    return run.combo;
  },
  // Goals and the run timer (M1-05), or null with ?run=free.
  goals: goalDef
    ? {
        def: goalDef,
        get state() {
          return goals;
        },
        // The run JSON, and the results computed from it.
        get json() {
          return goalsJson(goals, goalDef);
        },
        get results() {
          return computeResults(goalsJson(goals, goalDef), goalDef);
        },
        get shown() {
          return results.shown;
        },
        collectCard: collectFactCard,
        // Sets the time left (for tests): setTimeLeft(0) ends the run when
        // no combo is open.
        setTimeLeft(seconds) {
          goals = { ...goals, time: Math.max(0, goalDef.time - seconds) };
        },
        replay: () => resetSkater(),
      }
    : null,
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
    // True when the 1024 px phone variant loaded.
    small: smallSkater,
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
  skaterScreenHeight,
  get fov() {
    return camera.fov;
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
