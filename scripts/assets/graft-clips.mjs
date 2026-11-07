// Puts new clips into a shipped skater GLB. The mesh, the textures, the rig,
// and the other clips do not change.
//
// The clip GLB comes from scripts/blender/skater_anim_v3.py. Its joints must
// have the same names and the same rest pose as the skater GLB; the script
// stops when a rest value differs by more than 1e-3. A clip with the same
// name replaces the old clip. The new clips get the #187 encoding:
// resampled (tolerance 1e-4) and int16 rotation keys.
//
// The tools are not in package.json. Install them once, without saving:
//   npm i --no-save @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 \
//     @gltf-transform/functions@4.5.1 draco3dgltf@1.5.9 sharp@0.35.5
//   node scripts/assets/graft-clips.mjs <skater.glb> <clips.glb> <out.glb>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { resample } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";

const [target, source, output] = process.argv.slice(2);
if (!target || !source || !output) {
  console.error("usage: graft-clips.mjs <skater.glb> <clips.glb> <out.glb>");
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});

const doc = await io.read(target);
const clips = await io.read(source);
await clips.transform(resample({ tolerance: 1e-4 }));

const nodes = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
for (const n of clips.getRoot().listNodes()) {
  const t = nodes.get(n.getName());
  if (!t) continue;
  if (!near(n.getTranslation(), t.getTranslation()) || !near(n.getRotation(), t.getRotation()) || !near(n.getScale(), t.getScale())) {
    throw new Error(`The rest pose of ${n.getName()} differs. Build the clips on the shipped body.`);
  }
}

const buffer = doc.getRoot().listBuffers()[0];
const report = { replaced: [], added: [] };
for (const anim of clips.getRoot().listAnimations()) {
  const name = anim.getName();
  const old = doc.getRoot().listAnimations().find((a) => a.getName() === name);
  if (old) {
    for (const s of old.listSamplers()) {
      for (const acc of [s.getInput(), s.getOutput()]) if (acc && acc.listParents().length <= 2) acc.dispose();
      s.dispose();
    }
    for (const c of old.listChannels()) c.dispose();
    old.dispose();
    report.replaced.push(name);
  } else report.added.push(name);
  const copy = doc.createAnimation(name);
  const accessor = (src) => doc.createAccessor().setType(src.getType()).setArray(src.getArray().slice()).setBuffer(buffer);
  for (const ch of anim.listChannels()) {
    const node = nodes.get(ch.getTargetNode().getName());
    if (!node) throw new Error(`No node ${ch.getTargetNode().getName()} in ${target}`);
    const s = ch.getSampler();
    const path = ch.getTargetPath();
    const out = accessor(s.getOutput());
    if (path === "rotation") {
      // Float quaternion keys to normalized int16 (x 32767), as #187.
      const src = out.getArray();
      const dst = new Int16Array(src.length);
      for (let i = 0; i < src.length; i++) dst[i] = Math.round(Math.max(-1, Math.min(1, src[i])) * 32767);
      out.setArray(dst).setNormalized(true);
    }
    const sampler = doc.createAnimationSampler().setInput(accessor(s.getInput())).setOutput(out).setInterpolation(s.getInterpolation());
    copy.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
  }
}

await io.write(output, doc);
report.clips = doc.getRoot().listAnimations().map((a) => a.getName()).sort();
console.log(JSON.stringify(report));
