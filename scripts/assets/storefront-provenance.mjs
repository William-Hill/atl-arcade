// Writes assets/storefronts/provenance.json from the Blender stats
// (assets/storefronts/stats.json, written by scripts/blender/storefronts.py)
// and the businesses list. Run after the generator.
//   node scripts/assets/storefront-provenance.mjs [--meshy-credits 0]
import { readFileSync, statSync, writeFileSync } from "node:fs";

const DIR = "assets/storefronts";
const args = process.argv.slice(2);
const credits = Number(args.includes("--meshy-credits") ? args[args.indexOf("--meshy-credits") + 1] : 0);
const stats = JSON.parse(readFileSync(`${DIR}/stats.json`, "utf8"));
const atlas = JSON.parse(readFileSync(`${DIR}/storefront-atlas.json`, "utf8"));
const { businesses } = JSON.parse(readFileSync("scripts/assets/storefront-businesses.json", "utf8"));
const blenderVersion = readFileSync(`${DIR}/stats.json`, "utf8") && process.env.BLENDER_VERSION ? process.env.BLENDER_VERSION : "5.2.3";
// One 1024 x 1024 RGBA8 texture with a full mip chain.
const ATLAS_GPU = Math.round(atlas.size * atlas.size * 4 * (4 / 3));

const files = {};
for (const [file, s] of Object.entries(stats)) {
  const nodes = Object.entries(s.nodes);
  const lod0 = nodes.filter(([n]) => !n.endsWith("_lod1"));
  files[file] = {
    bytes: statSync(`${DIR}/${file}`).size,
    draco: true,
    pieces: lod0.length,
    lod1: nodes.length - lod0.length,
    triangles: { min: Math.min(...lod0.map(([, v]) => v.triangles)), max: Math.max(...lod0.map(([, v]) => v.triangles)), unique: s.unique_triangles },
    textures: s.textured ? [{ uri: atlas.image, size: `${atlas.size}x${atlas.size}`, format: "JPEG q0.90", shared: true }] : [],
    gpuTextureBytes: s.textured ? ATLAS_GPU : 0,
    nodes: Object.fromEntries(nodes),
  };
}
const prov = {
  asset: "storefronts",
  description: "Storefront dressing for the BeltLine Eastside level (pbr look): sign boards, blade signs, emissive neon signs, menu boards, sandwich boards, cafe barrier banners, patio furniture sets, market umbrellas, and string lights for invented Eastside businesses. No real business names, logos, or artwork.",
  generated: new Date().toISOString().slice(0, 10),
  tool: {
    geometry: `Blender ${blenderVersion} headless, scripts/blender/storefronts.py (procedural: boxes, swept tubes, extruded outlines; no imported meshes)`,
    signArt: "scripts/assets/storefront-atlas.mjs: Chromium 2D canvas via Playwright, original vector shapes and lettering drawn in code with system DejaVu fonts (Bitstream Vera license, free to embed in rasterized art); no image model, no photos, no third-party artwork",
    export: "glTF 2.0 GLB, KHR_draco_mesh_compression (level 7, position 14 bit, uv 14 bit, normal 10 bit, color 8 bit), KHR_materials_emissive_strength on sf_neon",
  },
  prompt: "none (no generative model). Business names, taglines, colors, and icons are defined in scripts/assets/storefront-businesses.json",
  credits: { meshy: credits, note: "Meshy was not used: the procedural Blender props met the bar, so the 45-credit cap was untouched." },
  license: "Original work for ATL Arcade.",
  atlas: { file: atlas.image, size: atlas.size, bytes: statSync(`${DIR}/${atlas.image}`).size, regions: Object.keys(atlas.regions).length, gpuTextureBytes: ATLAS_GPU, layout: `${atlas.image.replace(".jpg", ".json")}` },
  businesses: businesses.map(({ id, name, kind, concept }) => ({ id, name, kind, concept })),
  budget: {
    totalBytes: Object.values(files).reduce((s, f) => s + f.bytes, 0) + statSync(`${DIR}/${atlas.image}`).size,
    gpuTextureBytesShared: ATLAS_GPU,
    note: "Every textured GLB references the one external storefront-atlas.jpg; with a shared texture (one GLTFLoader / cache) the GPU holds one 5.6 MB atlas for all files. Loaded with independent loaders, each textured file decodes its own copy.",
  },
  files,
};
writeFileSync(`${DIR}/provenance.json`, JSON.stringify(prov, null, 2) + "\n");
console.log(Object.entries(files).map(([f, v]) => `${f}\t${v.pieces}+${v.lod1}\t${v.triangles.min}-${v.triangles.max}\t${v.bytes}\t${v.textures.length}`).join("\n"));
