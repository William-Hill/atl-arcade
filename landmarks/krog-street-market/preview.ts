// Review page for the img2threejs factory. ?az=<deg>&el=<deg> sets the view.
import * as THREE from "three";
import spec from "./object-sculpt-spec.json";
import { createSignTexture } from "../../src/render/landmark-signs.js";
import { applyBoxUVs, landmarkEnvironment, landmarkMaterials, landmarkTexturesReady } from "../../src/render/landmark-materials.js";
(window as any).__colors = Object.fromEntries((spec as any).materials.map((m: any) => [m.id, new THREE.Color(m.baseColor)]));
import {
  configureKrogStreetMarketRenderer,
  createKrogStreetMarketLookDevLights,
  createKrogStreetMarketModel,
  frameKrogStreetMarketCamera,
} from "./src/createKrogStreetMarketModel";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("c") as HTMLCanvasElement;
// ?bg=none renders on a transparent background (for the segmentation gates).
const transparent = params.get("bg") === "none";
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: transparent });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
// The game look: no tone mapping, sRGB output (the game renderer defaults).
// ?look=toon keeps the old flat toon look; ?look=factory the factory's.
const look = params.get("look") ?? "game";
if (look === "factory") configureKrogStreetMarketRenderer(renderer);
const scene = new THREE.Scene();
scene.background = transparent ? null : new THREE.Color(0x9fd4ff);
if (transparent) {
  renderer.setClearColor(0x000000, 0);
  document.body.style.background = "transparent";
  document.documentElement.style.background = "transparent";
}
if (look === "toon") scene.add(createKrogStreetMarketLookDevLights("neutral"));
else {
  // The game lights (src/render/geo-view.js createGeoLights).
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a6a48, 0.7));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.5);
  sun.position.set(30, 50, 20);
  scene.add(sun);
}
const envMap = await landmarkEnvironment(renderer);
const model = createKrogStreetMarketModel();
// The game look: a flat toon color per part (the spec base color), as the
// game bakes it. ?pbr=1 keeps the factory's PBR materials.
if (params.get("pbr") !== "1" && look === "game" && params.get("unlit") !== "1") {
  const mats = landmarkMaterials({ envMap, overhangs: (spec as any).occlusionOverhangs ?? null, baseY: 0 });
  model.updateMatrixWorld(true);
  model.traverse((o: any) => {
    if (!o.isMesh || o.userData?.sculptComponent?.canvasText) return;
    const id = o.userData?.sculptComponent?.materialId;
    if (!mats[id]) return;
    o.geometry = applyBoxUVs(o.geometry, o.matrixWorld);
    o.material = mats[id];
  });
}
if (params.get("pbr") !== "1") {
  const ramp = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 180, 180, 180, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  ramp.needsUpdate = true;
  const gameLook = look === "game" && params.get("unlit") !== "1";
  model.traverse((o: any) => {
    if (!o.isMesh) return;
    const ct = o.userData?.sculptComponent?.canvasText;
    // The game look already set physical materials on every part but the cards.
    if (gameLook && !ct) return;
    const id = o.userData?.sculptComponent?.materialId;
    const color = (window as any).__colors?.[id] ?? o.material.color;
    // ?unlit=1: flat, unlit, map-free colors (the map-stripped review evidence).
    // Unlit colors skip tone mapping, so a pixel is the spec base color.
    o.material = params.get("unlit") === "1" ? new THREE.MeshBasicMaterial({ color, toneMapped: false }) : new THREE.MeshToonMaterial({ color, gradientMap: ramp });
    // The letter cards, as the game draws them, in every pass: the text is
    // the identity of the card (a plain card is a black block).
    if (ct) {
      const dims = o.userData?.sculptComponent?.dimensions ?? { width: 8, height: 1 };
      const map = createSignTexture(ct.text, { color: ct.color, background: ct.background, condensed: ct.background === "transparent", outline: ct.outline ?? null, height: Math.round((2048 * dims.height) / dims.width) });
      const opts: any = { map, transparent: ct.background === "transparent", alphaTest: 0.5, side: THREE.DoubleSide };
      o.material = params.get("unlit") === "1" ? new THREE.MeshBasicMaterial({ ...opts, toneMapped: false }) : gameLook ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.5, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.45 }) : new THREE.MeshToonMaterial({ ...opts, gradientMap: ramp });
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
const frontCamera = params.get("frame") === "front";
model.traverse((o: any) => { if (o.isMesh && o.visible && (!o.parent || o.parent.visible) && isShown(o)) box.expandByObject(o); });
function isShown(o: any) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
// ?frame=front frames the entrance front at the reference crop's extent.
// The box is the area of the reference crop (crops/front.png) in meters.
if (params.get("frame") === "front") {
  box.min.set(-14.6, 4.5, -1);
  box.max.set(10.8, 10.4, 4);
}
const helper = new THREE.Mesh(new THREE.BoxGeometry(...box.getSize(new THREE.Vector3()).toArray()));
helper.position.copy(box.getCenter(new THREE.Vector3()));
frameTarget.add(helper);
frameKrogStreetMarketCamera(camera, frameTarget, { azimuthDeg: Number(params.get("az") ?? 35), elevationDeg: Number(params.get("el") ?? 20), margin: 1.15 });
// ?frame=front: the photo's camera, about 1.6 m high and 36 m from the
// front, looking up at the middle of the reference crop. The lens fits the
// crop's 25.4 m width.
if (frontCamera) {
  // ?fov=, ?aimY=, ?camY=, ?camZ= tune the photo camera (fit by search; see docs/decisions.md).
  // Defaults from a search against the transparent reference mask (IoU
  // 0.9035, aspect delta 0.029, scale delta 0.008). It is a fitted camera,
  // not the physical one: the photo is a crop of a wide phone frame.
  camera.fov = Number(params.get("fov") ?? 5.6);
  camera.position.set(-1.9, Number(params.get("camY") ?? 3), Number(params.get("camZ") ?? 65));
  camera.lookAt(-1.9, Number(params.get("aimY") ?? 7.35), 0);
  camera.updateProjectionMatrix();
}
// ?frame=front: a stand-in for the game's brick box (y 0 to 5.7 m) in the
// same mask color as crops/front-masked.png, so the render is masked the way
// the reference is. It is not part of the model and is never baked.
if (frontCamera && params.get("bake") !== "1") {
  // On a transparent background it writes depth only: it hides the roof
  // underside and leaves the pixels empty, like the masked reference.
  const standMat = transparent ? new THREE.MeshBasicMaterial({ colorWrite: false }) : new THREE.MeshBasicMaterial({ color: 0x9fd4ff, toneMapped: false });
  // ?hide=below also hides the posts and pendants under the canopy, which
  // the reference mask leaves out.
  // Behind the front: the brick box, 0 to 5.7 m.
  const stand = new THREE.Mesh(new THREE.BoxGeometry(40, 5.7, 50), standMat);
  stand.renderOrder = -1;
  stand.position.set(-2, 2.85, -24.9);
  scene.add(stand);
  // ?hide=below: also the space under the truss (0 to 4.5 m) in front of the
  // wall, where the reference mask leaves out the posts and the pendants.
  if (params.get("hide") === "below") {
    const under = new THREE.Mesh(new THREE.BoxGeometry(40, 4.5, 4.6), standMat);
    under.renderOrder = -1;
    under.position.set(-2, 2.25, 2.3);
    scene.add(under);
  }
}
// ?hidePart=<componentId> hides one part (the visible-footprint color gate).
// It runs after the camera is framed, so the camera does not move.
const hidePart = params.get("hidePart");
if (hidePart) {
  model.traverse((o: any) => {
    if (o.isMesh && o.userData?.sculptComponent?.id === hidePart) o.visible = false;
  });
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
