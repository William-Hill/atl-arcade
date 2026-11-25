// The fastest bone turns of one skater clip, in rad per game frame (#369).
// The game plays a beat clip at grooveRate() (0.8 / 0.6 at 100 BPM), so one
// 60 fps game frame is 1.333 / 60 s of clip time. A rate of 1 is for a clip
// that plays at its own speed (push). The e2e pop check
// (src/viewer/anim-lab.js popCheck) measures the same turns in the game.
//
// The tools are not in package.json. Install them once, without saving:
//   npm i --no-save @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 draco3dgltf@1.5.9
//   node scripts/assets/clip-speed.mjs <skater.glb> <clip> [rate]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
const [file, clip, rate = "1.3333333"] = process.argv.slice(2);
const doc = await io.read(file);
const a = doc.getRoot().listAnimations().find((x) => x.getName() === clip);
const dt = Number(rate) / 60; // clip time per game frame
const ang = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.reduce((s, x, j) => s + x * b[j], 0))));
const rows = [];
for (const ch of a.listChannels()) {
  if (ch.getTargetPath() !== "rotation") continue;
  const s = ch.getSampler(); const t = s.getInput().getArray(); const o = s.getOutput();
  const v = []; for (let i = 0; i < t.length; i++) v.push(o.getElement(i, []));
  const f = (time) => { let i = 0; while (i < t.length - 1 && t[i + 1] < time) i++; if (i >= t.length - 1) return v.at(-1);
    const k = Math.max(0, Math.min(1, (time - t[i]) / (t[i + 1] - t[i]))); const p = v[i], q = v[i + 1];
    const d = p.reduce((s, x, j) => s + x * q[j], 0) < 0 ? -1 : 1; const r = p.map((x, j) => x * (1 - k) + d * q[j] * k); const n = Math.hypot(...r); return r.map((x) => x / n); };
  const dur = t.at(-1); let max = 0, at = 0;
  for (let x = 0; x <= dur; x += 0.002) { const y = (x + dt) % dur; const d = ang(f(x), f(y)); if (d > max) { max = d; at = x; } }
  rows.push([ch.getTargetNode().getName().replace(/^mixamorig:?/, ""), max, at]);
}
rows.sort((p, q) => q[1] - p[1]);
console.log(clip, rows.slice(0, 5).map(([n, m, at]) => `${n} ${m.toFixed(4)} @${at.toFixed(2)}s`).join(" | "));
