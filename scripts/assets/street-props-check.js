// Loads the street prop GLBs with GLTFLoader + DRACOLoader (the decoder from
// node_modules, as in src/render/skater-model.js), lines them up, and writes
// per-file stats to window.__result. Driven by street-props-check.mjs.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";

const FILES = new URLSearchParams(location.search).get("files").split(",");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb4c8);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.position.set(-8, 14, 10);
scene.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x5a5048, 0.6));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x55575a, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const draco = new DRACOLoader();
draco.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const result = { files: [] };
let x = 0;
for (const url of FILES) {
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  let triangles = 0, vertices = 0, textures = new Set();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    vertices += g.attributes.position.count;
    for (const k of ["map", "normalMap", "metalnessMap", "roughnessMap"]) if (o.material[k]) textures.add(`${k} ${o.material[k].image.width}`);
  });
  const nodes = [];
  model.traverse((o) => /^(wheel|steer)_/.test(o.name) && nodes.push(o.name));
  // Rigged vehicles: steer the front wheels and pose the roll clip a sixth of a turn in.
  model.traverse((o) => o.name.startsWith("steer_") && (o.rotation.y = 0.4));
  // With the clip playing and the front wheels steered, each wheel's lowest
  // point must stay on the ground (y = 0) through a full turn.
  const wheelGround = {};
  if (gltf.animations.length) {
    const mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) mixer.clipAction(clip).play();
    const wheels = [];
    model.traverse((o) => /^wheel_/.test(o.name) && wheels.push(o));
    for (let i = 0; i < 12; i++) {
      mixer.update(i ? 1 / 12 : 0);
      model.updateMatrixWorld(true);
      for (const w of wheels) {
        const y = new THREE.Box3().setFromObject(w, true).min.y;
        const g = (wheelGround[w.name] ??= { min: Infinity, max: -Infinity });
        g.min = Math.min(g.min, y);
        g.max = Math.max(g.max, y);
      }
    }
    for (const g of Object.values(wheelGround)) (g.min = +g.min.toFixed(4)), (g.max = +g.max.toFixed(4));
    mixer.setTime(1 / 6);
  }
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  // Line up along x, side on to the camera, front (+z) turned to the right.
  model.rotation.y = Math.PI / 2;
  model.position.x = x + size.z / 2;
  x += size.z + 1.5;
  scene.add(model);
  result.files.push({ url, triangles, vertices, size: size.toArray().map((v) => +v.toFixed(3)), minY: +box.min.y.toFixed(3), textures: [...textures], nodes, animations: gltf.animations.map((a) => `${a.name} ${a.duration.toFixed(2)}s ${a.tracks.length} tracks`), wheelGround, draco: !!gltf.parser.json.extensionsUsed?.includes("KHR_draco_mesh_compression") });
}
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 500);
cam.position.set(x / 2, x * 0.35, x * 0.95);
cam.lookAt(x / 2, 1.2, 0);
renderer.render(scene, cam);
result.ok = true;
window.__result = result;
