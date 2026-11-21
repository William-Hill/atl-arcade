// Loads assets/facades/facade-kit.glb with GLTFLoader + DRACOLoader, lines up
// every module (LOD0 row, LOD1 row behind), labels them, and writes per-node
// stats to window.__result. Driven by facade-kit-check.mjs.
//   ?view=lineup (default) | ?view=lod1
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";

const params = new URLSearchParams(location.search);
const FILE = params.get("file") ?? "/assets/facades/facade-kit.glb";
const VIEW = params.get("view") ?? "lineup";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb4c8);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const sun = new THREE.DirectionalLight(0xfff2dd, 3.0);
sun.position.set(-10, 18, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 20, bottom: -20, far: 80 });
scene.add(sun, sun.target, new THREE.HemisphereLight(0xe6eef6, 0x5a6a48, 0.15));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const draco = new DRACOLoader();
draco.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
const loader = new GLTFLoader().setDRACOLoader(draco);
const t0 = performance.now();
const gltf = await loader.loadAsync(FILE);
const loadMs = performance.now() - t0;

const nodes = [];
gltf.scene.traverse((o) => o.isMesh && nodes.push(o));
const materials = new Set(nodes.map((o) => o.material));
const textures = [];
for (const m of materials) for (const k of ["map", "normalMap", "metalnessMap", "roughnessMap"]) if (m[k]) textures.push(`${k} ${m[k].image.width}x${m[k].image.height}`);
const stats = nodes.map((o) => {
  const g = o.geometry;
  g.computeBoundingBox();
  const s = g.boundingBox.getSize(new THREE.Vector3());
  return { name: o.name, triangles: (g.index ? g.index.count : g.attributes.position.count) / 3, vertices: g.attributes.position.count, size: s.toArray().map((v) => +v.toFixed(2)), kit: o.userData.kit ?? null, lodOf: o.userData.lod_of ?? null };
});

// A contact sheet: one tile per node, framed on its own bounding box, with a
// plain backing wall behind the wall modules. ?view=lod1 shows the _lod1
// node of a module where it has one.
const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9a58a, roughness: 0.88 });
const trimTint = new THREE.Color(0xf2e8d8);
const awningTint = new THREE.Color(0x2a8a72);
const lod0 = nodes.filter((o) => !o.userData.lod_of && !o.name.endsWith("_lod1"));
const shown = lod0.map((o) => (VIEW === "lod1" ? nodes.find((n) => n.name === `${o.name}_lod1`) ?? o : o));
const COLS = 7;
const ROWS = Math.ceil(shown.length / COLS);
const tw = Math.floor(innerWidth / COLS);
const th = Math.floor((innerHeight - 34) / ROWS);
renderer.setScissorTest(true);
renderer.autoClear = false;
renderer.setClearColor(0x9fb4c8);
renderer.clear();
const cam = new THREE.PerspectiveCamera(30, tw / th, 0.05, 200);
let calls = 0;
shown.forEach((o, k) => {
  const base = lod0[k];
  const kind = base.userData.kit?.kind;
  const tile = new THREE.Group();
  const m = new THREE.Mesh(o.geometry, o.material);
  if (base.userData.kit?.tint) {
    m.material = o.material.clone();
    m.material.color.copy(base.name.startsWith("awning") ? awningTint : trimTint);
  }
  m.castShadow = m.receiveShadow = true;
  tile.add(m);
  const bb = new THREE.Box3().setFromObject(m);
  const size = bb.getSize(new THREE.Vector3());
  const c = bb.getCenter(new THREE.Vector3());
  if (kind !== "roof") {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(size.x + 1.2, size.y + 1.2), wallMat);
    wall.position.set(c.x, c.y, kind === "wall-corner" ? bb.min.z + 0.001 : -0.002);
    wall.receiveShadow = true;
    tile.add(wall);
  } else {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(size.x + 1.5, size.z + 1.5), wallMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(c.x, bb.min.y - 0.001, c.z);
    pad.receiveShadow = true;
    tile.add(pad);
  }
  scene.add(tile);
  ground.visible = false;
  const r = Math.max(size.x, size.y * 1.25, size.z) * 0.62 + 0.15;
  const dir = kind === "roof" ? new THREE.Vector3(0.75, 0.6, 1).normalize() : new THREE.Vector3(0.45, 0.22, 1).normalize();
  cam.position.copy(c).addScaledVector(dir, r / Math.tan((cam.fov * Math.PI) / 360) * 1.05);
  cam.lookAt(c);
  sun.position.copy(c).add(new THREE.Vector3(-4, 8, 7));
  sun.target.position.copy(c);
  Object.assign(sun.shadow.camera, { left: -r * 2, right: r * 2, top: r * 2, bottom: -r * 2, near: 0.1, far: 30 });
  sun.shadow.camera.updateProjectionMatrix();
  const col = k % COLS;
  const row = Math.floor(k / COLS);
  const x = col * tw;
  const y = innerHeight - 34 - (row + 1) * th;
  renderer.setViewport(x + 2, y + 2, tw - 4, th - 4);
  renderer.setScissor(x + 2, y + 2, tw - 4, th - 4);
  renderer.render(scene, cam);
  calls += renderer.info.render.calls;
  scene.remove(tile);
  const st = stats.find((s) => s.name === o.name);
  const el = document.createElement("div");
  el.className = "lbl";
  el.textContent = `${o.name} · ${st.triangles} tris`;
  el.style.left = `${x + tw / 2}px`;
  el.style.top = `${34 + (row + 1) * th - 22}px`;
  document.body.appendChild(el);
});
document.getElementById("title").textContent = VIEW === "lod1" ? "facade-kit.glb — LOD1 nodes (modules without a LOD1 show LOD0) · 1 material · tinted: trim cream, awning green" : "facade-kit.glb — LOD0 modules · 1 material, 1 atlas (1024 color + 1024 normal + 512 ORM) · tinted: trim cream, awning green";
window.__result = { ok: true, file: FILE, loadMs: Math.round(loadMs), nodes: stats.length, materials: materials.size, textures, draco: !!gltf.parser.json.extensionsUsed?.includes("KHR_draco_mesh_compression"), stats, drawCalls: calls };
