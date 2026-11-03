import * as THREE from "three";
import { landmarkPlacements } from "../level/geo/landmarks.js";
import { createSignTexture } from "./landmark-signs.js";
import { landmarkEnvironment, landmarkMaterials, landmarkTexturesReady } from "./landmark-materials.js";

// Past this distance (m) a landmark shows its flat, vertex-colored bake;
// nearer, its physical-material groups.
export const LANDMARK_FAR_DISTANCE = 250;

// Landmark models on the real roofs: the baked img2threejs tower templates
// (assets/landmarks/*.json) and the rooftop signs. One mesh per tower, one
// per sign. The simulation never sees any of this; the skater cannot reach
// a 50 m roof.

const TEMPLATES = {
  "ponce-city-market": () => import("../../assets/landmarks/ponce-city-market-tower.json"),
  "krog-street-market": () => import("../../assets/landmarks/krog-street-market-front.json"),
};

// A letter card from a baked template (text, colors, size, position).
function cardMesh(card) {
  const transparent = card.background === "transparent";
  const map = createSignTexture(card.text, {
    color: card.color,
    background: card.background,
    condensed: transparent,
    outline: card.outline ?? null,
    height: Math.round((2048 * card.height) / card.width),
  });
  // A light glow from the texture itself keeps sign letters readable in shade.
  const mat = new THREE.MeshStandardMaterial({ map, transparent, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.45 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(card.width, card.height), mat);
  mesh.position.set(...card.position);
  return mesh;
}

function templateGeometry(t) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(t.positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(t.normals, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(t.colors, 3));
  g.setIndex(t.indices);
  g.computeBoundingSphere();
  return g;
}

function signMesh(sign) {
  const group = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(sign.width, sign.height, 0.4), new THREE.MeshToonMaterial({ color: 0x2b2e33 }));
  frame.position.y = sign.height / 2 + 0.8;
  group.add(frame);
  const map = createSignTexture(sign.text);
  const face = new THREE.MeshToonMaterial({ map });
  for (const side of [1, -1]) {
    const card = new THREE.Mesh(new THREE.PlaneGeometry(sign.width * 0.95, sign.height * 0.62), face);
    card.position.set(0, frame.position.y, side * 0.21);
    if (side < 0) card.rotation.y = Math.PI;
    group.add(card);
  }
  for (const x of [-sign.width * 0.35, 0, sign.width * 0.35]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.3), frame.material);
    leg.position.set(x, 0.4, 0);
    group.add(leg);
  }
  group.position.set(sign.x, sign.y, sign.z);
  group.rotation.y = sign.yaw;
  return group;
}

function groupMeshes(t, mats) {
  const out = [];
  for (const [id, grp] of Object.entries(t.groups ?? {})) {
    if (!mats[id]) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(grp.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(grp.normals, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(grp.uvs, 2));
    if (grp.indices) g.setIndex(grp.indices);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats[id]);
    m.name = `landmark-group-${id}`;
    out.push(m);
  }
  return out;
}

// Returns { root, ready } where `ready` resolves when the towers load.
// With `renderer`, the near level gets physical materials and reflections.
export function createLandmarksView(level, { gradientMap = null, renderer = null } = {}) {
  const root = new THREE.Group();
  root.name = "landmarks";
  // `towers` counts every landmark model (towers and fronts).
  const info = { towers: 0, signs: 0, triangles: 0, pbr: 0 };
  const tasks = [];
  for (const p of landmarkPlacements(level)) {
    if (p.sign) {
      root.add(signMesh(p.sign));
      info.signs += 1;
    }
    const load = TEMPLATES[p.id];
    if (!load) continue;
    tasks.push(
      Promise.all([load(), renderer ? landmarkEnvironment(renderer) : null]).then(async ([mod, envMap]) => {
        const t = mod.default ?? mod;
        const lod = new THREE.LOD();
        lod.name = `landmark-${p.id}`;
        const far = new THREE.Group();
        far.add(new THREE.Mesh(templateGeometry(t), new THREE.MeshToonMaterial({ vertexColors: true, gradientMap })));
        const near = new THREE.Group();
        // The occlusion heights are in model meters; the base is the model's
        // world height (a roof for a tower, the ground for a front).
        const parts = t.groups && renderer ? groupMeshes(t, landmarkMaterials({ envMap, overhangs: t.overhangs ?? null, baseY: p.model.y })) : [];
        for (const m of parts) near.add(m);
        for (const card of t.cards ?? []) {
          (parts.length ? near : far).add(cardMesh(card));
          if (parts.length) far.add(cardMesh(card));
        }
        if (parts.length) {
          lod.addLevel(near, 0);
          lod.addLevel(far, LANDMARK_FAR_DISTANCE);
          info.pbr += 1;
        } else {
          lod.addLevel(far, 0);
        }
        // Count the model only when its scan textures have loaded, so a
        // screenshot that waits on `info.towers` shows the final look.
        if (parts.length) await landmarkTexturesReady();
        lod.position.set(p.model.x, p.model.y, p.model.z);
        lod.rotation.y = p.model.yaw;
        root.add(lod);
        info.towers += 1;
        info.triangles += parts.length ? Object.values(t.groups).reduce((n, g) => n + g.positions.length / 9, 0) : t.indices.length / 3;
      }),
    );
  }
  return { root, info, ready: Promise.all(tasks) };
}
