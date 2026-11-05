// Loads landmark GLBs (assets/landmarks/<key>/<key>.glb) with GLTFLoader +
// DRACOLoader, renders one tile per file and LOD (columns: files, rows: LOD0,
// LOD1, LOD2) from a 3/4 view, and writes per-LOD stats to window.__result.
// Driven by scripts/assets/landmarks-check.mjs.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";

const params = new URLSearchParams(location.search);
const FILES = params.get("files").split(",");
const ROWS = Number(params.get("rows") ?? 3);
const YAW = Number(params.get("yaw") ?? 0.75);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);
const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const draco = new DRACOLoader();
draco.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const result = { files: [] };
const tiles = [];
for (const url of FILES) {
  const gltf = await loader.loadAsync(url);
  const lods = gltf.scene.children.filter((o) => /_lod\d$/.test(o.name)).sort((a, b) => a.name.localeCompare(b.name));
  const textures = new Map();
  const info = { url, draco: !!gltf.parser.json.extensionsUsed?.includes("KHR_draco_mesh_compression"), lods: [], textures: [] };
  for (const lod of lods) {
    let triangles = 0;
    lod.traverse((o) => {
      if (!o.isMesh) return;
      triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"]) {
        const t = o.material[k];
        if (t) textures.set(t.uuid, `${t.name || k} ${t.image.width}x${t.image.height}`);
      }
      o.castShadow = o.receiveShadow = true;
    });
    const box = new THREE.Box3().setFromObject(lod, true);
    info.lods.push({ name: lod.name, triangles, extras: lod.userData, size: box.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)), min: box.min.toArray().map((v) => +v.toFixed(2)) });
    tiles.push({ col: result.files.length, row: info.lods.length - 1, lod, box, name: lod.name });
  }
  info.textures = [...new Set(textures.values())];
  result.files.push(info);
}

const cols = FILES.length;
const W = innerWidth / cols;
const H = innerHeight / ROWS;
const labels = document.getElementById("labels");
for (const t of tiles) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb4c8);
  scene.environment = env;
  scene.environmentIntensity = 0.6;
  const c = t.box.getCenter(new THREE.Vector3());
  const size = t.box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.z, size.y) * 0.62;
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.set(c.x - r, c.y + r * 1.4, c.z + r * 0.8);
  sun.target.position.copy(c);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -r * 1.5, right: r * 1.5, top: r * 1.5, bottom: -r * 1.5, near: 0.1, far: r * 6 });
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfe3ff, 0x5a5048, 0.5));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(r * 8, r * 8), new THREE.MeshStandardMaterial({ color: 0x6c6e66, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(c.x, t.box.min.y + 0.5 * 0 + Math.min(0, -0.01), c.z);
  ground.receiveShadow = true;
  scene.add(ground, t.lod);
  const cam = new THREE.PerspectiveCamera(32, W / H, 0.5, r * 20);
  cam.position.set(c.x + Math.sin(YAW) * r * 2.3, c.y + r * 0.9, c.z + Math.cos(YAW) * r * 2.3);
  cam.lookAt(c);
  const x = t.col * W;
  const y = innerHeight - (t.row + 1) * H;
  renderer.setViewport(x, y, W, H);
  renderer.setScissor(x, y, W, H);
  renderer.render(scene, cam);
  const f = result.files[t.col].lods[t.row];
  const d = document.createElement("div");
  d.style.left = `${x + 6}px`;
  d.style.top = `${t.row * H + 6}px`;
  d.textContent = `${t.name}: ${f.triangles} tris`;
  labels.appendChild(d);
}
result.ok = true;
window.__result = result;
