import * as THREE from "three";
import { GREYBOX } from "../level/greybox.js";
import { createGroundSampler } from "../level/ground.js";
import { createLevelLights, createLevelView } from "../render/level-view.js";
import { loadSkaterModel } from "../render/skater-model.js";
import { createSkaterView } from "../render/skater-view.js";
import { toonSkater } from "../render/toon.js";

// Test page for the clip blends, the carve lean, and the foot IK (#107):
// anim-lab.html?skater=nia. The skater stands on the greybox level, with
// its stairs and its quarter pipe. window.__lab draws contact sheets.

const params = new URLSearchParams(window.location.search);
const canvas = document.getElementById("stage");
const labels = document.getElementById("labels");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc4e8);
scene.add(createLevelLights());
scene.add(createLevelView(GREYBOX).root);
const sample = createGroundSampler(GREYBOX);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);

const view = createSkaterView({ footIk: true, sampleGround: (x, z) => sample(x, z) });
scene.add(view.group);

const DT = 1 / 60;
const FACE_Z = -Math.PI / 2; // yaw that faces +z (heading [cos, 0, -sin])

// The places of the sheets. y is the ground under the skater center.
const ground = (x, z) => sample(x, z)?.height ?? 0;
export const SPOTS = {
  // The flat street, between the rails and the south curb.
  flat: { x: -12, z: 3, yaw: 0 },
  // The quarter pipe at x 26 (radius 3): 1.2 m up the curve (23 degrees),
  // riding across it, so the left skate is up the slope.
  ramp: { x: 27.2, z: 0, yaw: FACE_Z },
  // The plaza stairs: on the edge of step 1 (0.83 m) and step 2 (0.66 m),
  // riding along the edge, so the left skate is one step down.
  stairs: { x: -21.63, z: 9, yaw: FACE_Z },
};

function stateAt(spot, extra = {}) {
  return { state: "rolling", speed: 3, yaw: spot.yaw, position: [spot.x, ground(spot.x, spot.z), spot.z], style: null, ...extra };
}

// Runs `frames` frames with a state function f(i) -> state.
function run(frames, f) {
  for (let i = 0; i < frames; i += 1) view.sync(f(i), DT);
}

// The ankle height over the ground under each skate (the higher of the
// ankle and toe samples). skateGap() takes away the height on flat ground in
// the same clip pose: 0 means the skate touches.
let flatGap = null;
function skateGaps() {
  const out = {};
  const m = view.model;
  view.group.updateMatrixWorld(true);
  for (const side of ["Left", "Right"]) {
    const bone = m.skinnedMesh.skeleton.bones.find((b) => b.name.endsWith(`${side}Foot`));
    const p = bone.getWorldPosition(new THREE.Vector3());
    const toe = m.skinnedMesh.skeleton.bones.find((b) => b.name.endsWith(`${side}ToeBase`));
    const t = toe ? toe.getWorldPosition(new THREE.Vector3()) : p;
    const ga = sample(p.x, p.z);
    const gt = sample(t.x, t.z);
    const g = !gt || (ga && ga.height >= gt.height) ? ga : gt;
    out[side.toLowerCase()] = { above: p.y - g.height, ny: g.normal[1] };
  }
  return out;
}

function rawFeet() {
  const out = {};
  for (const n of ["LeftFoot", "LeftToeBase", "RightFoot", "RightToeBase"]) {
    const bone = view.model.skinnedMesh.skeleton.bones.find((b) => b.name.endsWith(n));
    out[n] = bone.getWorldPosition(new THREE.Vector3()).toArray().map((v) => Number(v.toFixed(3)));
  }
  return out;
}

function measureFlatGap() {
  view.setFootIk(false);
  run(90, () => stateAt(SPOTS.flat));
  flatGap = skateGaps();
  view.setFootIk(true);
}

function gapText() {
  const g = skateGaps();
  // A skate flat on a slope with normal y = ny holds its ankle h / ny above
  // the ground under the ankle.
  const f = (side) => (g[side].above - flatGap[side].above / g[side].ny).toFixed(3);
  return { left: Number(f("left")), right: Number(f("right")) };
}

// Draws a row of tiles. Each tile: { label, setup() -> extra text, cam }.
// cam: [dx, dy, dz] from the skater center to the camera.
function drawRow(tiles, rowIndex, rows) {
  const W = renderer.domElement.width;
  const H = renderer.domElement.height;
  const w = Math.floor(W / tiles.length);
  const h = Math.floor(H / rows);
  const y0 = H - (rowIndex + 1) * h;
  const out = [];
  tiles.forEach((tile, i) => {
    const info = tile.setup() ?? {};
    const p = view.group.position;
    const target = new THREE.Vector3(p.x, p.y + (tile.lookY ?? 0.7), p.z);
    const [dx, dy, dz] = typeof tile.cam === "function" ? tile.cam() : tile.cam;
    camera.position.set(target.x + dx, target.y + dy, target.z + dz);
    camera.lookAt(target);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setViewport(i * w, y0, w, h);
    renderer.setScissor(i * w, y0, w, h);
    renderer.render(scene, camera);
    const div = document.createElement("div");
    div.className = "label";
    div.style.left = `${i * w}px`;
    div.style.top = `${rowIndex * h}px`;
    div.style.width = `${w}px`;
    div.textContent = `${tile.label}${info.text ? ` | ${info.text}` : ""}`;
    labels.appendChild(div);
    out.push({ label: tile.label, ...info });
  });
  return out;
}

function sheet(rows) {
  labels.textContent = "";
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
  renderer.setScissor(0, 0, renderer.domElement.width, renderer.domElement.height);
  renderer.clear();
  const out = rows.map((tiles, r) => drawRow(tiles, r, rows.length));
  renderer.setScissorTest(false);
  renderer.autoClear = true;
  return out;
}

const fmtWeights = (w) =>
  Object.entries(w)
    .filter(([, v]) => v > 0.005)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join(", ");

// The blend sheet: a crossfade frame by frame, and a fade that a second
// change cuts in the middle.
function blendRows() {
  const spot = SPOTS.flat;
  const side = [0, 0.2, 4.6];
  const front = [3.6, 0.4, -2.8];
  const fade = (from, to, times, cam) =>
    times.map((t) => ({
      label: `${from} -> ${to} +${t.toFixed(2)} s`,
      cam,
      setup() {
        run(120, () => stateAt(spot, from === "push" ? { pushing: true, speed: 4 } : {}));
        const frames = Math.round(t / DT);
        run(frames, () => stateAt(spot, to === "push" ? { pushing: true, speed: 4 } : {}));
        return { text: fmtWeights(view.weights), weights: view.weights };
      },
    }));
  const cut = [0, 0.05, 0.1, 0.2, 0.35].map((t) => ({
    label: `push 0.06 s, then coast +${t.toFixed(2)} s`,
    cam: front,
    setup() {
      run(120, () => stateAt(spot));
      run(4, () => stateAt(spot, { pushing: true, speed: 4 }));
      run(Math.round(t / DT), () => stateAt(spot));
      return { text: fmtWeights(view.weights), weights: view.weights };
    },
  }));
  return [fade("coast", "push", [0, 0.03, 0.06, 0.09, 0.12], side), fade("push", "coast", [0, 0.06, 0.12, 0.19, 0.25], side), cut];
}

// The lean sheet: a carve at 6 m/s at five yaw rates, from behind and from
// the front.
function leanRows() {
  const spot = SPOTS.flat;
  const rates = [-1.6, -0.45, 0, 0.45, 1.6];
  const row = (dist) =>
    rates.map((rate) => ({
      label: `yaw rate ${rate.toFixed(2)} rad/s`,
      // dist < 0: behind the skater. dist > 0: in front.
      cam: () => {
        const yaw = view.group.rotation.y;
        return [Math.cos(yaw) * dist, 0.45, -Math.sin(yaw) * dist];
      },
      setup() {
        run(120, (i) => ({ ...stateAt(spot, { speed: 6 }), yaw: rate * i * DT, tick: i + 1 }));
        return { text: `lean ${((view.lean * 180) / Math.PI).toFixed(1)} deg, ${fmtWeights(view.weights)}`, lean: view.lean, weights: view.weights };
      },
    }));
  return [row(-4.6), row(4.6)];
}

// The foot contact sheet: IK off and IK on, on the ramp and on the stairs.
function contactRows() {
  const row = (spotName, cams) =>
    [false, true].flatMap((ik) =>
      cams.map((cam) => ({
        label: `${spotName}, foot IK ${ik ? "on" : "off"}`,
        cam,
        setup() {
          view.setFootIk(ik);
          run(90, () => stateAt(SPOTS[spotName]));
          const gap = gapText();
          return { text: `skate gap L ${gap.left.toFixed(3)} m, R ${gap.right.toFixed(3)} m`, gap, ms: view.footIk.ms, plan: ik ? view.footIk.plan : null, feet: rawFeet() };
        },
      })),
    );
  // Riding toward +z: the camera in front looks back at -z.
  return [row("ramp", [[0.3, -0.1, 4.4], [-3.4, 0.3, 2.6]]), row("stairs", [[0.3, -0.1, 4.4], [3.2, 0.2, 2.8]])];
}

// A frame by frame pose jump check: the largest bone turn (rad) between
// two frames. "steady" is each clip alone after its fade. "change" is the
// 30 frames after each clip change, some in the middle of a fade. A pop is
// a change frame with a larger turn than the clips have alone.
function popCheck() {
  view.setFootIk(false);
  const bones = view.model.skinnedMesh.skeleton.bones;
  const prev = bones.map((b) => b.quaternion.clone());
  const turn = () => {
    let max = 0;
    bones.forEach((b, i) => {
      max = Math.max(max, b.quaternion.angleTo(prev[i]));
      prev[i].copy(b.quaternion);
    });
    return max;
  };
  const spot = SPOTS.flat;
  const PUSH = { pushing: true, speed: 4 };
  const steady = {};
  for (const [name, extra] of [["coast", {}], ["push", PUSH], ["idle", { speed: 0 }]]) {
    run(60, () => stateAt(spot, extra));
    turn();
    let max = 0;
    for (let i = 0; i < 120; i += 1) {
      view.sync(stateAt(spot, extra), DT);
      max = Math.max(max, turn());
    }
    steady[name] = max;
  }
  // Steady coast, then fast changes, some in the middle of a fade.
  const script = [
    [8, PUSH],
    [3, {}],
    [10, PUSH],
    [60, {}],
    [30, { speed: 0 }],
    [5, {}],
    [40, {}],
  ];
  run(120, () => stateAt(spot));
  turn();
  let change = 0;
  let frame = 0;
  const changes = [];
  let last = view.clip;
  for (const [n, extra] of script) {
    for (let i = 0; i < n; i += 1) {
      view.sync(stateAt(spot, extra), DT);
      const t = turn();
      frame += 1;
      if (view.clip !== last) {
        changes.push({ frame, from: last, to: view.clip });
        last = view.clip;
      }
      if (changes.some((c) => frame - c.frame < 30)) change = Math.max(change, t);
    }
  }
  view.setFootIk(true);
  return { steady, change, changes };
}

// The cost of the foot IK: the mean ms per frame over 300 frames on the
// stairs.
function ikCost() {
  view.setFootIk(true);
  let sum = 0;
  for (let i = 0; i < 300; i += 1) {
    view.sync(stateAt(SPOTS.stairs), DT);
    sum += view.footIk.ms;
  }
  return sum / 300;
}

const lab = {
  ready: false,
  error: null,
  spots: SPOTS,
  sheet: (kind) => {
    const rows = kind === "blend" ? blendRows() : kind === "lean" ? leanRows() : contactRows();
    return sheet(rows);
  },
  popCheck,
  ikCost,
  get weights() {
    return view.weights;
  },
};
window.__lab = lab;

try {
  const loaded = await loadSkaterModel(params.get("skater") ?? "nia");
  if (params.get("toon") !== "0") toonSkater(loaded);
  view.attachModel(loaded);
  measureFlatGap();
  lab.flatGap = flatGap;
  lab.ready = true;
} catch (err) {
  lab.error = String(err);
  console.error(err);
}
