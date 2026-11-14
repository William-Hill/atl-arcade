// Makes the LOD1 skater model for far NPC skaters (#280).
//
// The script reads a skater GLB (the LOD0 model) and writes a small GLB with
// a simplified skinned mesh of about 3,000 triangles. The LOD1 file keeps:
// - the skin: the 65 mixamorig: joints, in the same order, with the same
//   inverse bind matrices,
// - the skin weights: each vertex that stays keeps its JOINTS_0 and
//   WEIGHTS_0 from LOD0 (the simplifier only removes vertices),
// - the material, with no textures.
// It has no animations: the game binds the LOD1 mesh to the skeleton of the
// LOD0 clone (src/render/skater-model.js), so the LOD0 clips move it.
//
// The Tripo UV map of the skater has many small islands. A simplifier that
// keeps the UV seams stops at about 7,000 triangles, and a simplifier that
// collapses the seams smears the texture. Thus the default mode ("color")
// bakes the base color texture into vertex colors (COLOR_0) and removes the
// UVs. Then the vertices at one position weld into one vertex, and the
// simplifier reaches the target with no seams. The "uv" mode keeps the UVs
// and the seams, for comparison.
//
// Usage:
//   node scripts/skater-lod.mjs [--model nia] [--target 3000] [--mode color|uv]
//     [--error 0.05] [--in <file>] [--out <file>]
// The default input is assets/skaters/<model>/skater.glb and the default
// output is assets/skaters/<model>/skater-lod1.glb.

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { compactPrimitive, prune, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { getPixels } from "ndarray-pixels";
import draco3d from "draco3dgltf";
import { statSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const model = arg("model", "nia");
const input = arg("in", `assets/skaters/${model}/skater.glb`);
const output = arg("out", `assets/skaters/${model}/skater-lod1.glb`);

// The settings. The attribute weights tell the simplifier how much a change
// of the normal and of the color costs, compared to a change of the position
// (in units of the mesh radius).
const SETTINGS = {
  mode: arg("mode", "color"),
  targetTriangles: Number(arg("target", "3000")),
  targetError: Number(arg("error", "0.05")),
  weights: { normal: 0.25, color: 1, uv: 1 },
  flags: ["Prune"],
  // The color of a vertex is the mean of the texels in a square of this
  // half size (texels) around its UV, in linear color.
  colorRadius: 4,
  // The same quantization as the LOD0 export (M1-01). The sequential method
  // keeps the vertex count of the mesh.
  draco: { method: "sequential", quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8, quantizeTexcoord: 12, quantizeGeneric: 12 },
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});

await MeshoptSimplifier.ready;
const doc = await io.read(input);
const root = doc.getRoot();
await doc.transform(weld());

// Pure: sRGB (0..1) to linear.
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// A texture sampler: the mean linear RGB of the texels around a UV. The UV
// wraps (glTF REPEAT). glTF UV (0, 0) is the top left texel.
async function textureSampler(texture, radius) {
  const pixels = await getPixels(texture.getImage(), texture.getMimeType());
  const [w, h] = pixels.shape;
  const lin = new Float32Array(256).map((_, i) => srgbToLinear(i / 255));
  return (u, v) => {
    const cx = Math.floor((u - Math.floor(u)) * w);
    const cy = Math.floor((v - Math.floor(v)) * h);
    const sum = [0, 0, 0];
    let n = 0;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = (((cx + dx) % w) + w) % w;
        const y = (((cy + dy) % h) + h) % h;
        for (let c = 0; c < 3; c += 1) sum[c] += lin[pixels.get(x, y, c)];
        n += 1;
      }
    }
    return sum.map((s) => s / n);
  };
}

// Reads all elements of an accessor into a Float32Array (n * size).
function readAll(acc) {
  const size = acc.getElementSize();
  const out = new Float32Array(acc.getCount() * size);
  const el = new Array(size).fill(0);
  for (let i = 0; i < acc.getCount(); i += 1) out.set(acc.getElement(i, el), i * size);
  return out;
}

// Makes an accessor like `like` (the same type and component type) with the
// elements of `rows` in the order of `pick` (the source row of each new row).
function pickRows(like, pick) {
  const size = like.getElementSize();
  const ArrayType = like.getArray().constructor;
  const acc = like.clone().setArray(new ArrayType(pick.length * size));
  const el = new Array(size).fill(0);
  pick.forEach((src, i) => acc.setElement(i, like.getElement(src, el)));
  return acc;
}

// Color mode: welds the vertices at one position into one vertex, with a
// vertex color from the texture. Returns the attribute arrays for the
// simplifier.
async function toColorMesh(prim) {
  const pos = prim.getAttribute("POSITION");
  const n = pos.getCount();
  const positions = readAll(pos);
  const normals = readAll(prim.getAttribute("NORMAL"));
  const uvs = readAll(prim.getAttribute("TEXCOORD_0"));
  const sample = await textureSampler(prim.getMaterial().getBaseColorTexture(), SETTINGS.colorRadius);

  // One new vertex for each position. Its normal and its color are the mean
  // of the old vertices at that position. Its skin is the skin of the first
  // old vertex at that position; `skinMismatch` counts the old vertices with
  // another skin (it must be 0).
  const remap = MeshoptSimplifier.generatePositionRemap(positions, 3);
  const newIndex = new Int32Array(n).fill(-1);
  const pick = [];
  for (let i = 0; i < n; i += 1) {
    if (newIndex[remap[i]] < 0) {
      newIndex[remap[i]] = pick.length;
      pick.push(remap[i]);
    }
  }
  const m = pick.length;
  const sum = new Float32Array(m * 6);
  const count = new Uint32Array(m);
  let skinMismatch = 0;
  const joints = prim.getAttribute("JOINTS_0");
  const weights = prim.getAttribute("WEIGHTS_0");
  const ja = [0, 0, 0, 0];
  const jb = [0, 0, 0, 0];
  const wa = [0, 0, 0, 0];
  const wb = [0, 0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const k = newIndex[remap[i]];
    const rgb = sample(uvs[i * 2], uvs[i * 2 + 1]);
    for (let c = 0; c < 3; c += 1) {
      sum[k * 6 + c] += normals[i * 3 + c];
      sum[k * 6 + 3 + c] += rgb[c];
    }
    count[k] += 1;
    if (i !== pick[k]) {
      joints.getElement(i, ja);
      joints.getElement(pick[k], jb);
      weights.getElement(i, wa);
      weights.getElement(pick[k], wb);
      if (ja.some((j, q) => j !== jb[q] || Math.abs(wa[q] - wb[q]) > 1e-3)) skinMismatch += 1;
    }
  }
  const nrm = new Float32Array(m * 3);
  const col = new Float32Array(m * 3);
  for (let k = 0; k < m; k += 1) {
    const len = Math.hypot(sum[k * 6], sum[k * 6 + 1], sum[k * 6 + 2]) || 1;
    for (let c = 0; c < 3; c += 1) {
      nrm[k * 3 + c] = sum[k * 6 + c] / len;
      col[k * 3 + c] = sum[k * 6 + 3 + c] / count[k];
    }
  }

  // The new primitive: the POSITION, JOINTS_0, and WEIGHTS_0 rows of the
  // first vertex at each position, the mean NORMAL, and COLOR_0. No UV.
  const old = [pos, prim.getAttribute("NORMAL"), prim.getAttribute("TEXCOORD_0"), joints, weights];
  const buffer = pos.getBuffer();
  prim.setAttribute("POSITION", pickRows(pos, pick));
  prim.setAttribute("JOINTS_0", pickRows(joints, pick));
  prim.setAttribute("WEIGHTS_0", pickRows(weights, pick));
  prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(nrm).setBuffer(buffer));
  prim.setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(col).setBuffer(buffer));
  prim.setAttribute("TEXCOORD_0", null);
  for (const a of old) if (a.listParents().every((p) => p.propertyType === "Root")) a.dispose();
  const idx = prim.getIndices();
  const oldIdx = idx.getArray();
  const tri = new Uint32Array(oldIdx.length);
  for (let i = 0; i < oldIdx.length; i += 1) tri[i] = newIndex[remap[oldIdx[i]]];
  idx.setArray(tri);
  const attrs = new Float32Array(m * 6);
  for (let k = 0; k < m; k += 1) attrs.set([nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2], col[k * 3], col[k * 3 + 1], col[k * 3 + 2]], k * 6);
  const { normal, color } = SETTINGS.weights;
  return {
    positions: readAll(prim.getAttribute("POSITION")),
    attrs,
    stride: 6,
    attrWeights: [normal, normal, normal, color, color, color],
    note: `welded ${n} -> ${m} vertices, ${skinMismatch} vertices with another skin at the same position`,
  };
}

// UV mode: the attributes as they are. Without the "Permissive" flag the
// simplifier keeps the UV seams.
function toUvMesh(prim) {
  const positions = readAll(prim.getAttribute("POSITION"));
  const normals = readAll(prim.getAttribute("NORMAL"));
  const uvs = readAll(prim.getAttribute("TEXCOORD_0"));
  const n = positions.length / 3;
  const attrs = new Float32Array(n * 5);
  for (let i = 0; i < n; i += 1) attrs.set([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2], uvs[i * 2], uvs[i * 2 + 1]], i * 5);
  const { normal, uv } = SETTINGS.weights;
  return { positions, attrs, stride: 5, attrWeights: [normal, normal, normal, uv, uv], note: "UV seams kept" };
}

const before = { triangles: 0, vertices: 0 };
const after = { triangles: 0, vertices: 0 };
const notes = [];
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    before.triangles += prim.getIndices().getCount() / 3;
    before.vertices += prim.getAttribute("POSITION").getCount();
    const data = SETTINGS.mode === "color" ? await toColorMesh(prim) : toUvMesh(prim);
    notes.push(data.note);
    const indices = new Uint32Array(prim.getIndices().getArray());
    const [out, error] = MeshoptSimplifier.simplifyWithAttributes(
      indices,
      data.positions,
      3,
      data.attrs,
      data.stride,
      data.attrWeights,
      null,
      SETTINGS.targetTriangles * 3,
      SETTINGS.targetError,
      SETTINGS.flags,
    );
    notes.push(`${mesh.getName() || "mesh"}: ${indices.length / 3} -> ${out.length / 3} triangles, error ${error.toFixed(4)}`);
    prim.getIndices().setArray(out);
    compactPrimitive(prim);
    after.triangles += prim.getIndices().getCount() / 3;
    after.vertices += prim.getAttribute("POSITION").getCount();
  }
}

// No clips: the game takes them from LOD0.
for (const anim of root.listAnimations()) {
  for (const sampler of anim.listSamplers()) {
    sampler.getInput()?.dispose();
    sampler.getOutput()?.dispose();
    sampler.dispose();
  }
  for (const channel of anim.listChannels()) channel.dispose();
  anim.dispose();
}
// No textures: the color mode has vertex colors, and the game uses the LOD0
// material in the uv mode.
for (const mat of root.listMaterials()) {
  mat.setBaseColorTexture(null);
  mat.setNormalTexture(null);
  mat.setMetallicRoughnessTexture(null);
  mat.setOcclusionTexture(null);
  mat.setEmissiveTexture(null);
}
await doc.transform(prune({ keepLeaves: true, keepAttributes: true }));

const d = SETTINGS.draco;
doc
  .createExtension(KHRDracoMeshCompression)
  .setRequired(true)
  .setEncoderOptions({
    method: d.method === "sequential" ? KHRDracoMeshCompression.EncoderMethod.SEQUENTIAL : KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
    quantizationBits: { POSITION: d.quantizePosition, NORMAL: d.quantizeNormal, COLOR: d.quantizeColor, TEX_COORD: d.quantizeTexcoord, GENERIC: d.quantizeGeneric },
  });
await io.write(output, doc);

const skin = root.listSkins()[0];
const report = {
  input,
  output,
  settings: SETTINGS,
  notes,
  before,
  after,
  joints: skin?.listJoints().length ?? 0,
  mixamoJoints: skin?.listJoints().filter((j) => j.getName().startsWith("mixamorig:")).length ?? 0,
  animations: root.listAnimations().length,
  bytes: statSync(output).size,
};
console.log(JSON.stringify(report, null, 2));
