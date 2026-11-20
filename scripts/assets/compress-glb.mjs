// Re-encodes a pbr-look GLB for a smaller download (#190), as
// compress-skaters.mjs does for the skaters (#187):
//
// - Textures: JPEG or PNG to WebP (EXT_texture_webp). --max-size <px> also
//   scales down a texture whose longest side is larger (kept to a power of 2).
// - Clips (only with --clips): resampled (tolerance 1e-4) and the rotation
//   keys stored as normalized int16 quaternions.
// - Meshes: Draco again, with the same quantization as the Blender export
//   (position 14, normal 10, texcoord 12, generic 12).
//
// The meshes, the node names, the materials, and the clip names do not change.
//
// The tools are not in package.json. Install them once, without saving:
//   npm i --no-save @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 \
//     @gltf-transform/functions@4.5.1 draco3dgltf@1.5.9 sharp@0.35.5
//   node scripts/assets/compress-glb.mjs <in.glb> <out.glb> [--quality 82] [--normal-quality 88] [--max-size 1024] [--clips]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { prune, resample, textureCompress } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import sharp from "sharp";

const args = process.argv.slice(2);
const flags = new Set(["--clips"]);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const files = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1]?.startsWith("--") && !flags.has(args[i - 1])));
const [input, output] = files;
if (!input || !output) {
  console.error("usage: compress-glb.mjs <in.glb> <out.glb> [--quality 82] [--normal-quality 88] [--max-size 1024] [--clips]");
  process.exit(1);
}
// gltf-transform picks the format from the extension: a path not ending in
// .glb gets a .gltf JSON with loose files next to it.
if (!output.endsWith(".glb")) {
  console.error("the output path must end in .glb");
  process.exit(1);
}
const quality = opt("--quality", 82);
const normalQuality = opt("--normal-quality", 88);
const maxSize = opt("--max-size", 0);
const clips = args.includes("--clips");

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});

const doc = await io.read(input);
const root = doc.getRoot();
const before = {
  clips: root.listAnimations().map((a) => a.getName()).join(),
  nodes: root.listNodes().map((n) => n.getName()).join(),
  materials: root.listMaterials().map((m) => m.getName()).join(),
};

// Float quaternion keys to normalized int16 (x 32767).
function int16Rotations() {
  return (document) => {
    const done = new Set();
    for (const anim of document.getRoot().listAnimations()) {
      for (const channel of anim.listChannels()) {
        if (channel.getTargetPath() !== "rotation") continue;
        const out = channel.getSampler().getOutput();
        if (done.has(out) || out.getComponentType() !== 5126) continue;
        done.add(out);
        const src = out.getArray();
        const dst = new Int16Array(src.length);
        for (let i = 0; i < src.length; i++) dst[i] = Math.round(Math.max(-1, Math.min(1, src[i])) * 32767);
        out.setArray(dst).setNormalized(true);
      }
    }
  };
}

// The resize for one texture: [w, h] scaled so the longest side is maxSize.
const resize = maxSize > 0 ? [maxSize, maxSize] : undefined;
await doc.transform(
  ...(clips ? [resample({ tolerance: 1e-4 }), int16Rotations()] : []),
  // Normal maps keep a higher quality: lossy blocks show as bumps.
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: normalQuality, resize, slots: /^normalTexture$/ }),
  textureCompress({ encoder: sharp, targetFormat: "webp", quality, resize, slots: /^(?!normalTexture$).*/ }),
  prune({ keepAttributes: true, keepLeaves: true }),
);

doc
  .createExtension(KHRDracoMeshCompression)
  .setRequired(true)
  .setEncoderOptions({
    method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
    quantizationBits: { POSITION: 14, NORMAL: 10, TEX_COORD: 12, COLOR: 8, GENERIC: 12 },
  });

const after = {
  clips: root.listAnimations().map((a) => a.getName()).join(),
  nodes: root.listNodes().map((n) => n.getName()).join(),
  materials: root.listMaterials().map((m) => m.getName()).join(),
};
for (const k of Object.keys(before)) if (before[k] !== after[k]) throw new Error(`${input}: the ${k} changed`);
await io.write(output, doc);
console.log(`${output}: webp ${quality}/${normalQuality}${maxSize ? `, max ${maxSize} px` : ""}${clips ? ", clips" : ""}`);
