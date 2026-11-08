import * as THREE from "three";
import { litMaterial } from "./look.js";
import { EDGE_FENCE, fencePosts } from "../level/edge-fence.js";

// The level edge fence (#229, src/level/edge-fence.js): a temporary
// construction fence with a printed scrim, on steel posts in block feet.
// Construction fencing, not police tape or traffic barriers (AGENTS.md).

export const FENCE_LOOK = {
  scrimBottom: 0.12, // m from the ground to the bottom of the scrim.
  scrimTop: 2.0, // m from the ground to the top of the scrim.
  postSize: 0.06, // m, the square steel post.
  foot: [0.62, 0.16, 0.24], // m, the block foot (along the fence, up, across).
  scrimColor: "#1f6f78", // BeltLine teal.
  stripeColor: "#f2a541", // warm orange stripe.
  textColor: "#fdf6e3",
  postColor: 0x9aa3a8,
  footColor: 0x5b6166,
};

// Pure: the ground height for each post. `sample(x, z)` is the level ground
// with no fence; `floor(x, z)` is the bare terrain. On a building or a prop
// the fence stands on the terrain, so it goes through the building at the
// ground and not over its roof.
export function postHeights(posts, sample, floor, isSolid) {
  return posts.map(([x, z]) => {
    const g = sample(x, z);
    if (!g || isSolid(g.id)) return floor(x, z);
    return g.height;
  });
}

// Pure: the scrim quads as flat arrays (two triangles for each panel). Each
// panel maps the full texture width; v runs from the bottom to the top.
export function scrimArrays(posts, heights, k = FENCE_LOOK) {
  const n = posts.length - 1;
  const position = new Float32Array(n * 6 * 3);
  const uv = new Float32Array(n * 6 * 2);
  for (let i = 0; i < n; i += 1) {
    const [ax, az] = posts[i];
    const [bx, bz] = posts[i + 1];
    const ha = heights[i];
    const hb = heights[i + 1];
    const v = [
      [ax, ha + k.scrimBottom, az, 0, 0],
      [bx, hb + k.scrimBottom, bz, 1, 0],
      [bx, hb + k.scrimTop, bz, 1, 1],
      [ax, ha + k.scrimBottom, az, 0, 0],
      [bx, hb + k.scrimTop, bz, 1, 1],
      [ax, ha + k.scrimTop, az, 0, 1],
    ];
    v.forEach(([x, y, z, u, w], j) => {
      position.set([x, y, z], (i * 6 + j) * 3);
      uv.set([u, w], (i * 6 + j) * 2);
    });
  }
  return { position, uv };
}

function scrimTexture(k = FENCE_LOOK) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const g = canvas.getContext("2d");
  g.fillStyle = k.scrimColor;
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = k.stripeColor;
  g.fillRect(0, 22, 512, 18);
  g.fillRect(0, 216, 512, 18);
  g.fillStyle = k.textColor;
  g.font = "bold 72px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("SKATE ATL", 256, 130);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// `fence` is the env fence (createLevelEnv). `sample(x, z)` is the level
// ground with no fence, `floor(x, z)` the terrain height, and `isSolid(id)`
// true for a building or a prop.
export function createEdgeFenceView(fence, { sample, floor, isSolid = () => false, look = "toon", gradientMap = null, k = FENCE_LOOK } = {}) {
  const group = new THREE.Group();
  group.name = "edge-fence";
  if (!fence) return { group, panels: 0 };
  const posts = fencePosts(fence, EDGE_FENCE.panel);
  const heights = postHeights(posts, sample, floor, isSolid);

  const { position, uv } = scrimArrays(posts, heights, k);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  const scrimMaterial = litMaterial(look, { map: scrimTexture(k), side: THREE.DoubleSide }, { gradientMap, roughness: 0.85, envLight: 0.6 });
  const scrim = new THREE.Mesh(geom, scrimMaterial);
  scrim.name = "edge-fence-scrim";
  scrim.receiveShadow = true;
  scrim.matrixAutoUpdate = false;
  group.add(scrim);

  // The posts and the feet: one of each at every post (the last post is the
  // first one again).
  const count = posts.length - 1;
  const postH = k.scrimTop + 0.1;
  const postGeom = new THREE.BoxGeometry(k.postSize, postH, k.postSize);
  postGeom.translate(0, postH / 2, 0);
  const footGeom = new THREE.BoxGeometry(...k.foot);
  footGeom.translate(0, k.foot[1] / 2, 0);
  const postMesh = new THREE.InstancedMesh(postGeom, litMaterial(look, { color: k.postColor }, { gradientMap, roughness: 0.45, envLight: 0.8 }), count);
  const footMesh = new THREE.InstancedMesh(footGeom, litMaterial(look, { color: k.footColor }, { gradientMap, roughness: 0.9 }), count);
  postMesh.name = "edge-fence-posts";
  footMesh.name = "edge-fence-feet";
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i += 1) {
    const [x, z] = posts[i];
    const [nx, nz] = posts[i + 1];
    q.setFromAxisAngle(up, Math.atan2(-(nz - z), nx - x));
    m.compose(new THREE.Vector3(x, heights[i], z), q, one);
    postMesh.setMatrixAt(i, m);
    footMesh.setMatrixAt(i, m);
  }
  for (const mesh of [postMesh, footMesh]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return { group, panels: count, posts, heights };
}
