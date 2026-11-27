// Prints the runtime cost of a GLB: vertices, triangles, morph targets,
// skin joints, the most weights on one vertex, animations and textures.
// Usage: node scripts/research/glb-stats.mjs <file.glb> [--json]
import { statSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";

const file = process.argv[2];
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
const doc = await io.read(file);
const root = doc.getRoot();

const meshes = [];
let verts = 0;
let tris = 0;
let morphVerts = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const v = prim.getAttribute("POSITION").getCount();
    const idx = prim.getIndices();
    const t = (idx ? idx.getCount() : v) / 3;
    const morphs = prim.listTargets().length;
    // The number of joint sets (JOINTS_0, JOINTS_1, ...) gives 4, 8, ... weights.
    const jointSets = prim.listSemantics().filter((s) => s.startsWith("JOINTS_")).length;
    meshes.push({ mesh: mesh.getName(), verts: v, tris: t, morphs, weightsPerVertex: jointSets * 4 });
    verts += v;
    tris += t;
    morphVerts += v * morphs;
  }
}
const skins = root.listSkins().map((s) => s.listJoints().length);
const textures = root.listTextures().map((t) => {
  const size = t.getSize();
  return { name: t.getName(), mime: t.getMimeType(), size: size ? `${size[0]}x${size[1]}` : "?", bytes: t.getImage()?.byteLength ?? 0 };
});
const stats = {
  file,
  bytes: statSync(file).size,
  verts,
  tris,
  morphVerts,
  skins,
  animations: root.listAnimations().length,
  meshes,
  textures,
};
if (process.argv.includes("--json")) console.log(JSON.stringify(stats, null, 1));
else {
  console.log(`${file}: ${(stats.bytes / 1e6).toFixed(2)} MB, ${verts} verts, ${tris} tris, skins ${skins.join("/")}, ${stats.animations} anims`);
  for (const m of meshes) console.log(`  ${m.mesh}: ${m.verts} v, ${m.tris} t, ${m.morphs} morphs, ${m.weightsPerVertex} w/v`);
  for (const t of textures) console.log(`  tex ${t.name} ${t.mime} ${t.size} ${(t.bytes / 1e6).toFixed(2)} MB`);
}
