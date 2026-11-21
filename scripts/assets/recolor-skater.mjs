// Changes one outfit color in the base color textures of a skater GLB (#203).
//
// The first use: Nia's forest-green joggers become navy, because the green
// pants merge with the BeltLine lawn (docs/art-direction-pbr.md, section 6).
//
// - A texel changes only when its hue, saturation and value are in the
//   pants range (see RECIPES). The weight goes down smoothly at the range
//   edges, so the seams and the stitches keep a soft edge.
// - The new color keeps the luminance pattern of the old texel (folds,
//   seams, stitches): out = target * (Y / Y of the old mean), in linear RGB.
// - An image changes only when the outfit color covers `--min-share` (5 %)
//   or more of its texels. Other images (hair, face, wristband) can have
//   a few dark green texels; they stay byte for byte.
// - Only the base color images change. The script writes the new WebP
//   bytes into the GLB binary chunk and moves the buffer views. The Draco
//   mesh, the rig, the clips and the other textures stay byte for byte.
//
// sharp is not in package.json. Install it once, without saving:
//   npm i --no-save sharp@0.35.5
//   node scripts/assets/recolor-skater.mjs <in.glb> <out.glb> [--recipe nia-navy] [--quality 80] [--min-share 0.05]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Colors are sRGB 0..255. Hue in degrees, saturation 0..1, value 0..255.
// Each range is [zero, full, full, zero]: the weight is 1 between the two
// middle numbers and goes to 0 at the outer numbers.
export const RECIPES = {
  "nia-navy": {
    // The mean color of the joggers in the shipped texture (#2F6B4F in the
    // character sheet; the PBR texture reads darker).
    from: [51, 74, 44],
    // Navy. HSV 225 deg, 0.57, 0.42. Luma 61 (Rec. 709), above the albedo
    // floor (#303030) of the art direction.
    to: [46, 61, 107],
    // Joggers: hue 95..118, value 60..90. The green wristband is hue
    // 135..145 and value 100..136, so it stays green. The hair has a green
    // cast below value 31, so it stays too.
    hue: [70, 80, 125, 132],
    sat: [0.12, 0.22, 1.01, 1.02],
    val: [24, 36, 95, 108],
  },
};

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function ramp(x, [a, b, c, d]) {
  if (x <= a || x >= d) return 0;
  if (x < b) return (x - a) / (b - a);
  if (x > c) return (d - x) / (d - c);
  return 1;
}

// Pure: the HSV of an sRGB texel (0..255). Hue in degrees.
export function hsv(r, g, b) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max > 0 ? d / max : 0, max];
}

// Pure: the new sRGB texel (0..255) and the weight for one texel.
export function recolorTexel(recipe, r, g, b) {
  const [h, s, v] = hsv(r, g, b);
  const w = ramp(h, recipe.hue) * ramp(s, recipe.sat) * ramp(v, recipe.val);
  if (w === 0) return { rgb: [r, g, b], w };
  const lin = [r, g, b].map((c) => srgbToLin(c / 255));
  const k = luma(lin) / luma(recipe.from.map((c) => srgbToLin(c / 255)));
  const out = recipe.to.map((c, i) => {
    const t = Math.min(1, srgbToLin(c / 255) * k);
    return Math.round(255 * linToSrgb(lin[i] + (t - lin[i]) * w));
  });
  return { rgb: out, w };
}

async function recolorImage(bytes, recipe, quality, minShare) {
  // Imported here, so the tests of the pure functions do not need sharp.
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let changed = 0;
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && Math.max(data[i], data[i + 1], data[i + 2]) > 4) opaque++;
    const { rgb, w } = recolorTexel(recipe, data[i], data[i + 1], data[i + 2]);
    if (w === 0) continue;
    changed++;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
  }
  if (!changed || changed < minShare * opaque) return { bytes, changed: 0, skipped: changed };
  const hasAlpha = (await sharp(bytes).metadata()).hasAlpha;
  let img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  if (!hasAlpha) img = img.removeAlpha();
  return { bytes: await img.webp({ quality }).toBuffer(), changed };
}

// Reads a GLB into { json, bin }.
function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("Not a GLB file");
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binStart = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binStart);
  return { json, bin: buf.subarray(binStart + 8, binStart + 8 + binLen) };
}

// Writes a GLB. `views` holds the bytes of each buffer view.
function writeGlb(json, views) {
  const pad4 = (n) => (n + 3) & ~3;
  const parts = [];
  let off = 0;
  json.bufferViews.forEach((bv, i) => {
    bv.byteOffset = off;
    bv.byteLength = views[i].length;
    parts.push(views[i]);
    const p = pad4(views[i].length) - views[i].length;
    if (p) parts.push(Buffer.alloc(p));
    off += views[i].length + p;
  });
  json.buffers[0].byteLength = off;
  let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20)]);
  const bin = Buffer.concat(parts);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return [h, data];
  };
  return Buffer.concat([head, ...chunk(0x4e4f534a, jsonBuf), ...chunk(0x004e4942, bin)]);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : def;
  };
  const recipeName = opt("--recipe", "nia-navy");
  const quality = Number(opt("--quality", "80"));
  const minShare = Number(opt("--min-share", "0.05"));
  const [input, output] = args;
  const recipe = RECIPES[recipeName];
  if (!input || !output || !recipe) {
    console.error("usage: recolor-skater.mjs <in.glb> <out.glb> [--recipe nia-navy] [--quality 80] [--min-share 0.05]");
    process.exit(1);
  }
  const { json, bin } = readGlb(readFileSync(input));
  if (json.buffers.length !== 1) throw new Error("Only one buffer is supported");
  const views = json.bufferViews.map((bv) => bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
  // Only the base color images of the materials.
  const baseImages = new Set();
  for (const m of json.materials ?? []) {
    const t = m.pbrMetallicRoughness?.baseColorTexture;
    if (!t) continue;
    const tex = json.textures[t.index];
    const src = tex.extensions?.EXT_texture_webp?.source ?? tex.source;
    if (src !== undefined) baseImages.add(src);
  }
  for (const i of [...baseImages].sort((a, b) => a - b)) {
    const img = json.images[i];
    if (img.mimeType !== "image/webp" || img.bufferView === undefined) throw new Error(`Image ${i} is not an embedded WebP`);
    const before = views[img.bufferView];
    const { bytes, changed, skipped } = await recolorImage(before, recipe, quality, minShare);
    views[img.bufferView] = bytes;
    if (changed) console.log(`${img.name}: ${changed} texels, ${before.length} to ${bytes.length} bytes`);
    else if (skipped) console.log(`${img.name}: kept (${skipped} texels, under the min share)`);
  }
  const out = writeGlb(json, views);
  writeFileSync(output, out);
  console.log(`${output}: ${out.length} bytes (was ${readFileSync(input).length})`);
}

// Run main() only from the command line. pathToFileURL encodes spaces and
// other special characters in the path, as the other scripts do.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
