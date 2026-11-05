// Preview of the skate feature GLBs (assets/skate-features/*.glb) in the real
// game renderer (pbr look: the game's sun, sky, environment, shadows, and
// post), without touching the shared game code. Open
// /scripts/assets/skate-features-preview.html?<the usual game params>
// [&plaza=x,z,yaw] [&features=id,id]. With ?skatefeatures=0 it is the plain
// game (the BEFORE view).
//
// After the game is ready, it lays every feature out in a little plaza (rows
// by family, along the plaza's x), each a THREE.LOD on the sampled ground,
// and runs src/level/skate-features.js on the placements: the grind objects
// go through prepareGrindables() to prove the format (the game itself does
// not grind on them here: the parent session wires them into the level).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";
import manifest from "../../assets/skate-features/features.json";
import {
  featureLevelObjects,
  toWorld,
} from "../../src/level/skate-features.js";
import { prepareGrindables } from "../../src/sim/skate/grind.js";
import { shareSkateFeatureMaterial } from "../../src/render/skate-feature-models.js";

const params = new URLSearchParams(location.search);
const on = params.get("skatefeatures") !== "0";
const only = params.get("features")?.split(",") ?? null;
const [px, pz, pyaw] = (params.get("plaza") ?? "473,-7,0")
  .split(",")
  .map(Number);
const ROWS = [
  ["rail_flatbar_3m", "rail_flatbar_6m", "rail_flatbar_9m"],
  ["rail_round_3m", "rail_round_6m", "bench_trail", "bench_block"],
  ["rail_down_4", "rail_down_7", "rail_kinked"],
  ["ledge_concrete_3m", "ledge_concrete_6m", "ledge_planter", "manual_pad"],
  ["ramp_quarter", "ramp_kicker", "ramp_bank", "ramp_pyramid"],
];

// Plaza layout in plaza space: rows along x, each row centered, rows 6.5 m apart
// along z (front row nearest +z).
export function plazaLayout(features, rows = ROWS, gap = 2.5, rowGap = 6.5) {
  const out = [];
  rows.forEach((row, r) => {
    const ids = row.filter((id) => features[id]);
    const widths = ids.map((id) => features[id].size[0]);
    let x = -(widths.reduce((a, b) => a + b, 0) + gap * (ids.length - 1)) / 2;
    ids.forEach((id, i) => {
      out.push({
        id,
        x: x + widths[i] / 2,
        z: (r - (rows.length - 1) / 2) * rowGap,
      });
      x += widths[i] + gap;
    });
  });
  return out;
}

await import("../../src/main.js");

const info = { ready: false, plaza: [px, pz, pyaw], models: [], grindables: 0 };
window.__skateFeatures = info;
if (on) {
  const draco = new DRACOLoader();
  draco.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const root = new THREE.Group();
  root.name = "skate-features";
  window.__atl.scene.add(root);
  info.root = root;
  const layout = plazaLayout(manifest.features).filter(
    (p) => !only || only.includes(p.id),
  );
  const heightAt = (x, z) => {
    const s = window.__atl.level.sample(x, z);
    return typeof s === "number" ? s : (s?.height ?? 0);
  };
  const objects = [];
  await Promise.all(
    layout.map(async ({ id, x, z }) => {
      const f = manifest.features[id];
      const [wx, , wz] = toWorld([x, 0, z], {
        position: [px, 0, pz],
        yaw: pyaw,
      });
      const placement = { id, position: [wx, heightAt(wx, wz), wz], yaw: pyaw };
      const gltf = await loader.loadAsync(
        new URL(`../../assets/skate-features/${f.file}`, import.meta.url).href,
      );
      const lod = new THREE.LOD();
      lod.name = `skate-feature-${id}`;
      const levels = gltf.scene.children
        .filter((o) => /_lod\d$/.test(o.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const o of levels) {
        o.traverse((m) => {
          if (m.isMesh) m.castShadow = m.receiveShadow = true;
        });
        lod.addLevel(o, o.userData.lodDistance ?? 0);
      }
      lod.position.set(...placement.position);
      lod.rotation.y = placement.yaw;
      root.add(lod);
      objects.push(...featureLevelObjects(f, placement));
      info.models.push({
        id,
        position: placement.position.map((v) => +v.toFixed(2)),
        levels: levels.map((o) => o.name),
      });
    }),
  );
  shareSkateFeatureMaterial(root.children);
  info.grindables = prepareGrindables({ objects }).length;
  info.ready = true;
}
