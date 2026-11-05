import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// The shop name boards (src/level/geo/shop-signs.js): a painted board with
// cream letters and a cream border on the front wall of a shop. The names
// are in one canvas atlas (one row per board), so all boards share one
// material and one mesh. update() hides the boards far from the camera.

const ROW = 96; // px per atlas row.
const ATLAS_W = 1024;
const PAD = 56; // px of margin on each side of the text.
const DEPTH = 0.06; // m
const CREAM = "#f6efdc";
// The boards show within this distance (m) of the camera.
export const SHOP_SIGN_DISTANCE = 160;

// Pure: the board width (m) for a text width of `textPx` in a row of ROW px,
// at a board height `height`, kept between `minWidth` and `maxWidth`.
export function boardWidth(textPx, height, maxWidth, minWidth = 1.2) {
  return Math.min(maxWidth, Math.max(minWidth, ((textPx + 2 * PAD) / ROW) * height));
}

function makeAtlas(boards) {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = THREE.MathUtils.ceilPowerOfTwo(Math.max(1, boards.length) * ROW);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const widths = [];
  boards.forEach((b, i) => {
    const y = i * ROW;
    // The widest text that fits the board at its height.
    const maxPx = Math.min(ATLAS_W, (b.maxWidth / b.height) * ROW) - 2 * PAD;
    let size = 58;
    const font = () => `700 ${size}px Georgia, "Times New Roman", serif`;
    ctx.font = font();
    while (ctx.measureText(b.name).width > maxPx && size > 24) {
      size -= 2;
      ctx.font = font();
    }
    const textPx = Math.min(maxPx, ctx.measureText(b.name).width);
    const w = Math.round(Math.min(ATLAS_W, textPx + 2 * PAD));
    widths.push(textPx);
    const x0 = (ATLAS_W - w) / 2;
    ctx.fillStyle = b.color;
    ctx.fillRect(0, y, ATLAS_W, ROW);
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = 5;
    ctx.strokeRect(x0 + 10, y + 10, w - 20, ROW - 20);
    ctx.fillStyle = CREAM;
    ctx.fillText(b.name, ATLAS_W / 2, y + ROW / 2 + 3, maxPx);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, rows: canvas.height / ROW, widths };
}

// `boards` are shopSigns() entries. `material(params)` makes the lit
// material of the look (look.js litMaterial()).
export function createShopSigns(boards, material) {
  const group = new THREE.Group();
  group.name = "shop-signs";
  if (!boards.length) return { group, count: 0, names: [], update() {} };
  const { tex, rows, widths } = makeAtlas(boards);
  const parts = [];
  const centers = [];
  boards.forEach((b, i) => {
    const width = boardWidth(widths[i], b.height, b.maxWidth);
    const wPx = (width / b.height) * ROW;
    const u0 = 0.5 - Math.min(1, wPx / ATLAS_W) / 2;
    const u1 = 1 - u0;
    const v0 = 1 - (i + 1) / rows;
    const v1 = 1 - i / rows;
    const g = new THREE.BoxGeometry(width, b.height, DEPTH);
    const uv = g.attributes.uv;
    // BoxGeometry faces: +x, -x, +y, -y, +z, -z, 4 vertices each. The +z
    // face shows the row; the other faces show the board color.
    for (let k = 0; k < uv.count; k += 1) {
      const face = Math.floor(k / 4);
      if (face === 4) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
      else uv.setXY(k, 0.002, v0 + 0.5 * (v1 - v0));
    }
    g.rotateY(b.yaw);
    g.translate(b.x, b.y, b.z);
    parts.push(g.index ? g.toNonIndexed() : g);
    centers.push([b.x, b.z]);
  });
  const mesh = new THREE.Mesh(mergeGeometries(parts), material({ map: tex }));
  mesh.name = "shop-signs";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return {
    group,
    count: boards.length,
    names: boards.map((b) => b.name),
    // Shows the boards when one of them is near the camera.
    update(p) {
      let near = false;
      for (const [x, z] of centers) if (Math.hypot(x - p.x, z - p.z) < SHOP_SIGN_DISTANCE) near = true;
      mesh.visible = near;
    },
  };
}
