import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";
import { cloneSkaterModel, wrapModel } from "../render/skater-model.js";
import { toonSkater } from "../render/toon.js";
import { ANIM, grooveRate } from "../render/skater-anim.js";
import { BEAT } from "../sim/skate/constants.js";

// Test page for the Meshy text-to-motion test (#293):
// dance-compare.html?dance=bankhead (or prep).
// Each column is one skater and one clip source: the hand-keyed clip of the
// game (dance_<dance>) or the Meshy clip (assets/dances/meshy-293/<dance>/).
// ?cols=<skater>:<set>:<dance>,... picks other columns. <set> "hand" is the
// hand-keyed clip in the skater GLB; another <set> is a folder under
// assets/dances/ (for example meshy-293-r2 or meshy-293-lib).
// ?model=pbr shows the PBR Nia of commit cd8310e (2026-11-07), which has its
// own rig (other joint positions and bone axes). scripts/dance-pbr-videos.mjs
// puts that model and the clips retargeted to its rig in
// node_modules/.cache/pbr-nia/ (not in git). There, <set> "hand" is the
// current hand keys rekeyed on the PBR rig, "own" is the older dance clip in
// the PBR GLB, and a Meshy <set> is the Meshy clip retargeted to the PBR rig.
// The PBR model keeps its PBR materials (no toon shader).
// The page shows the raw clips with no procedural layers (#291), so the two
// sources are compared on the same terms. The clips play at the game tempo.
// __cmp.sheet(cell) draws a contact sheet (rows = times in beats).
// __cmp.frame(beats, cell) draws one strip at one time, for the videos.

// Every test clip GLB under assets/dances/<set>/<dance>/<skater>.glb.
const CLIP_URLS = import.meta.glob("../../assets/dances/*/*/*.glb", { query: "?url", import: "default", eager: true });

function clipUrl(set, dance, skater) {
  return CLIP_URLS[`../../assets/dances/${set}/${dance}/${skater}.glb`] ?? null;
}

const params = new URLSearchParams(window.location.search);
const dance = params.get("dance") ?? "bankhead";
const ROWS = (params.get("beats") ?? "0,0.5,1,1.5").split(",").map(Number);
const VIEW = params.get("view") ?? "front";
const BPM = BEAT.bpm;
const PBR = params.get("model") === "pbr";
const PBR_DIR = "/node_modules/.cache/pbr-nia";

const canvas = document.getElementById("stage");
const labels = document.getElementById("labels");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
const scene = new THREE.Scene();
if (PBR) {
  renderer.toneMapping = THREE.NeutralToneMapping;
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
}
scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 5, 2);
scene.add(sun);
// The ground: the wheels must touch it.
const ground = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), new THREE.MeshStandardMaterial({ color: 0x5a5a6e, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);

const SPECS = (params.get("cols") ?? ["nia", "marcus"].flatMap((k) => [`${k}:hand:${dance}`, `${k}:meshy-293:${dance}`]).join(","))
  .split(",")
  .map((c) => {
    const [skater, set, d] = c.split(":");
    return { skater, set, dance: d };
  });
const title = params.get("title") ?? dance;

const out = { ready: false, error: null, dance: title, rows: ROWS, bpm: BPM, cols: [] };
window.__cmp = out;

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
const gltfCache = new Map();
function loadGltf(url) {
  if (!gltfCache.has(url)) {
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    gltfCache.set(url, loader.loadAsync(url));
  }
  return gltfCache.get(url);
}

// The PBR Nia: a new copy of the scene for each column, with its own clips.
async function clonePbrModel() {
  const gltf = await loadGltf(`${PBR_DIR}/skater.glb`);
  const scene3d = cloneSkinned(gltf.scene);
  let skinnedMesh = null;
  scene3d.traverse((o) => {
    if (o.isSkinnedMesh && !skinnedMesh) skinnedMesh = o;
    // The PBR GLB has a helper sphere with no skin; hide it.
    if (o.isMesh && !o.isSkinnedMesh) o.visible = false;
  });
  return { root: wrapModel(scene3d), skinnedMesh, animations: gltf.animations };
}

async function loadTestClip(spec) {
  if (PBR) {
    const url = spec.set === "hand" ? `${PBR_DIR}/hand-clips.glb` : `${PBR_DIR}/meshy/${spec.set}/${spec.dance}.glb`;
    const gltf = await loadGltf(url);
    const name = spec.set === "hand" ? `dance_${spec.dance}` : `dance_${spec.dance}_meshy`;
    const clip = gltf.animations.find((c) => c.name === name);
    if (!clip) throw new Error(`no ${name} clip in ${url}`);
    return clip;
  }
  const url = clipUrl(spec.set, spec.dance, spec.skater);
  if (!url) throw new Error(`no clip file for ${spec.skater}:${spec.set}:${spec.dance}`);
  const gltf = await new GLTFLoader().loadAsync(url);
  const clip = gltf.animations.find((c) => c.name === `dance_${spec.dance}_meshy`);
  if (!clip) throw new Error(`no dance_${spec.dance}_meshy clip in ${url}`);
  return clip;
}

const SET_LABEL = { own: "hand keys, old (11-07)", hand: "hand keys", "meshy-293": "Meshy round 1 (prime)", "meshy-293-r2": "Meshy round 2 (swift)", "meshy-293-lib": "Meshy library" };

async function makeCol(spec) {
  const model = PBR ? await clonePbrModel() : await cloneSkaterModel(spec.skater);
  if (!PBR) toonSkater(model);
  let clip;
  if (spec.set === "own" || (spec.set === "hand" && !PBR)) clip = model.animations.find((c) => c.name === `dance_${spec.dance}`);
  else clip = await loadTestClip(spec);
  if (!clip) throw new Error(`${spec.skater}: no clip for ${spec.set}:${spec.dance}`);
  const mixer = new THREE.AnimationMixer(model.root);
  const action = mixer.clipAction(clip);
  action.play();
  model.root.visible = false;
  scene.add(model.root);
  const source = spec.set === "hand" || spec.set === "own" ? "hand" : "meshy";
  // One dance and one Meshy set: "nia Meshy". More dances: "<dance> <set>".
  // One dance and more Meshy sets: "<skater> <set>".
  const manyDances = new Set(SPECS.map((x) => x.dance)).size > 1;
  const manySets = PBR || new Set(SPECS.filter((x) => x.set !== "hand").map((x) => x.set)).size > 1;
  const setLabel = PBR && spec.set === "hand" ? "hand keys, now (#292)" : (SET_LABEL[spec.set] ?? spec.set);
  const who = PBR ? "PBR Nia" : spec.skater;
  const label = manyDances ? `${spec.dance} ${setLabel}` : manySets ? `${who} ${setLabel}` : `${spec.skater} ${source === "hand" ? "hand keys" : "Meshy"}`;
  return { ...spec, source, model, mixer, action, clip, label };
}

let cols = [];
try {
  for (const spec of SPECS) cols.push(await makeCol(spec));
  out.cols = cols.map((c) => ({ label: c.label, duration: c.clip.duration, tracks: c.clip.tracks.length }));
  out.ready = true;
} catch (err) {
  out.error = String(err?.message ?? err);
}

// Sets the pose of a column at `beats` game beats from the clip start.
// The clip time runs at grooveRate (one clip beat of ANIM.clipBeat s = one game beat).
function poseAt(c, beats) {
  const t = ((beats * 60) / BPM) * grooveRate(BPM);
  c.action.time = t % c.clip.duration;
  c.mixer.update(0);
  c.model.root.updateMatrixWorld(true);
}

// The lowest wheel point of the skinned mesh above the ground (cm), from the
// skinned vertex positions near the feet. 0 means the wheels touch the ground.
const tmp = new THREE.Vector3();
function lowestPointCm(c) {
  const mesh = c.model.skinnedMesh;
  const pos = mesh.geometry.attributes.position;
  let low = Infinity;
  const step = Math.max(1, Math.floor(pos.count / 4000));
  for (let i = 0; i < pos.count; i += step) {
    mesh.getVertexPosition(i, tmp);
    tmp.applyMatrix4(mesh.matrixWorld);
    if (tmp.y < low) low = tmp.y;
  }
  return +(low * 100).toFixed(1);
}

function setCamera() {
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  // The model faces +x. "front": three-quarter front. "side": from the skater's left.
  if (VIEW === "side") camera.position.set(0, 1.0, 4.2);
  else camera.position.set(2.8, 1.35, 2.1);
  camera.lookAt(0, 0.82, 0);
}

function drawCell(c, x, y, cell, h) {
  for (const o of cols) o.model.root.visible = o === c;
  renderer.setViewport(x, h - y - cell, cell, cell);
  renderer.setScissor(x, h - y - cell, cell, cell);
  renderer.setClearColor(c.source === "hand" ? 0x2a2a3a : 0x23303a, 1);
  renderer.clear();
  renderer.render(scene, camera);
}

function size(w, h) {
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  labels.style.width = `${w}px`;
  labels.style.height = `${h}px`;
  renderer.setScissorTest(true);
}

function label(text, x, y, cls = "") {
  const d = document.createElement("div");
  d.className = `lbl ${cls}`;
  d.textContent = text;
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  labels.appendChild(d);
}

const HEAD = 26;

// The contact sheet: one row per time (beats), one column per skater and source.
out.sheet = (cell = 240) => {
  const w = cell * cols.length;
  const h = HEAD + cell * ROWS.length;
  size(w, h);
  setCamera();
  labels.replaceChildren();
  renderer.setScissorTest(false);
  renderer.setClearColor(0x15151f, 1);
  renderer.clear();
  renderer.setScissorTest(true);
  const ground = [];
  cols.forEach((c, i) => label(c.label, i * cell + 6, 5, "head"));
  ROWS.forEach((beats, r) => {
    cols.forEach((c, i) => {
      poseAt(c, beats);
      drawCell(c, i * cell, HEAD + r * cell, cell, h);
      const low = lowestPointCm(c);
      ground.push({ beats, col: c.label, lowestCm: low });
      label(`beat ${beats}  low ${low} cm`, i * cell + 6, HEAD + r * cell + cell - 20);
    });
  });
  return { width: w, height: h, cols: cols.map((c) => c.label), rows: ROWS, ground };
};

// One strip at one time, for a video frame.
out.frame = (beats, cell = 240) => {
  const w = cell * cols.length;
  const h = HEAD + cell;
  size(w, h);
  setCamera();
  labels.replaceChildren();
  renderer.setScissorTest(false);
  renderer.setClearColor(0x15151f, 1);
  renderer.clear();
  renderer.setScissorTest(true);
  cols.forEach((c, i) => {
    poseAt(c, beats);
    drawCell(c, i * cell, HEAD, cell, h);
    label(c.label, i * cell + 6, 5, "head");
  });
  const b = Math.floor(beats) + 1;
  label(`${title}  beat ${((b - 1) % 2) + 1}  ${BPM} BPM`, 6, HEAD + cell - 20);
  return { width: w, height: h };
};

// The ground contact over the whole loop: the lowest mesh point (cm) of each
// column, every 1/8 beat over 2 beats.
out.contact = () => {
  const res = {};
  for (const c of cols) {
    const v = [];
    for (let k = 0; k <= 16; k += 1) {
      poseAt(c, k / 8);
      v.push(lowestPointCm(c));
    }
    res[c.label] = { min: Math.min(...v), max: Math.max(...v) };
  }
  return res;
};

// How much each column moves over one loop (2 beats, every 1/16 beat):
// the largest world rotation (deg) of a bone away from its pose at beat 0,
// the range of the hip height (cm), and the range of the distance between
// the wrists (cm). The Bankhead Bounce needs the shoulders and the forearms
// to move; the Prep needs the hands to meet in a clap.
const MOTION_BONES = ["Hips", "Spine2", "Head", "LeftShoulder", "RightShoulder", "LeftArm", "RightArm", "LeftForeArm", "RightForeArm", "LeftUpLeg", "RightUpLeg"];
out.motion = () => {
  const res = {};
  for (const c of cols) {
    const bones = {};
    c.model.root.traverse((o) => {
      const m = /^mixamorig:?(.+)$/.exec(o.name);
      if (o.isBone && m) bones[m[1]] = o;
    });
    const q0 = {};
    const maxDeg = {};
    const hip = [];
    const wrist = [];
    const q = new THREE.Quaternion();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let k = 0; k <= 32; k += 1) {
      poseAt(c, k / 16);
      for (const n of MOTION_BONES) {
        bones[n].getWorldQuaternion(q);
        if (k === 0) {
          q0[n] = q.clone();
          maxDeg[n] = 0;
        } else maxDeg[n] = Math.max(maxDeg[n], THREE.MathUtils.radToDeg(q.angleTo(q0[n])));
      }
      hip.push(bones.Hips.getWorldPosition(a).y * 100);
      wrist.push(bones.LeftHand.getWorldPosition(a).distanceTo(bones.RightHand.getWorldPosition(b)) * 100);
    }
    const range = (v) => [+Math.min(...v).toFixed(1), +Math.max(...v).toFixed(1)];
    res[c.label] = { maxDeg: Object.fromEntries(Object.entries(maxDeg).map(([k, v]) => [k, +v.toFixed(1)])), hipCm: range(hip), wristGapCm: range(wrist) };
  }
  return res;
};

out.clipBeat = ANIM.clipBeat;
