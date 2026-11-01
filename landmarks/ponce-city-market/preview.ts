// Review page for the img2threejs factory. ?az=<deg>&el=<deg> sets the view.
import * as THREE from "three";
import spec from "./object-sculpt-spec.json";
import { createSignTexture } from "../../src/render/landmark-signs.js";
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
configurePonceCityMarketRenderer(renderer);
const scene = new THREE.Scene();
scene.background = transparent ? null : new THREE.Color(0x9fd4ff);
if (transparent) {
  renderer.setClearColor(0x000000, 0);
  document.body.style.background = "transparent";
  document.documentElement.style.background = "transparent";
}
scene.add(createPonceCityMarketLookDevLights("reference"));
const model = createPonceCityMarketModel();
// The game look: a flat toon color per part (the spec base color), as the
// game bakes it. ?pbr=1 keeps the factory's PBR materials.
if (params.get("pbr") !== "1") {
  const ramp = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 180, 180, 180, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  ramp.needsUpdate = true;
  model.traverse((o: any) => {
    if (!o.isMesh) return;
    const spec = o.material.userData?.sculptMaterial ?? o.userData?.sculptComponent;
    const id = o.userData?.sculptComponent?.materialId;
    const color = (window as any).__colors?.[id] ?? o.material.color;
    // ?unlit=1: flat, unlit, map-free colors (the map-stripped review evidence).
    o.material = params.get("unlit") === "1" ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshToonMaterial({ color, gradientMap: ramp });
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
// ?frame=top frames the tower top (the belvedere, the roof, the finial) only.
if (params.get("frame") === "top") box.min.y = Math.max(box.min.y, 9.4);
const helper = new THREE.Mesh(new THREE.BoxGeometry(...box.getSize(new THREE.Vector3()).toArray()));
helper.position.copy(box.getCenter(new THREE.Vector3()));
frameTarget.add(helper);
framePonceCityMarketCamera(camera, frameTarget, { azimuthDeg: Number(params.get("az") ?? 35), elevationDeg: Number(params.get("el") ?? 20), margin: 1.15 });
renderer.setAnimationLoop(() => renderer.render(scene, camera));
let tris = 0;
model.traverse((o: any) => {
  if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
});
(window as any).__preview = { ready: true, triangles: Math.round(tris), meshes: Object.keys((model.userData.runtime?.meshes) ?? {}).length };

// ?bake=1: merge every visible mesh into one vertex-colored template for the
// game (positions, normals, colors, indices), in model meters, y = 0 at the
// roof. scripts/bake-landmark.mjs saves it.
if (params.get("bake") === "1") {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  model.updateMatrixWorld(true);
  const nm = new THREE.Matrix3();
  model.traverse((o: any) => {
    if (!o.isMesh || !isShown(o)) return;
    const g = o.geometry.index ? o.geometry : o.geometry;
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
  (window as any).__bake = { positions, normals, colors, indices };
}
