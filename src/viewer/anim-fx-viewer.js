import * as THREE from "three";
import { cloneSkaterModel } from "../render/skater-model.js";
import { createSkaterView } from "../render/skater-view.js";
import { toonSkater } from "../render/toon.js";
import { BEAT } from "../sim/skate/constants.js";

// Test page for the procedural layers (#291): anim-fx.html?skater=nia.
// Each column is one dance, with the layers (top label "fx") or without
// them ("off", the same as ?animfx=0). Each row is one time of the dance in
// beats. The skater views get a fixed beat clock and a fixed frame time, so
// the frames are the same in each run.
// __fx.sheet() draws the contact sheet. __fx.bench() times the view sync.

const params = new URLSearchParams(window.location.search);
const name = params.get("skater") ?? "nia";
const DANCES = (params.get("dances") ?? "dance_bankhead,dance_spin,dance_swagsurf").split(",");
const ROWS = (params.get("beats") ?? "2,2.25,2.5,2.75").split(",").map(Number);
const BPM = BEAT.bpm;
const DT = 1 / 60;

const canvas = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
renderer.setScissorTest(true);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 5, 2);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);

const out = { ready: false, error: null, dances: DANCES, beats: ROWS, bpm: BPM };
window.__fx = out;

// One fake controller state: the skater stands still and dances.
// A "carve_left" or "carve_right" column rides a circle at 4 m/s instead.
function danceState(clip, time) {
  if (clip.startsWith("carve")) {
    const rate = clip === "carve_left" ? 1.2 : -1.2;
    return { position: [0, 0, 0], yaw: rate * time, speed: 4, state: "rolling", tick: Math.round(time / DT) };
  }
  const spin = clip === "dance_spin" || clip === "dance_sitspin";
  return {
    position: [0, 0, 0],
    yaw: 0,
    speed: 0,
    state: "rolling",
    tick: Math.round(time / DT),
    style: { clip, time, duration: (4 * 60) / BPM, anim: spin ? "spin" : "tilt" },
  };
}

async function makeView(fxScale) {
  const model = await cloneSkaterModel(name);
  toonSkater(model);
  const view = createSkaterView({ fxScale });
  view.attachModel(model);
  scene.add(view.group);
  view.group.visible = false;
  return view;
}

// Plays the dance from its start to `beats` beats with a fixed frame time.
function playTo(view, clip, beats) {
  const end = (beats * 60) / BPM;
  view.sync({ ...danceState(clip, 0), speed: 0, style: null }, DT, { time: 0, bpm: BPM });
  for (let t = 0; t <= end + 1e-9; t += DT) view.sync(danceState(clip, t), DT, { time: t, bpm: BPM });
}

let cols = [];
try {
  for (const clip of DANCES) for (const scale of [1, 0]) cols.push({ clip, scale, view: await makeView(scale) });
  out.ready = true;
} catch (err) {
  out.error = String(err?.message ?? err);
}

const probes = [];
// The world hip height and the world head, arm, and chest orientations.
function probe(view) {
  view.group.updateMatrixWorld(true);
  const find = (n) => {
    let hit = null;
    view.model.root.traverse((o) => {
      if (!hit && o.isBone && o.name.replace(/^mixamorig[:_]?/, "") === n) hit = o;
    });
    return hit;
  };
  const q = (n) => find(n).getWorldQuaternion(new THREE.Quaternion());
  return { hipY: find("Hips").getWorldPosition(new THREE.Vector3()).y, head: q("Head"), arm: q("LeftArm"), chest: q("Spine2") };
}

// Draws the sheet: one cell for each (row, column).
out.sheet = (cell = 220) => {
  const w = cell * cols.length;
  const h = cell * ROWS.length;
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  // The three-quarter front view. The model faces +x.
  camera.position.set(2.6, 1.3, 2.0);
  camera.lookAt(0, 0.85, 0);
  renderer.setScissorTest(false);
  renderer.setClearColor(0x2a2a3a, 1);
  renderer.clear();
  renderer.setScissorTest(true);
  probes.length = 0;
  ROWS.forEach((beats, r) => {
    cols.forEach((c, i) => {
      for (const o of cols) o.view.group.visible = o === c;
      playTo(c.view, c.clip, beats);
      const y = h - (r + 1) * cell;
      renderer.setViewport(i * cell, y, cell, cell);
      renderer.setScissor(i * cell, y, cell, cell);
      renderer.setClearColor(c.scale ? 0x2a2a3a : 0x33333f, 1);
      renderer.clear();
      renderer.render(scene, camera);
      probes.push({ beats, clip: c.clip, fx: c.scale, ...probe(c.view) });
    });
  });
  // For each row and dance: the hip drop (cm) and the head and arm angles
  // (deg) between the column with the layers and the column without them.
  const diff = [];
  for (let k = 0; k < probes.length; k += 2) {
    const a = probes[k];
    const b = probes[k + 1];
    diff.push({ beats: a.beats, clip: a.clip, hipDropCm: +((b.hipY - a.hipY) * 100).toFixed(2), headDeg: +THREE.MathUtils.radToDeg(a.head.angleTo(b.head)).toFixed(1), armDeg: +THREE.MathUtils.radToDeg(a.arm.angleTo(b.arm)).toFixed(1), chestDeg: +THREE.MathUtils.radToDeg(a.chest.angleTo(b.chest)).toFixed(1) });
  }
  return { width: w, height: h, cols: cols.map((c) => `${c.clip} ${c.scale ? "fx" : "off"}`), rows: ROWS, diff };
};

// Times view.sync() for `count` views over `frames` frames (ms per frame,
// the median of `runs` runs), with the layers (scale 1) or without (0).
out.bench = async ({ count = 6, frames = 600, runs = 7 } = {}) => {
  const result = {};
  const sets = {};
  for (const scale of [1, 0]) {
    sets[scale] = [];
    for (let i = 0; i < count; i += 1) sets[scale].push(await makeView(scale));
  }
  const clips = ["dance_bankhead", "coast", "dance_spin", "carve_left", "dance_swagsurf", "ride_back"];
  const stateFor = (i, t) => {
    const clip = clips[i % clips.length];
    if (clip.startsWith("dance")) return danceState(clip, t % 2);
    return { position: [0, 0, 0], yaw: clip === "carve_left" ? t * 1.2 : 0, speed: 4, state: "rolling", backward: clip === "ride_back", tick: Math.round(t / DT) };
  };
  for (const scale of [1, 0]) result[scale] = [];
  for (let run = 0; run < runs; run += 1) {
    // The two sets alternate, so a change in the machine load hits both.
    for (const scale of [1, 0]) {
      const views = sets[scale];
      const t0 = performance.now();
      for (let f = 0; f < frames; f += 1) {
        const t = f * DT;
        for (let i = 0; i < views.length; i += 1) views[i].sync(stateFor(i, t), DT, { time: t, bpm: BPM });
      }
      result[scale].push((performance.now() - t0) / frames);
    }
  }
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return { count, frames, runs, fxMs: median(result[1]), offMs: median(result[0]), deltaMs: median(result[1]) - median(result[0]), raw: result };
};

// The layer values of each frame of a dance, every 6th frame (for the tuning).
out.trace = (clip, beats) => {
  const c = cols.find((x) => x.clip === clip && x.scale);
  const end = (beats * 60) / BPM;
  const rows = [];
  c.view.sync({ ...danceState(clip, 0), style: null }, DT, { time: 0, bpm: BPM });
  let f = 0;
  for (let t = 0; t <= end; t += DT, f += 1) {
    c.view.sync(danceState(clip, t), DT, { time: t, bpm: BPM });
    if (f % 6 === 0) rows.push([+t.toFixed(2), ...c.view.fx.lag.map((v) => +v.toFixed(3)), +c.view.fx.drop.toFixed(3)]);
  }
  return rows.map((r) => r.join(" ")).join("\n");
};
