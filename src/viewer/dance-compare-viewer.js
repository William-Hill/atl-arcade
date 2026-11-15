import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cloneSkaterModel } from "../render/skater-model.js";
import { toonSkater } from "../render/toon.js";
import { ANIM, grooveRate } from "../render/skater-anim.js";
import { BEAT } from "../sim/skate/constants.js";

// Test page for the Meshy text-to-motion test (#293):
// dance-compare.html?dance=bankhead (or prep).
// Each column is one skater and one clip source: the hand-keyed clip of the
// game (dance_<dance>) or the Meshy clip (assets/dances/meshy-293/<dance>/).
// The page shows the raw clips with no procedural layers (#291), so the two
// sources are compared on the same terms. The clips play at the game tempo.
// __cmp.sheet(cell) draws a contact sheet (rows = times in beats).
// __cmp.frame(beats, cell) draws one strip at one time, for the videos.

const MESHY = {
  bankhead: {
    nia: new URL("../../assets/dances/meshy-293/bankhead/nia.glb", import.meta.url).href,
    marcus: new URL("../../assets/dances/meshy-293/bankhead/marcus.glb", import.meta.url).href,
  },
  prep: {
    nia: new URL("../../assets/dances/meshy-293/prep/nia.glb", import.meta.url).href,
    marcus: new URL("../../assets/dances/meshy-293/prep/marcus.glb", import.meta.url).href,
  },
};

const params = new URLSearchParams(window.location.search);
const dance = params.get("dance") ?? "bankhead";
const ROWS = (params.get("beats") ?? "0,0.5,1,1.5").split(",").map(Number);
const VIEW = params.get("view") ?? "front";
const BPM = BEAT.bpm;

const canvas = document.getElementById("stage");
const labels = document.getElementById("labels");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 5, 2);
scene.add(sun);
// The ground: the wheels must touch it.
const ground = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), new THREE.MeshStandardMaterial({ color: 0x5a5a6e, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);

const out = { ready: false, error: null, dance, rows: ROWS, bpm: BPM, cols: [] };
window.__cmp = out;

async function loadMeshyClip(skater) {
  const gltf = await new GLTFLoader().loadAsync(MESHY[dance][skater]);
  const clip = gltf.animations.find((c) => c.name === `dance_${dance}_meshy`);
  if (!clip) throw new Error(`no dance_${dance}_meshy clip in ${MESHY[dance][skater]}`);
  return clip;
}

async function makeCol(skater, source) {
  const model = await cloneSkaterModel(skater);
  toonSkater(model);
  const clip = source === "hand" ? model.animations.find((c) => c.name === `dance_${dance}`) : await loadMeshyClip(skater);
  if (!clip) throw new Error(`${skater}: no clip for ${source}`);
  const mixer = new THREE.AnimationMixer(model.root);
  const action = mixer.clipAction(clip);
  action.play();
  model.root.visible = false;
  scene.add(model.root);
  return { skater, source, model, mixer, action, clip, label: `${skater} ${source === "hand" ? "hand keys" : "Meshy"}` };
}

let cols = [];
try {
  for (const skater of ["nia", "marcus"]) for (const source of ["hand", "meshy"]) cols.push(await makeCol(skater, source));
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
  label(`${dance}  beat ${((b - 1) % 2) + 1}  ${BPM} BPM`, 6, HEAD + cell - 20);
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
