import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Street name signs: a post with two green blades, white letters, as on an
// Atlanta corner. The names are in one canvas atlas (one row per name, and
// a last row in the post color), so the posts and blades share one
// material. The signs are merged into one mesh per SIGN_TILE square, so the
// renderer culls the tiles out of view, and update() hides the far tiles.

const ROW = 64; // px per atlas row.
const ATLAS_W = 1024;
const BLADE_H = 0.24; // m
const BLADE_T = 0.03; // m
const POST_H = 3.1;
const POST_R = 0.045;
const BLADE_Y = [POST_H - 0.05, POST_H - 0.33];
const GREEN = "#0d6b3c";
const POST_COLOR = "#4b5a54";
export const SIGN_TILE = 256; // m
const SIGN_DRAW_DISTANCE = 180; // m from the camera to the nearest tile edge

function makeAtlas(names) {
  // One row per name and one row for the post color.
  const rows = names.length + 1;
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = THREE.MathUtils.ceilPowerOfTwo(Math.max(1, rows) * ROW);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = GREEN;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const widths = [];
  names.forEach((name, i) => {
    const y = i * ROW;
    ctx.fillStyle = GREEN;
    ctx.fillRect(0, y, ATLAS_W, ROW);
    ctx.strokeStyle = "#f4f4f0";
    ctx.fillStyle = "#f8f8f2";
    let size = 42;
    ctx.font = `600 ${size}px "Helvetica Neue", Arial, sans-serif`;
    // Shrink a long name to fit the row.
    while (ctx.measureText(name).width > ATLAS_W - 40 && size > 20) {
      size -= 2;
      ctx.font = `600 ${size}px "Helvetica Neue", Arial, sans-serif`;
    }
    ctx.fillText(name, ATLAS_W / 2, y + ROW / 2 + 2);
    // The blade shows the text and a margin, at the aspect of the row.
    const w = Math.min(ATLAS_W, ctx.measureText(name).width + 44);
    widths.push(w);
    ctx.lineWidth = 3;
    ctx.strokeRect((ATLAS_W - w) / 2 + 5, y + 5, w - 10, ROW - 10);
  });
  ctx.fillStyle = POST_COLOR;
  ctx.fillRect(0, names.length * ROW, ATLAS_W, ROW);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, rows: canvas.height / ROW, widths };
}

// One blade: a thin box. The two big faces show the atlas row; the four
// edges show the green border.
function bladeGeometry(length, row, atlasRows, widthPx) {
  const u0 = 0.5 - widthPx / ATLAS_W / 2;
  const u1 = 0.5 + widthPx / ATLAS_W / 2;
  const g = new THREE.BoxGeometry(length, BLADE_H, BLADE_T);
  const uv = g.attributes.uv;
  const v0 = 1 - (row + 1) / atlasRows;
  const v1 = 1 - row / atlasRows;
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z, 4 vertices each.
  for (let face = 0; face < 6; face += 1) {
    for (let k = 0; k < 4; k += 1) {
      const i = face * 4 + k;
      if (face >= 4) {
        // A face seen from behind reads right to left; flip its u.
        const u = face === 5 ? 1 - uv.getX(i) : uv.getX(i);
        uv.setXY(i, u0 + u * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      } else uv.setXY(i, u0 + 0.001, v0 + 0.03 * (v1 - v0));
    }
  }
  return g;
}

// `signs` are the placements of kind "street_sign": { x, y, z, names, yaws }.
export function createStreetSigns(signs, { gradientMap = null } = {}) {
  const group = new THREE.Group();
  group.name = "street-signs";
  if (!signs.length) return { group, count: 0 };
  const names = [...new Set(signs.flatMap((s) => s.names))].sort();
  const rowOf = new Map(names.map((n, i) => [n, i]));
  const { tex, rows, widths } = makeAtlas(names);

  const postV = 1 - (names.length + 0.5) / rows;
  const tiles = new Map();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const s of signs) {
    const key = `${Math.floor(s.x / SIGN_TILE)},${Math.floor(s.z / SIGN_TILE)}`;
    let parts = tiles.get(key);
    if (!parts) tiles.set(key, (parts = []));
    // No normals-only cap faces, so the post merges with the blades.
    const post = new THREE.CylinderGeometry(POST_R, POST_R * 1.2, POST_H, 8, 1, true);
    const puv = post.attributes.uv;
    for (let i = 0; i < puv.count; i += 1) puv.setXY(i, 0.5, postV);
    post.translate(s.x, s.y + POST_H / 2, s.z);
    parts.push(post);
    s.names.forEach((name, i) => {
      const row = rowOf.get(name);
      const length = (BLADE_H * widths[row]) / ROW;
      const g = bladeGeometry(length, row, rows, widths[row]);
      // The blade hangs off the post on its own street side.
      g.translate(length / 2 - 0.1, 0, 0);
      q.setFromAxisAngle(up, s.yaws[i] ?? 0);
      m.compose(new THREE.Vector3(s.x, s.y + BLADE_Y[i], s.z), q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m);
      parts.push(g.index ? g.toNonIndexed() : g);
    });
  }
  const material = new THREE.MeshToonMaterial({ map: tex, gradientMap });
  const meshes = [];
  for (const [key, parts] of [...tiles].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const geom = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
    const mesh = new THREE.Mesh(geom, material);
    const [ix, iz] = key.split(",").map(Number);
    mesh.userData.box = [ix * SIGN_TILE, iz * SIGN_TILE];
    mesh.name = `street-signs-${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    meshes.push(mesh);
  }
  return {
    group,
    count: signs.length,
    names,
    tiles: meshes.length,
    // Hides the tiles whose nearest edge is past the draw distance.
    update(cameraPosition) {
      for (const mesh of meshes) {
        const [x0, z0] = mesh.userData.box;
        const dx = Math.max(x0 - cameraPosition.x, 0, cameraPosition.x - (x0 + SIGN_TILE));
        const dz = Math.max(z0 - cameraPosition.z, 0, cameraPosition.z - (z0 + SIGN_TILE));
        mesh.visible = Math.hypot(dx, dz) < SIGN_DRAW_DISTANCE;
      }
    },
  };
}
