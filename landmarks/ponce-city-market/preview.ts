// Review page for the img2threejs factory. ?az=<deg>&el=<deg> sets the view.
import * as THREE from "three";
import spec from "./object-sculpt-spec.json";
import { createSignTexture } from "../../src/render/landmark-signs.js";
import { applyBoxUVs, landmarkEnvironment, landmarkMaterials, landmarkTexturesReady } from "../../src/render/landmark-materials.js";
(window as any).__colors = Object.fromEntries((spec as any).materials.map((m: any) => [m.id, new THREE.Color(m.baseColor)]));
import {
  configurePonceCityMarketRenderer,
  createPonceCityMarketLookDevLights,
  createPonceCityMarketModel,
  framePonceCityMarketCamera,
} from "./src/createPonceCityMarketModel";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("c") as HTMLCanvasElement;
// ?bg=none renders on a transparent background (for the segmentation gates).
const transparent = params.get("bg") === "none";
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: transparent });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
// The game look: no tone mapping, sRGB output (the game renderer defaults).
// ?look=toon keeps the old flat toon look; ?pbr=1 the factory's materials.
const look = params.get("look") ?? "game";
if (look === "factory") configurePonceCityMarketRenderer(renderer);
const scene = new THREE.Scene();
scene.background = transparent ? null : new THREE.Color(0x9fd4ff);
if (transparent) {
  renderer.setClearColor(0x000000, 0);
  document.body.style.background = "transparent";
  document.documentElement.style.background = "transparent";
}
if (look === "toon") scene.add(createPonceCityMarketLookDevLights("reference"));
else {
  // The game lights (src/render/geo-view.js createGeoLights).
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a6a48, 0.7));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.5);
  sun.position.set(30, 50, 20);
  scene.add(sun);
}
const envMap = await landmarkEnvironment(renderer);
const model = createPonceCityMarketModel();
// The game look: a flat toon color per part (the spec base color), as the
// game bakes it. ?pbr=1 keeps the factory's PBR materials.
if (params.get("pbr") !== "1" && look === "game" && params.get("unlit") !== "1") {
  const mats = landmarkMaterials({ envMap, overhangs: (spec as any).occlusionOverhangs ?? null, baseY: 0 });
  model.updateMatrixWorld(true);
  model.traverse((o: any) => {
    if (!o.isMesh) return;
    const id = o.userData?.sculptComponent?.materialId;
    if (!mats[id]) return;
    // World-meter UVs in the model frame, so the textures tile at real size.
    o.geometry = applyBoxUVs(o.geometry, o.matrixWorld);
    o.material = mats[id];
  });
} else if (params.get("pbr") !== "1") {
  const ramp = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 180, 180, 180, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  ramp.needsUpdate = true;
  model.traverse((o: any) => {
    if (!o.isMesh) return;
    const id = o.userData?.sculptComponent?.materialId;
    const color = (window as any).__colors?.[id] ?? o.material.color;
    // ?unlit=1: flat, unlit, map-free colors (the map-stripped review evidence).
    // Unlit colors skip tone mapping, so a pixel is the spec base color.
    o.material = params.get("unlit") === "1" ? new THREE.MeshBasicMaterial({ color, toneMapped: false }) : new THREE.MeshToonMaterial({ color, gradientMap: ramp });
    // Material pass: the sign letters, as the game draws them.
    if (id === "sign-yellow" && (spec as any).sculptPipeline?.currentPass !== "blockout") {
      const map = createSignTexture("PONCE CITY MARKET");
      o.material = params.get("unlit") === "1" ? new THREE.MeshBasicMaterial({ map }) : new THREE.MeshToonMaterial({ map, gradientMap: ramp });
    }
  });
}
// ?part=tower or ?part=sign shows one root assembly only.
const part = params.get("part");
if (part) {
  for (const child of [...model.children]) {
    const isSign = /sign/i.test(child.name);
    if ((part === "tower" && isSign) || (part === "sign" && !isSign)) child.visible = false;
  }
}
scene.add(model);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 2000);
const frameTarget = new THREE.Group();
model.updateMatrixWorld(true);
const box = new THREE.Box3();
model.traverse((o: any) => { if (o.isMesh && o.visible && (!o.parent || o.parent.visible) && isShown(o)) box.expandByObject(o); });
function isShown(o: any) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
// ?frame=top frames the extent of the reference crop (crops/tower.png): the
// eave width, from the finial top down to just under the lower band.
if (params.get("frame") === "top") {
  box.min.set(-4.8, 10.2, -4.8);
  box.max.set(4.8, 22.2, 4.8);
}
const helper = new THREE.Mesh(new THREE.BoxGeometry(...box.getSize(new THREE.Vector3()).toArray()));
helper.position.copy(box.getCenter(new THREE.Vector3()));
frameTarget.add(helper);
framePonceCityMarketCamera(camera, frameTarget, { azimuthDeg: Number(params.get("az") ?? 35), elevationDeg: Number(params.get("el") ?? 20), margin: params.get("frame") === "top" ? 1.0 : 1.15 });
// ?hidePart=<componentId> hides one part (the visible-footprint color gate).
// It runs after the camera is framed, so the camera does not move.
const hidePart = params.get("hidePart");
if (hidePart) {
  model.traverse((o: any) => {
    if (o.isMesh && o.userData?.sculptComponent?.id === hidePart) o.visible = false;
  });
}
// ?frame=top: the photo's camera. The drone shot is a far telephoto view,
// close to orthographic, so use a 9.5 degree lens about 70 m out (tuned so the eave tips meet the crop edges, as in the reference), on the
// az / el direction, aimed at y 16.0 m (the crop extent with the lower band).
if (params.get("frame") === "top") {
  const az = (Number(params.get("az") ?? 20) * Math.PI) / 180;
  const el = (Number(params.get("el") ?? 12) * Math.PI) / 180;
  const d = 70;
  camera.fov = 9.5;
  camera.position.set(Math.sin(az) * Math.cos(el) * d, 16.0 + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
  camera.lookAt(0, 16.0, 0);
  camera.far = 400;
  camera.updateProjectionMatrix();
}
// The capture scripts wait for a few drawn frames (window.__frames).
(window as any).__frames = 0;
// Draw only after the scan textures load, so the captures show them.
await landmarkTexturesReady();
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  (window as any).__frames += 1;
});
let tris = 0;
model.traverse((o: any) => {
  if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
});
(window as any).__previewModel = model;
(window as any).__preview = { ready: true, triangles: Math.round(tris), meshes: Object.keys((model.userData.runtime?.meshes) ?? {}).length };

// ?bake=1: merge every visible mesh into one vertex-colored template for the
// game (positions, normals, colors, indices), in model meters, y = 0 at the
// roof. scripts/bake-landmark.mjs saves it.
if (params.get("bake") === "1") {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  // Letter cards keep their text: the game draws them with a canvas texture.
  const cards: any[] = [];
  model.updateMatrixWorld(true);
  const nm = new THREE.Matrix3();
  model.traverse((o: any) => {
    if (!o.isMesh || !isShown(o)) return;
    const sc = o.userData?.sculptComponent;
    if (sc?.canvasText) {
      const c = new THREE.Vector3();
      o.getWorldPosition(c);
      cards.push({ ...sc.canvasText, width: sc.dimensions.width, height: sc.dimensions.height, position: [+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)] });
      return;
    }
    const g = o.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    nm.getNormalMatrix(o.matrixWorld);
    const id = o.userData?.sculptComponent?.materialId;
    const c = (window as any).__colors?.[id] ?? new THREE.Color(0.8, 0.8, 0.8);
    const lin = c.clone();
    const base = positions.length / 3;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      positions.push(+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3));
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      normals.push(+n.x.toFixed(3), +n.y.toFixed(3), +n.z.toFixed(3));
      colors.push(+lin.r.toFixed(4), +lin.g.toFixed(4), +lin.b.toFixed(4));
    }
    if (g.index) for (let i = 0; i < g.index.count; i += 1) indices.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i += 1) indices.push(base + i);
  });
  // Physical-material groups for the near LOD: per material, the geometry in
  // the model frame with the world-meter UVs from applyBoxUVs().
  // Non-indexed: each group is a plain triangle list, so no index array.
  const groups: Record<string, { positions: number[]; normals: number[]; uvs: number[] }> = {};
  const mats = landmarkMaterials();
  model.traverse((o: any) => {
    if (!o.isMesh || !isShown(o) || o.userData?.sculptComponent?.canvasText) return;
    const id = o.userData?.sculptComponent?.materialId;
    if (!mats[id]) return;
    const g = applyBoxUVs(o.geometry, o.matrixWorld);
    const grp = (groups[id] ??= { positions: [], normals: [], uvs: [] });
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const nmx = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      grp.positions.push(+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3));
      n.fromBufferAttribute(nor, i).applyMatrix3(nmx).normalize();
      grp.normals.push(+n.x.toFixed(3), +n.y.toFixed(3), +n.z.toFixed(3));
      grp.uvs.push(+uv.getX(i).toFixed(3), +uv.getY(i).toFixed(3));
    }
  });
  (window as any).__bake = { positions, normals, colors, indices, cards, groups, overhangs: (spec as any).occlusionOverhangs ?? [] };
}
