// Preview of the landmark GLBs (assets/landmarks/<key>/<key>.glb) in the real
// game renderer, without touching the shared game code. Open
// /scripts/assets/landmarks-preview.html?<the usual game params>. With
// ?landmarkglb=0 it is the plain game (the BEFORE view).
//
// Before the game boots, the preview claims the four landmark footprints
// (landmarks.js `claim: true`: the extrusion, facade kit, and awnings skip
// them; the colliders stay) and turns off the img2threejs Ponce City Market
// tower and its rooftop sign, which the full model replaces. The three
// claim-only entries also get minimap markers (preview only). After the game is
// ready, it adds each GLB as a THREE.LOD at its site origin, yaw 0.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";
import { LANDMARKS } from "../../src/level/geo/landmarks.js";
import sites from "../../assets/landmarks/sites.json";

const params = new URLSearchParams(location.search);
const on = params.get("landmarkglb") !== "0";
const only = params.get("glbonly")?.split(",") ?? null;
const keys = [...Object.keys(sites.buildings), ...Object.keys(sites.bridges)].filter((k) => !only || only.includes(k));

if (on) {
  // The PCM entry stays (the minimap marks it), without its tower and sign:
  // no anchor fits a 1e6 m inset, so landmarkPlacements() skips it.
  const pcm = LANDMARKS.find((l) => l.id === "ponce-city-market");
  if (pcm && keys.includes("ponce-city-market")) {
    pcm.model = { ...pcm.model, inset: 1e6 };
    delete pcm.sign;
    pcm.claim = true;
  }
  for (const k of keys) {
    const b = sites.buildings[k];
    if (b && LANDMARKS.some((l) => l.buildingName === b.name)) continue;
    // No anchor fits a 1e6 m inset, so landmarkPlacements() skips the entry;
    // claimedIds() still claims the footprint.
    if (b) LANDMARKS.push({ id: `glb-${k}`, buildingName: b.name, claim: true, model: { side: [0, 1], inset: 1e6, base: "roof" } });
  }
}

await import("../../src/main.js");

const info = { ready: false, models: [], triangles: 0 };
window.__landmarkGlb = info;
if (on) {
  const draco = new DRACOLoader();
  draco.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const scene = window.__atl.scene;
  const root = new THREE.Group();
  root.name = "landmark-glbs";
  scene.add(root);
  await Promise.all(
    keys.map(async (k) => {
      const site = sites.buildings[k] ?? sites.bridges[k];
      const gltf = await loader.loadAsync(new URL(`../../assets/landmarks/${k}/${k}.glb`, import.meta.url).href);
      const lod = new THREE.LOD();
      lod.name = `landmark-glb-${k}`;
      const levels = gltf.scene.children.filter((o) => /_lod\d$/.test(o.name)).sort((a, b) => a.name.localeCompare(b.name));
      for (const o of levels) {
        o.traverse((m) => {
          if (m.isMesh) m.castShadow = m.receiveShadow = true;
        });
        lod.addLevel(o, o.userData.lodDistance ?? 0);
      }
      lod.position.set(...site.origin);
      root.add(lod);
      info.models.push({ key: k, levels: levels.map((o) => o.name) });
    }),
  );
  info.ready = true;
}
