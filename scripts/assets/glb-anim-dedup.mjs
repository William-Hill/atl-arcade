// Merges the animation accessors of GLB files that hold the same bytes, in
// place (#413). Only the JSON chunk changes. See glb-anim-dedup.js.
//   node scripts/assets/glb-anim-dedup.mjs <file.glb> [more.glb ...]
import { readFileSync, writeFileSync } from "node:fs";
import { dedupGlbAnimations } from "./glb-anim-dedup.js";

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: glb-anim-dedup.mjs <file.glb> [more.glb ...]");
  process.exit(1);
}
for (const file of files) {
  const input = readFileSync(file);
  const { bytes, before, after } = dedupGlbAnimations(new Uint8Array(input));
  writeFileSync(file, bytes);
  const kB = (n) => (n / 1024).toFixed(0);
  console.log(`${file}: ${before} -> ${after} accessors, ${kB(input.byteLength)} -> ${kB(bytes.byteLength)} kB`);
}
