// Preview of the pedestrians (assets/people/), the new street furniture
// (assets/props/street/) and the BeltLine props (assets/props/beltline/) in
// the real game renderer (pbr look: the game's sun, sky, environment,
// shadows and post), without touching the shared game code. Open
// /scripts/assets/people-props-preview.html?<the usual game params>
// [&plaza=x,z,yaw] [&clip=walk] [&lod=1] [&only=id,id] [&pad=0].
// With ?peopleprops=0 it is the plain game (the BEFORE view).
//
// After the game is ready it lays the assets out on a concrete pad (rows
// along the plaza's x: people, each with the prop it uses (COMPANIONS),
// street furniture, BeltLine props) and plays each person's clip (its default
// below, or ?clip= for all of them) with one AnimationMixer per model. The
// LOD level is picked per frame by camera distance (extras.lodDistance), or
// forced with ?lod=0|1. The default plaza is the clear lot beside the
// Beltline trail that the skate-feature preview uses.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";
import people from "../../assets/people/manifest.json";
import street from "../../assets/props/street/manifest.json";
import beltline from "../../assets/props/beltline/manifest.json";

export const PLAZA = "311.5,-85.2,-1.403";
// The clip each model plays by default.
export const DEFAULT_CLIP = {
  walker_sundress: "walk",
  elder_polo: "sit",
  jogger: "run",
  dog_walker: "idle",
  stroller_dad: "push",
  cyclist: "ride",
  dog: "walk",
};
// Props staged with a person (x, z offset in the person's frame, m): the
// stroller under the push grip, the bike under the ride (same origin), the
// table at the sit pose's bench, the dog at the walker's side.
export const COMPANIONS = {
  stroller_dad: [["stroller", 0, 0.64]],
  cyclist: [["city_bike", 0, 0]],
  elder_polo: [["picnic_table", 0.18, 0.31]],
  dog_walker: [["dog", 0.75, 0.25]],
};
export const ROWS = [
  ["walker_sundress", "elder_polo", "jogger", "dog_walker", "stroller_dad", "cyclist"],
  ["drinking_fountain", "bollard", "traffic_cone", "barricade"],
  ["e_scooter", "city_bike", "bike_dock", "food_cart", "picnic_table", "patio_umbrella", "sculpture_ribbon"],
];
const SETS = [
  ["people", people],
  ["props/street", street],
  ["props/beltline", beltline],
];
const GLB_URLS = import.meta.glob(
  ["../../assets/people/*.glb", "../../assets/props/street/*.glb", "../../assets/props/beltline/*.glb"],
  { query: "?url", import: "default", eager: true },
);
const params = new URLSearchParams(location.search);
const on = params.get("peopleprops") !== "0";
const only = params.get("only")?.split(",") ?? null;
const forceClip = params.get("clip");
const forceLod = params.has("lod") ? Number(params.get("lod")) : null;
const [px, pz, pyaw] = (params.get("plaza") ?? PLAZA).split(",").map(Number);

// Rows along x, centered, 1.6 m gaps; rows 5 m apart along z (first row at +z).
export function plazaLayout(assets, rows = ROWS, gap = 1.6, rowGap = 5) {
  const out = [];
  rows.forEach((row, r) => {
    const ids = row.filter((id) => assets[id]);
    const widths = ids.map((id) =>
      Math.max(assets[id].size[0], 0.6, ...(COMPANIONS[id] ?? []).filter(([c]) => assets[c]).map(([c, dx]) => assets[c].size[0] + 2 * Math.abs(dx))),
    );
    let x = -(widths.reduce((a, b) => a + b, 0) + gap * (ids.length - 1)) / 2;
    ids.forEach((id, i) => {
      const at = { id, x: x + widths[i] / 2, z: ((rows.length - 1) / 2 - r) * rowGap };
      out.push(at);
      for (const [c, dx, dz] of COMPANIONS[id] ?? []) if (assets[c]) out.push({ id: c, x: at.x + dx, z: at.z + dz, with: id });
      x += widths[i] + gap;
    });
  });
  return out;
}

const toWorld = (x, z) => [px + x * Math.cos(pyaw) + z * Math.sin(pyaw), pz - x * Math.sin(pyaw) + z * Math.cos(pyaw)];

await import("../../src/main.js");

const info = { ready: false, plaza: [px, pz, pyaw], models: [], errors: [] };
window.__peopleProps = info;
if (on) {
  const draco = new DRACOLoader();
  draco.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const root = new THREE.Group();
  root.name = "people-props";
  window.__atl.scene.add(root);
  const assets = {};
  for (const [dir, m] of SETS) for (const [id, a] of Object.entries(m.assets)) assets[id] = { ...a, dir };
  const layout = plazaLayout(assets).filter((p) => !only || only.includes(p.with ?? p.id));
  const heightAt = (x, z) => {
    const s = window.__atl.level.sample(x, z);
    return typeof s === "number" ? s : (s?.height ?? 0);
  };
  const lift = params.get("pad") !== "0" ? 0.04 : 0;
  if (params.get("pad") !== "0") {
    const xs = layout.map((p) => p.x);
    const zs = layout.map((p) => p.z);
    const w = Math.max(...xs) - Math.min(...xs) + 8;
    const d = Math.max(...zs) - Math.min(...zs) + 7;
    const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w), Math.ceil(d));
    geo.rotateX(-Math.PI / 2);
    geo.translate((Math.max(...xs) + Math.min(...xs)) / 2, 0, (Math.max(...zs) + Math.min(...zs)) / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const [wx, wz] = toWorld(pos.getX(i), pos.getZ(i));
      pos.setXYZ(i, wx, heightAt(wx, wz) + 0.03, wz);
    }
    geo.computeVertexNormals();
    const pad = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb7b2a8, roughness: 0.92 }));
    pad.name = "people-props-pad";
    pad.receiveShadow = true;
    root.add(pad);
  }
  const mixers = [];
  const lods = [];
  await Promise.all(
    layout.map(async ({ id, x, z, with: host }) => {
      const a = assets[id];
      try {
        const gltf = await loader.loadAsync(GLB_URLS[`../../assets/${a.dir}/${a.file}`]);
        const model = gltf.scene;
        const [wx, wz] = toWorld(x, z);
        model.position.set(wx, heightAt(wx, wz) + lift, wz);
        model.rotation.y = pyaw;
        model.name = host ? `people-props-${id}-with-${host}` : `people-props-${id}`;
        const levels = [];
        model.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = o.receiveShadow = true;
            o.frustumCulled = false;
            const m = /_lod(\d)$/.exec(o.name);
            if (m) levels[Number(m[1])] = { mesh: o, distance: o.userData.lodDistance ?? 0 };
          }
        });
        lods.push({ model, levels: levels.filter(Boolean) });
        let clip = null;
        if (gltf.animations.length) {
          const want = forceClip ?? DEFAULT_CLIP[id] ?? "idle";
          clip = gltf.animations.find((c) => c.name === want) ?? gltf.animations[0];
          const mixer = new THREE.AnimationMixer(model);
          mixer.clipAction(clip).play();
          mixers.push(mixer);
        }
        root.add(model);
        info.models.push({ id, ...(host ? { with: host } : {}), position: [wx, model.position.y, wz].map((v) => +v.toFixed(2)), clip: clip?.name ?? null, clips: gltf.animations.map((c) => c.name), levels: levels.filter(Boolean).map((l) => l.mesh.name) });
      } catch (err) {
        info.errors.push(`${id}: ${err.message}`);
      }
    }),
  );
  // window.__atl has no camera: a probe mesh hands over the one it renders with.
  let cam = null;
  const probe = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  probe.frustumCulled = false;
  probe.onBeforeRender = (_r, _s, c) => (cam = c);
  root.add(probe);
  const v = new THREE.Vector3();
  let last = performance.now();
  info.lodShown = {};
  const tick = (now) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    for (const m of mixers) m.update(dt);
    for (const { model, levels } of lods) {
      const d = cam ? model.getWorldPosition(v).distanceTo(cam.position) : 0;
      let k = 0;
      levels.forEach((l, i) => {
        if (d >= l.distance) k = i;
      });
      if (forceLod !== null) k = Math.min(forceLod, levels.length - 1);
      levels.forEach((l, i) => (l.mesh.visible = i === k));
      info.lodShown[model.name.replace("people-props-", "")] = k;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  info.ready = true;
}
