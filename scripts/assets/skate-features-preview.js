// Preview of the skate feature GLBs (assets/skate-features/*.glb) in the real
// game renderer (pbr look: the game's sun, sky, environment, shadows, and
// post), without touching the shared game code. Open
// /scripts/assets/skate-features-preview.html?<the usual game params>
// [&plaza=x,z,yaw] [&features=id,id] [&pad=0]. With ?skatefeatures=0 it is
// the plain game (the BEFORE view).
//
// After the game is ready, it lays every feature out in a little plaza (rows
// by family, along the plaza's x) on a concrete pad draped over the ground
// (the level has no paved plaza areas: off the strips it is all grass), each
// a THREE.LOD on the pad. The default plaza is a clear, treeless lot beside
// the Beltline trail, with the rails row along the trail,
// and runs src/level/skate-features.js on the placements: the grind objects
// go through prepareGrindables() to prove the format (the game itself does
// not grind on them here: the parent session wires them into the level).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";
import manifest from "../../assets/skate-features/features.json";
import concreteSet from "../../assets/ground/concrete/set.json";
import concreteUrl from "../../assets/ground/concrete/color.jpg?url";
import {
  featureLevelObjects,
  toWorld,
} from "../../src/level/skate-features.js";
import { prepareGrindables } from "../../src/sim/skate/grind.js";
import { SURFACE_COLORS } from "../../src/level/geo/geo-mesh.js";
import { shareSkateFeatureMaterial } from "../../src/render/skate-feature-models.js";

export const PLAZA = "311.5,-85.2,-1.403";
const PAD_MARGIN = 2.5;
const PAD_LIFT = 0.04;
const params = new URLSearchParams(location.search);
const on = params.get("skatefeatures") !== "0";
const only = params.get("features")?.split(",") ?? null;
const [px, pz, pyaw] = (params.get("plaza") ?? PLAZA).split(",").map(Number);
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

// The pad: a 1 m grid over the layout's footprint plus a margin, each vertex
// PAD_LIFT over the sampled ground, in the game's sidewalk concrete (the same
// scan over the sidewalk color, at the pbr albedo calibration).
function concretePad(layout, heightAt) {
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const { id, x, z } of layout) {
    const b = manifest.features[id].bounds;
    x0 = Math.min(x0, x + b.min[0]);
    x1 = Math.max(x1, x + b.max[0]);
    z0 = Math.min(z0, z + b.min[2]);
    z1 = Math.max(z1, z + b.max[2]);
  }
  x0 -= PAD_MARGIN;
  x1 += PAD_MARGIN;
  z0 -= PAD_MARGIN;
  z1 += PAD_MARGIN;
  const nx = Math.ceil(x1 - x0);
  const nz = Math.ceil(z1 - z0);
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= nz; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const [wx, , wz] = toWorld(
        [x0 + ((x1 - x0) * i) / nx, 0, z0 + ((z1 - z0) * j) / nz],
        {
          position: [px, 0, pz],
          yaw: pyaw,
        },
      );
      pos.push(wx, heightAt(wx, wz) + PAD_LIFT, wz);
      uv.push(wx / concreteSet.tileMeters, wz / concreteSet.tileMeters);
    }
  }
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (geo.attributes.normal.getY(0) < 0) geo.index.array.reverse();
  geo.computeVertexNormals();
  const map = new THREE.TextureLoader().load(concreteUrl);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  // The sidewalk color read as sRGB (a darker pad than linear); the scan mean is linear.
  const color = new THREE.Color().setRGB(
    ...SURFACE_COLORS.sidewalk,
    THREE.SRGBColorSpace,
  );
  color.setRGB(
    ...color.toArray().map((c, k) => (c * 0.72) / concreteSet.meanLinear[k]),
  );
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map, color, roughness: 0.92 }),
  );
  mesh.name = "skate-features-pad";
  mesh.receiveShadow = true;
  return mesh;
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
  if (params.get("pad") !== "0") root.add(concretePad(layout, heightAt));
  const lift = params.get("pad") !== "0" ? PAD_LIFT : 0;
  const objects = [];
  await Promise.all(
    layout.map(async ({ id, x, z }) => {
      const f = manifest.features[id];
      const [wx, , wz] = toWorld([x, 0, z], {
        position: [px, 0, pz],
        yaw: pyaw,
      });
      const placement = {
        id,
        position: [wx, heightAt(wx, wz) + lift, wz],
        yaw: pyaw,
      };
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
