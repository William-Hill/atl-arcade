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
//   node scripts/assets/graft-clips.mjs <skater.glb> <clips.glb> <out.glb> [--prune-rest]
//
// --prune-rest (#329): drops each channel that stays at the rest value of its
// joint for the whole clip (within PRUNE_EPS). Three.js holds a joint with
// no track at its rest pose, so the pose does not change. The physics pass
// exports a translation, a rotation, and a scale channel for all 65 joints,
// and each channel adds JSON to the GLB.
//
// The output then goes through glb-anim-dedup.js (#413): the samplers with
// the same key times or the same values share one accessor. Only the JSON
// chunk changes.
import { readFileSync, writeFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { resample } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { dedupGlbAnimations } from "./glb-anim-dedup.js";

const args = process.argv.slice(2);
const pruneRest = args.includes("--prune-rest");
const [target, source, output] = args.filter((a) => !a.startsWith("--"));
const PRUNE_EPS = 1e-4;
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
if (pruneRest) report.prunedChannels = 0;

// True when every key of the channel is the rest value of its joint. A
// quaternion q and -q are the same rotation.
// The rest is the one of the shipped (target) node: a pruned joint holds it.
function atRest(ch) {
  const n = nodes.get(ch.getTargetNode().getName()) ?? ch.getTargetNode();
  const path = ch.getTargetPath();
  const rest = path === "translation" ? n.getTranslation() : path === "rotation" ? n.getRotation() : path === "scale" ? n.getScale() : null;
  if (!rest) return false;
  const out = ch.getSampler().getOutput().getArray();
  const k = rest.length;
  for (let i = 0; i < out.length; i += k) {
    let same = true;
    let flip = path === "rotation";
    for (let j = 0; j < k; j++) {
      if (Math.abs(out[i + j] - rest[j]) > PRUNE_EPS) same = false;
      if (Math.abs(out[i + j] + rest[j]) > PRUNE_EPS) flip = false;
    }
    if (!same && !flip) return false;
  }
  return true;
}
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
    if (pruneRest && atRest(ch)) {
      report.prunedChannels += 1;
      continue;
    }
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
const deduped = dedupGlbAnimations(new Uint8Array(readFileSync(output)));
writeFileSync(output, deduped.bytes);
report.accessors = { before: deduped.before, after: deduped.after };
report.clips = doc.getRoot().listAnimations().map((a) => a.getName()).sort();
console.log(JSON.stringify(report));
