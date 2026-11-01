import * as THREE from "three";
import { landmarkPlacements } from "../level/geo/landmarks.js";
import { createSignTexture } from "./landmark-signs.js";

// Landmark models on the real roofs: the baked img2threejs tower templates
// (assets/landmarks/*.json) and the rooftop signs. One mesh per tower, one
// per sign. The simulation never sees any of this; the skater cannot reach
// a 50 m roof.

const TEMPLATES = {
  "ponce-city-market": () => import("../../assets/landmarks/ponce-city-market-tower.json"),
};

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

// Returns { root, ready } where `ready` resolves when the towers load.
export function createLandmarksView(level, { gradientMap = null } = {}) {
  const root = new THREE.Group();
  root.name = "landmarks";
  const info = { towers: 0, signs: 0, triangles: 0 };
  const tasks = [];
  for (const p of landmarkPlacements(level)) {
    root.add(signMesh(p.sign));
    info.signs += 1;
    const load = TEMPLATES[p.id];
    if (!load) continue;
    tasks.push(
      load().then((mod) => {
        const t = mod.default ?? mod;
        const mesh = new THREE.Mesh(templateGeometry(t), new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }));
        mesh.name = `landmark-${p.id}`;
        mesh.position.set(p.tower.x, p.tower.y, p.tower.z);
        root.add(mesh);
        info.towers += 1;
        info.triangles += t.indices.length / 3;
      }),
    );
  }
  return { root, info, ready: Promise.all(tasks) };
}
