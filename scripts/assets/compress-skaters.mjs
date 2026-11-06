// Re-encodes a skater GLB for a smaller download (#187).
//
// - Textures: JPEG to WebP (EXT_texture_webp), the same pixel size.
// - Clips: resampled (keys on a straight line between their neighbors are
//   removed, tolerance 1e-4), and the rotation keys are stored as
//   normalized int16 quaternions (glTF 2.0 core allows this for rotation).
// - Meshes: Draco again, with the M1-01 quantization (position 14, normal
//   10, texcoord 12, generic 12). Draco decodes the positions to float
//   meters, which the face decal shader (src/render/skater-face.js) needs.
//
// The mesh, the rig, the joint names, and the clip names do not change.
//
// The tools are not in package.json. Install them once, without saving:
//   npm i --no-save @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 \
//     @gltf-transform/functions@4.5.1 draco3dgltf@1.5.9 sharp@0.35.5
//   node scripts/assets/compress-skaters.mjs <in.glb> <out.glb> [--quality 80] [--normal-quality 85]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { prune, resample, textureCompress } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import sharp from "sharp";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const files = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [input, output] = files;
if (!input || !output) {
  console.error("usage: compress-skaters.mjs <in.glb> <out.glb> [--quality 80] [--normal-quality 85]");
  process.exit(1);
}
const quality = opt("--quality", 80);
const normalQuality = opt("--normal-quality", 85);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});

const doc = await io.read(input);
const clipsBefore = doc.getRoot().listAnimations().map((a) => a.getName());

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

await doc.transform(
  resample({ tolerance: 1e-4 }),
  int16Rotations(),
  // Normal maps keep a higher quality: lossy blocks show as bumps.
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: normalQuality, slots: /^normalTexture$/ }),
  textureCompress({ encoder: sharp, targetFormat: "webp", quality, slots: /^(?!normalTexture$).*/ }),
  prune({ keepAttributes: true, keepLeaves: true }),
);

doc
  .createExtension(KHRDracoMeshCompression)
  .setRequired(true)
  .setEncoderOptions({
    method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
    quantizationBits: { POSITION: 14, NORMAL: 10, TEX_COORD: 12, COLOR: 8, GENERIC: 12 },
  });

const clipsAfter = doc.getRoot().listAnimations().map((a) => a.getName());
if (clipsAfter.join() !== clipsBefore.join()) throw new Error("The clip names changed");
await io.write(output, doc);
console.log(`${output}: ${clipsAfter.length} clips, webp quality ${quality}, normal quality ${normalQuality}`);
