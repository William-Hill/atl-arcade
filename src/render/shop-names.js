import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hash32 } from "../level/geo/styles.js";
import { terrainOf } from "../level/geo/terrain.js";
import { litMaterial, ROUGHNESS } from "./look.js";

// Shop-name decals on the kit's sign boards, and district names painted on
// the trail — the teleoperator "real names" cue (docs/research). One canvas
// atlas holds every name, one row each, so all the decals share one material
// and merge into one mesh.
//
// The shop names are invented: plausible BeltLine businesses, no real
// trademarks (the same dodge as the teleoperator billboard brands).
const SHOP_NAMES = [
  "BeltLine Roasters", "O4W Cycle Works", "Krog St. Books", "Irwin Provisions",
  "Ponce Slice Co.", "Auburn Ave. Records", "Edgewood Sweets", "Inman Petal & Stem",
  "Studio Donuts", "Ridge Walk Coffee", "Freedom Bakery", "Highland Thread & Co.",
  "Fourth Ward Diner", "BeltLine Books & Brew", "Krog Corner Market", "Ponce City Cuts",
  "Auburn Bloom Co.", "Edgewood Eats & Tea", "Inman Ink Studio", "Flat Shoals Pizza",
  "Vine & Rye Deli", "Copenhill Ceramics", "Grant Park Grains", "Summerhill Sundries",
];
const DISTRICT_LABELS = ["PONCEY-HIGHLAND", "OLD FOURTH WARD", "INMAN PARK"];

const ROW = 64;
const ATLAS_W = 1024;

function makeAtlas() {
  const names = [...SHOP_NAMES, ...DISTRICT_LABELS];
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = THREE.MathUtils.ceilPowerOfTwo(names.length * ROW);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  names.forEach((name, i) => {
    const y = i * ROW + ROW / 2;
    let size = i < SHOP_NAMES.length ? 34 : 52;
    ctx.font = `700 ${size}px "Helvetica Neue", Arial, sans-serif`;
    while (ctx.measureText(name).width > ATLAS_W - 30 && size > 16) {
      size -= 2;
      ctx.font = `700 ${size}px "Helvetica Neue", Arial, sans-serif`;
    }
    ctx.fillStyle = i < SHOP_NAMES.length ? "#241c14" : "#f2ece0";
    ctx.fillText(name, ATLAS_W / 2, y + 1);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, rows: names.length };
}

// One quad in the atlas row `row`, around `center`, facing `n` (horizontal),
// `w` x `h` meters. `up` gives the quad's vertical: [0,1,0] for a wall
// decal, the trail's cross direction for a ground decal.
function decalQuad(g, center, n, up, w, h, row, rows) {
  const nx = n[0], nz = n[1];
  const t = [nz, 0, -nx]; // tangent, right of the decal
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  const base = g.attributes.position.count;
  const pos = g.attributes.position.array;
  const uv = g.attributes.uv.array;
  const nor = g.attributes.normal.array;
  for (const [i, [a, b]] of corners.entries()) {
    const j = base + i;
    pos[j * 3] = center[0] + t[0] * a + up[0] * b + nx * 0.03;
    pos[j * 3 + 1] = center[1] + t[1] * a + up[1] * b;
    pos[j * 3 + 2] = center[2] + t[2] * a + up[2] * b + nz * 0.03;
    nor[j * 3] = nx;
    nor[j * 3 + 1] = up[1] === 0 ? 0 : up[1];
    nor[j * 3 + 2] = nz;
    uv[j * 2] = a < 0 ? 0.02 : 0.98;
    uv[j * 2 + 1] = 1 - (row + (b < 0 ? 0.92 : 0.08)) / rows;
  }
  const idx = g.index.array;
  const k = g.index.count;
  idx[k] = base; idx[k + 1] = base + 1; idx[k + 2] = base + 2;
  idx[k + 3] = base; idx[k + 4] = base + 2; idx[k + 5] = base + 3;
  g.index.count += 6;
}

// The nearest point on the trail strips to (x, z), with the trail tangent.
function nearestOnTrail(level, x, z) {
  let best = null;
  for (const s of level.strips ?? []) {
    if (s.kind !== "trail") continue;
    const line = s.points;
    for (let i = 0; i < line.length - 1; i += 1) {
      const [ax, az] = line[i];
      const [bx, bz] = line[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      const px = ax + t * dx;
      const pz = az + t * dz;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) best = { d, x: px, z: pz, tx: dx / Math.sqrt(l2 || 1), tz: dz / Math.sqrt(l2 || 1) };
    }
  }
  return best;
}

// The district anchor centroids (styles.js DISTRICTS, name-keyed).
const DISTRICT_ANCHORS = [
  { label: 0, name: "Ponce City Market" },
  { label: 1, name: "Iris O4W" },
  { label: 2, name: "Krog Street Market" },
];

// All the shop-name decals and the district trail labels in one mesh, with
// the shared atlas material. `boards` are the sign-board placements the
// facade kit collects (facade-kit.js signBay()).
export function shopNamesMesh(boards, level, look = "toon") {
  const { tex, rows } = makeAtlas();
  const quads = boardQuads(boards);
  // The district name on the trail near each anchor (the teleoperator map
  // labels): flat, along the trail, where a runner reads it.
  for (const a of DISTRICT_ANCHORS) {
    const b = (level.buildings ?? []).find((x) => x.name === a.name);
    if (!b) continue;
    let cx = 0, cz = 0;
    for (const p of b.outer) { cx += p[0]; cz += p[1]; }
    const near = nearestOnTrail(level, cx / b.outer.length, cz / b.outer.length);
    if (!near) continue;
    const y = terrainOf(level).height(near.x, near.z) + 0.04;
    quads.push({ c: [near.x, y, near.z], n: [0, -1], up: [-near.tx, 0, -near.tz], w: 10, h: 1.9, row: SHOP_NAMES.length + a.label });
  }
  if (!quads.length) return null;
  const mesh = decalMesh(quads, rows, namesMaterial(look, tex));
  mesh.frustumCulled = false;
  return mesh;
}

// The shop-name decals of grouped boards (the GLB sign boards of each depth
// tile, facade-kit-view.js): Map(key -> mesh), one shared atlas material.
export function boardNamesMeshes(groups, look = "pbr") {
  const { tex, rows } = makeAtlas();
  const mat = namesMaterial(look, tex);
  const out = new Map();
  for (const [key, boards] of groups) {
    if (!boards.length) continue;
    const mesh = decalMesh(boardQuads(boards), rows, mat);
    mesh.geometry.computeBoundingSphere();
    out.set(key, mesh);
  }
  return out;
}

function boardQuads(boards) {
  return boards.map((b) => ({ c: [b.x, b.y, b.z], n: [b.nx, b.nz], up: [0, 1, 0], w: b.w * 0.96, h: b.h * 0.8, row: hash32(`${Math.round(b.x * 4)},${Math.round(b.z * 4)}`) % SHOP_NAMES.length }));
}

function namesMaterial(look, tex) {
  return litMaterial(look, { map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }, { roughness: ROUGHNESS.props, envLight: 0.6 });
}

function decalMesh(quads, rows, mat) {
  const g = new THREE.BufferGeometry();
  const n = quads.length * 4;
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(quads.length * 6), 1));
  g.index.count = 0;
  for (const q of quads) {
    // A ground decal's "normal" is up; its face points the other way.
    if (q.up[1] === 0) {
      // Lay the quad flat: up points along the trail, the face looks down.
      decalQuad(g, q.c, q.n, q.up, q.w, q.h, q.row, rows);
      // Flip it to look up, and fix its normal.
      const idx = g.index.array;
      const k = g.index.count - 6;
      const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t;
      const t2 = idx[k + 4]; idx[k + 4] = idx[k + 5]; idx[k + 5] = t2;
      const base = g.attributes.position.count - 4;
      for (let i = 0; i < 4; i += 1) {
        const j = (base + i) * 3;
        g.attributes.normal.array[j] = 0;
        g.attributes.normal.array[j + 1] = 1;
        g.attributes.normal.array[j + 2] = 0;
      }
    } else {
      decalQuad(g, q.c, q.n, q.up, q.w, q.h, q.row, rows);
    }
  }
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = "shop-names";
  return mesh;
}
