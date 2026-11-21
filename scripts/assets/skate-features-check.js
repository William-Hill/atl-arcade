// Loads every skate feature GLB (assets/skate-features/features.json) with
// GLTFLoader + DRACOLoader, renders one tile per feature and LOD from a 3/4
// view, and writes per-feature stats to window.__result: GLB bytes,
// triangles, draw calls (renderer.info of the feature drawn alone, no
// shadows), and the GPU texture memory (w x h x 4 x 1.33 per texture; one
// shared set). Driven by scripts/assets/skate-features-check.mjs.
// ?only=id,id  ?cols=6  ?lod1=1 (a second row per LOD1)  ?yaw=0.75  ?zoom=1
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";
import manifest from "../../assets/skate-features/features.json";
import { shareSkateFeatureMaterial } from "../../src/render/skate-feature-models.js";

const params = new URLSearchParams(location.search);
const only = params.get("only")?.split(",") ?? null;
const IDS = Object.keys(manifest.features).filter(
  (id) => !only || only.includes(id),
);
const COLS = Number(params.get("cols") ?? 6);
const YAW = Number(params.get("yaw") ?? 0.75);
const ZOOM = Number(params.get("zoom") ?? 1);
const LOD1 = params.get("lod1") === "1";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.setScissorTest(true);
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);
const env = new THREE.PMREMGenerator(renderer).fromScene(
  new RoomEnvironment(),
  0.04,
).texture;

const draco = new DRACOLoader();
draco.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const gpuBytes = (t) => t.image.width * t.image.height * 4 * 1.33;
const result = { features: [], textures: {}, totals: {} };
const tiles = [];
const textures = new Map();
const dummyCam = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
const gltfs = await Promise.all(
  IDS.map((id) =>
    loader.loadAsync(`/assets/skate-features/${manifest.features[id].file}`),
  ),
);
shareSkateFeatureMaterial(gltfs.map((g) => g.scene));
for (const [i, id] of IDS.entries()) {
  const f = manifest.features[id];
  const gltf = gltfs[i];
  const lods = gltf.scene.children
    .filter((o) => /_lod\d$/.test(o.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const row = {
    id,
    bytes: f.bytes,
    draco: !!gltf.parser.json.extensionsUsed?.includes(
      "KHR_draco_mesh_compression",
    ),
    lods: [],
  };
  for (const lod of lods) {
    let triangles = 0;
    const mats = new Set();
    lod.traverse((o) => {
      if (!o.isMesh) return;
      triangles +=
        (o.geometry.index
          ? o.geometry.index.count
          : o.geometry.attributes.position.count) / 3;
      mats.add(o.material.name);
      for (const k of [
        "map",
        "normalMap",
        "roughnessMap",
        "metalnessMap",
        "aoMap",
      ]) {
        const t = o.material[k];
        if (t)
          textures.set(t.uuid, {
            name: t.name || k,
            w: t.image.width,
            h: t.image.height,
            gpu: gpuBytes(t),
          });
      }
      o.castShadow = o.receiveShadow = true;
    });
    // Draw calls: the LOD drawn alone, shadows off.
    const s = new THREE.Scene();
    s.add(lod);
    renderer.shadowMap.enabled = false;
    renderer.info.reset();
    renderer.setViewport(0, 0, 1, 1);
    renderer.setScissor(0, 0, 1, 1);
    dummyCam.position.set(0, 2, 12);
    dummyCam.lookAt(0, 0.5, 0);
    renderer.render(s, dummyCam);
    renderer.shadowMap.enabled = true;
    const calls = renderer.info.render.calls;
    s.remove(lod);
    const box = new THREE.Box3().setFromObject(lod, true);
    row.lods.push({
      name: lod.name,
      triangles,
      calls,
      materials: [...mats],
      extras: lod.userData,
      size: box
        .getSize(new THREE.Vector3())
        .toArray()
        .map((v) => +v.toFixed(3)),
      min: box.min.toArray().map((v) => +v.toFixed(3)),
    });
    if (lod.userData.lod === 0 || LOD1)
      tiles.push({
        id,
        lod,
        box,
        label: `${lod.name}: ${triangles} tris, ${calls} call`,
      });
  }
  result.features.push(row);
}
for (const t of textures.values())
  result.textures[t.name] = {
    size: `${t.w}x${t.h}`,
    gpuMB: +(t.gpu / 2 ** 20).toFixed(2),
  };
const glb = result.features.reduce((a, r) => a + r.bytes, 0);
const tex = Object.values(manifest.textures).reduce((a, t) => a + t.bytes, 0);
result.totals = {
  glbBytes: glb,
  textureBytes: tex,
  downloadBytes: glb + tex,
  gpuTextureMB: +(
    [...textures.values()].reduce((a, t) => a + t.gpu, 0) /
    2 ** 20
  ).toFixed(2),
  textureCount: textures.size,
  triangles: result.features.reduce((a, r) => a + r.lods[0].triangles, 0),
  calls: result.features.reduce((a, r) => a + r.lods[0].calls, 0),
};

const rows = Math.ceil(tiles.length / COLS);
const W = innerWidth / COLS;
const H = innerHeight / rows;
const labels = document.getElementById("labels");
renderer.setClearColor(0x9fb4c8);
tiles.forEach((t, i) => {
  const col = i % COLS;
  const r = Math.floor(i / COLS);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb4c8);
  scene.environment = env;
  scene.environmentIntensity = 0.6;
  const c = t.box.getCenter(new THREE.Vector3());
  const size = t.box.getSize(new THREE.Vector3());
  const rad = (Math.max(size.x, size.z, size.y * 1.4) * 0.78) / ZOOM;
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.set(c.x - rad, c.y + rad * 1.6, c.z + rad * 0.9);
  sun.target.position.copy(c);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  Object.assign(sun.shadow.camera, {
    left: -rad * 2,
    right: rad * 2,
    top: rad * 2,
    bottom: -rad * 2,
    near: 0.1,
    far: rad * 8,
  });
  scene.add(
    sun,
    sun.target,
    new THREE.HemisphereLight(0xcfe3ff, 0x5a5048, 0.5),
  );
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(rad * 10, rad * 10),
    new THREE.MeshStandardMaterial({ color: 0x6c6e66, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(c.x, -0.002, c.z);
  ground.receiveShadow = true;
  scene.add(ground, t.lod);
  const cam = new THREE.PerspectiveCamera(32, W / H, 0.05, rad * 30);
  cam.position.set(
    c.x + Math.sin(YAW) * rad * 2.4,
    c.y + rad * 1.0,
    c.z + Math.cos(YAW) * rad * 2.4,
  );
  cam.lookAt(c);
  const x = col * W;
  const y = innerHeight - (r + 1) * H;
  renderer.setViewport(x, y, W, H);
  renderer.setScissor(x, y, W, H);
  renderer.render(scene, cam);
  const d = document.createElement("div");
  d.style.left = `${x + 6}px`;
  d.style.top = `${r * H + 6}px`;
  d.textContent = t.label;
  labels.appendChild(d);
});
result.ok = true;
window.__result = result;
