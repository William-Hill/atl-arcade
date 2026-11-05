// Loads the storefront GLBs (assets/storefronts/) with GLTFLoader +
// DRACOLoader, reports per-file stats to window.__result, and draws one of:
//   mode=lineup  every piece in a row per file, LOD0 in front of LOD1
//   mode=street  a mock street of 3-6 m storefront bays at a 4.2 m ground
//                floor, dressed with the pieces as docs/storefronts.md says
// Light: the pbr look values (src/render/look.js: Neutral tone mapping,
// sun 3.2, hemisphere 0.15) with a room environment at 0.35 in place of the sky, and the pbr-look
// bloom (UnrealBloomPass 0.28 / 0.5 / 0.92, src/render/post.js); time=dusk
// dims the sun so the neon and the bulbs read. Driven by storefront-check.mjs.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";

const q = new URLSearchParams(location.search);
const DIR = q.get("dir") ?? "/assets/storefronts";
const FILES = (q.get("files") ?? "sign_boards,blade_signs,neon_signs,menu_boards,sandwich_boards,cafe_barriers,patio_furniture,patio_umbrellas,string_lights").split(",");
const MODE = q.get("mode") ?? "lineup";
const DUSK = q.get("time") === "dusk";
document.getElementById("label").textContent = q.get("label") ?? "";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(DUSK ? 0x2b3350 : 0x9fc0dc);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = DUSK ? 0.08 : 0.35;
const sun = new THREE.DirectionalLight(DUSK ? 0xffb27a : 0xfff2dd, DUSK ? 0.3 : 3.2);
sun.position.set(-14, 22, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 30, bottom: -30, near: 1, far: 100 });
sun.shadow.bias = -0.0004;
scene.add(sun, new THREE.HemisphereLight(DUSK ? 0x5a6a9a : 0xe6eef6, 0x5a6a48, DUSK ? 0.12 : 0.15));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.92 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const draco = new DRACOLoader();
draco.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const texBytes = (t) => {
  const { width: w, height: h } = t.image;
  return Math.round(w * h * 4 * (t.generateMipmaps === false ? 1 : 4 / 3));
};
const result = { files: [], gpuTextureBytes: 0 };
const pieces = {};
const textureSet = new Map();
for (const f of FILES) {
  const url = `${DIR}/${f}.glb`;
  const gltf = await loader.loadAsync(url);
  const json = gltf.parser.json;
  const roots = gltf.scene.children;
  const nodes = [];
  const tex = new Map();
  for (const r of roots) {
    let triangles = 0;
    r.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const g = o.geometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
      for (const k of ["map", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap"]) {
        const t = o.material[k];
        if (t) tex.set(t.image.src ?? t.uuid, t), textureSet.set(t.image.src ?? t.uuid, t);
      }
    });
    nodes.push({ name: r.name, triangles });
    pieces[r.name] = r;
  }
  const lod0 = nodes.filter((n) => !n.name.endsWith("_lod1"));
  const images = (json.images ?? []).map((i) => i.uri ?? `embedded ${i.mimeType}`);
  const gpu = [...tex.values()].reduce((s, t) => s + texBytes(t), 0);
  result.files.push({
    file: f + ".glb", nodes: nodes.length, lod0: lod0.length, lod1: nodes.length - lod0.length,
    trianglesMax: Math.max(...lod0.map((n) => n.triangles)), trianglesAll: nodes.reduce((s, n) => s + n.triangles, 0),
    textures: [...tex.values()].map((t) => `${t.image.width}x${t.image.height}`), images: [...new Set(images)], gpuTextureBytes: gpu,
    draco: !!json.extensionsUsed?.includes("KHR_draco_mesh_compression"), emissiveStrength: !!json.extensionsUsed?.includes("KHR_materials_emissive_strength"),
    materials: (json.materials ?? []).map((m) => m.name), list: nodes
  });
}
result.gpuTextureBytes = [...textureSet.values()].reduce((s, t) => s + texBytes(t), 0);
result.uniqueTextures = textureSet.size;

const put = (name, x, y, z, ry = 0) => {
  const src = pieces[name];
  if (!src) throw new Error(`no piece ${name}`);
  const o = src.clone();
  o.position.set(x, y, z);
  o.rotation.y = ry;
  scene.add(o);
  return o;
};

const cam = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 500);
const fit = (min, max, dir) => {
  // Frame the box min..max from direction `dir` (unit), with a margin.
  const c = min.clone().add(max).multiplyScalar(0.5);
  const r = max.clone().sub(min).length() / 2;
  const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  const d = (r / Math.min(t, t * cam.aspect)) * 0.82;
  cam.position.copy(c).addScaledVector(dir, d);
  cam.lookAt(c);
};
cam.aspect = innerWidth / innerHeight;
if (MODE === "lineup") {
  // Wall pieces (sign boards, blades, neon, menus) hang in rows on one wall,
  // one row per file, wrapped at ROW meters; floor pieces stand in rows on
  // the ground with each LOD1 copy behind its LOD0.
  const ROW = Number(q.get("row") ?? 16);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9b8a2, roughness: 0.9 });
  const lo = new THREE.Vector3(Infinity, 0, Infinity), hi = new THREE.Vector3(-Infinity, 0, -Infinity);
  let wallPieces = 0;
  let x = 0, y = 0.3, z = 0, rowH = 0, rowD = 0;
  const newRow = (wall) => {
    if (x === 0) return;
    if (wall) y += rowH + 0.45;
    else z -= rowD + 1.0;
    x = 0, rowH = 0, rowD = 0;
  };
  for (const f of result.files) {
    const wall = /sign_boards|blade|neon|menu/.test(f.file);
    newRow(wall);
    for (const n of f.list.filter((n) => !n.name.endsWith("_lod1"))) {
      const bb = new THREE.Box3().setFromObject(pieces[n.name]);
      const s = bb.getSize(new THREE.Vector3());
      if (x > 0 && x + s.x > ROW) newRow(wall);
      const lod = pieces[n.name + "_lod1"];
      const px = x - bb.min.x;
      if (wall) {
        put(n.name, px, y, 0);
        wallPieces += 1;
      } else {
        // String lights hang from their anchors (y = 0): lift them to view.
        const py = Math.max(0, -bb.min.y) + (bb.min.y < 0 ? 0.4 : 0);
        put(n.name, px, py, z - bb.max.z);
        if (lod) put(n.name + "_lod1", px, py, z - bb.max.z - s.z - 0.5);
      }
      lo.min(new THREE.Vector3(x, wall ? y : 0, wall ? -0.2 : z - (lod ? 2 * s.z + 0.5 : s.z)));
      hi.max(new THREE.Vector3(x + s.x, wall ? y + s.y : s.y, wall ? s.z : z));
      x += s.x + 0.4;
      rowH = Math.max(rowH, s.y);
      rowD = Math.max(rowD, lod ? 2 * s.z + 0.5 : s.z);
    }
  }
  if (wallPieces) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(hi.x - lo.x + 1, hi.y + 0.8, 0.2), wallMat);
    w.position.set((lo.x + hi.x) / 2, (hi.y + 0.8) / 2, -0.1);
    w.receiveShadow = true;
    scene.add(w);
  }
  cam.fov = 30;
  fit(lo, hi, wallPieces ? new THREE.Vector3(0.22, 0.05, 1).normalize() : new THREE.Vector3(0.1, 0.85, 0.9).normalize());
} else {
  // Mock street: each business gets one bay of a 4.2 m ground floor.
  const FLOOR = 4.2;
  const biz = JSON.parse(q.get("biz") ?? "null") ?? [
    ["coffee", 4.2, "bistro_teal", "teal"], ["taqueria", 5.4, "four", "marigold"], ["records", 3.6, null, null],
    ["creamery", 4.2, "bistro_red", "tomato"], ["brewery", 6.0, "picnic", "sage"], ["books", 3.6, null, null]
  ];
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xa65a3f, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xe9e0cf, roughness: 0.7 });
  const glassMat = new THREE.MeshStandardMaterial({ color: DUSK ? 0x6e5a3a : 0x1c2730, roughness: 0.08, metalness: 0.2, emissive: DUSK ? 0x4a3418 : 0x000000 });
  const box = (w, h, d, x, y, z, m) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
  };
  const total = biz.reduce((s, b) => s + b[1], 0);
  box(total + 1, 9.5, 1, total / 2, 4.75, -0.5, wallMat);
  box(total + 1, 0.28, 0.36, total / 2, FLOOR, 0.0, trimMat);
  let x = 0;
  for (const [id, bay, set, umb] of biz) {
    const cx = x + bay / 2;
    box(0.36, FLOOR - 0.14, 0.16, x + 0.18, (FLOOR - 0.14) / 2, 0.08, trimMat);
    box(bay - 0.72, FLOOR * 0.72, 0.04, cx, FLOOR * 0.36 + 0.05, 0.0, glassMat);
    box(bay - 0.72, 0.4, 0.1, cx, 0.2, 0.05, trimMat);
    const wide = bay >= 5;
    // Sign board on the sign band (84% of the floor up), centered on the bay.
    put(`sign_board_${id}${wide ? "_wide" : ""}`, cx, FLOOR * 0.84 - 0.25, 0);
    put(`blade_sign_${id}`, x + 0.36, 2.9, 0.08, 0);
    if (pieces[`neon_sign_${id}`]) put(`neon_sign_${id}`, cx + bay * 0.18, 1.55, 0.03);
    if (pieces[`menu_board_${id}`]) put(`menu_board_${id}`, x + bay - 0.75, 1.05, 0.02);
    if (pieces[`sandwich_board_${id}`]) put(`sandwich_board_${id}`, x + 0.9, 0, 1.4, 0.25);
    if (set) {
      put(`cafe_barrier_${id}`, cx, 0, 3.35);
      const name = set === "picnic" ? "patio_picnic" : `patio_set_${set}`;
      put(name, cx - (umb ? 0.2 : 0), 0, 2.0, set === "picnic" ? Math.PI / 2 : 0);
      if (umb) put(`patio_umbrella_${umb}`, set === "four" ? cx - 0.2 : cx + bay * 0.3, 0, 2.0);
    }
    x += bay;
  }
  box(0.36, FLOOR - 0.14, 0.16, x - 0.18, (FLOOR - 0.14) / 2, 0.08, trimMat);
  // String lights from the belt course to posts at the curb.
  for (const [px, L] of [[4.2 + 2.7, 6], [4.2 + 5.4 + 3.6 + 4.2 + 3, 6]]) {
    put("string_light_post", px, 0, 6.2);
    const l = put(`string_lights_${L}m`, px, 0, 3.1);
    // Span from (px, 3.9, 0.05) on the wall to the post hook at (px, 3.18, 6.2-0.32).
    const a = new THREE.Vector3(px, 3.9, 0.15), b = new THREE.Vector3(px, 3.12, 5.9);
    l.position.copy(a).add(b).multiplyScalar(0.5);
    l.rotation.set(0, Math.PI / 2, 0);
    l.rotateZ(Math.atan2(a.y - b.y, b.z - a.z));
    l.scale.x = a.distanceTo(b) / L;
  }
  cam.fov = 36;
  cam.position.set(total * 0.42, 2.6, 15.5);
  cam.lookAt(total * 0.5, 2.6, 0);
}
cam.aspect = innerWidth / innerHeight;
cam.updateProjectionMatrix();

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, cam));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.28, 0.5, 0.92));
composer.addPass(new OutputPass());
composer.render();
result.ok = true;
window.__result = result;
