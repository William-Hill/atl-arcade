// Copies the clips of a clip GLB into shipped skater GLBs (#290).
//
// scripts/blender/skater_reclip.py keys the clips on a shipped skater.glb and
// exports a clip GLB. This script removes the clips from each target GLB and
// adds the clips of the clip GLB. A channel finds its target node by name. The
// script copies all other data byte for byte, so the Draco meshes, the skin,
// and the textures do not change.
//
// Run:
//   node scripts/skater-clips-splice.mjs --clips /tmp/nia-clips.glb \
//     --into assets/skaters/nia/skater.glb --into assets/skaters/nia/skater-1024.glb
//   node scripts/skater-clips-splice.mjs --clips /tmp/nia-clips.glb \
//     --compare assets/skaters/nia/skater.glb
// --compare writes nothing. It prints the largest difference per clip.
import fs from "node:fs";

const COMP_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMP_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export function readGlb(path) {
  const b = fs.readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString("utf8"));
  let bin = Buffer.alloc(0);
  const at = 20 + jsonLen;
  if (at < b.length) {
    const binLen = b.readUInt32LE(at);
    bin = b.subarray(at + 8, at + 8 + binLen);
  }
  return { json, bin };
}

export function writeGlb(path, { json, bin }) {
  let text = Buffer.from(JSON.stringify(json), "utf8");
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const pad = Buffer.alloc((4 - (bin.length % 4)) % 4, 0);
  const binChunk = Buffer.concat([bin, pad]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + 8 + binChunk.length, 8);
  const h1 = Buffer.alloc(8);
  h1.writeUInt32LE(text.length, 0);
  h1.writeUInt32LE(0x4e4f534a, 4);
  const h2 = Buffer.alloc(8);
  h2.writeUInt32LE(binChunk.length, 0);
  h2.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(path, Buffer.concat([header, h1, text, h2, binChunk]));
}

function accessorBytes({ json, bin }, index) {
  const acc = json.accessors[index];
  const bv = json.bufferViews[acc.bufferView];
  const elem = COMP_SIZE[acc.componentType] * COMP_COUNT[acc.type];
  if (bv.byteStride && bv.byteStride !== elem) throw new Error(`accessor ${index}: interleaved data`);
  const start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  return bin.subarray(start, start + elem * acc.count);
}

function accessorFloats(glb, index) {
  const bytes = accessorBytes(glb, index);
  const acc = glb.json.accessors[index];
  if (acc.componentType !== 5126) throw new Error(`accessor ${index}: not float`);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}

function animationAccessors(json) {
  const out = new Set();
  for (const a of json.animations || []) for (const s of a.samplers) out.add(s.input).add(s.output);
  return out;
}

// Every accessor index that a part other than the clips uses.
function otherAccessors(json) {
  const out = new Set();
  for (const m of json.meshes || []) {
    for (const p of m.primitives) {
      for (const i of Object.values(p.attributes || {})) out.add(i);
      if (p.indices !== undefined) out.add(p.indices);
      for (const t of p.targets || []) for (const i of Object.values(t)) out.add(i);
    }
  }
  for (const s of json.skins || []) if (s.inverseBindMatrices !== undefined) out.add(s.inverseBindMatrices);
  return out;
}

// The bufferViews that images and extensions (Draco) use directly.
function directViews(json) {
  const out = new Set();
  for (const img of json.images || []) if (img.bufferView !== undefined) out.add(img.bufferView);
  for (const m of json.meshes || []) {
    for (const p of m.primitives) {
      const d = p.extensions?.KHR_draco_mesh_compression;
      if (d) out.add(d.bufferView);
    }
  }
  return out;
}

export function splice(target, source) {
  const tj = target.json;
  const sj = source.json;
  const anim = animationAccessors(tj);
  const other = otherAccessors(tj);
  for (const i of anim) if (other.has(i)) throw new Error(`accessor ${i} is used by a clip and by another part`);
  const direct = directViews(tj);

  const parts = [];
  let length = 0;
  const add = (bytes) => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      parts.push(Buffer.alloc(pad));
      length += pad;
    }
    const offset = length;
    parts.push(Buffer.from(bytes));
    length += bytes.length;
    return offset;
  };

  // The bufferViews that only other parts use are copied whole. A bufferView
  // that also holds clip data is split: each kept accessor gets its own view.
  const viewUsers = new Map();
  tj.accessors.forEach((acc, i) => {
    if (acc.bufferView === undefined) return;
    if (!viewUsers.has(acc.bufferView)) viewUsers.set(acc.bufferView, []);
    viewUsers.get(acc.bufferView).push(i);
  });
  const views = [];
  const viewMap = new Map();
  const accessorView = new Map();
  tj.bufferViews.forEach((bv, i) => {
    const users = viewUsers.get(i) || [];
    const hasAnim = users.some((u) => anim.has(u));
    const hasOther = direct.has(i) || users.some((u) => !anim.has(u));
    if (!hasOther) return;
    if (!hasAnim) {
      const start = bv.byteOffset || 0;
      const { buffer, byteOffset, ...rest } = bv;
      viewMap.set(i, views.length);
      views.push({ ...rest, buffer: 0, byteOffset: add(target.bin.subarray(start, start + bv.byteLength)) });
      return;
    }
    if (direct.has(i)) throw new Error(`bufferView ${i} holds clip data and image or Draco data`);
    for (const u of users) {
      if (anim.has(u)) continue;
      const bytes = accessorBytes(target, u);
      accessorView.set(u, views.length);
      const view = { buffer: 0, byteOffset: add(bytes), byteLength: bytes.length };
      if (bv.target !== undefined) view.target = bv.target;
      views.push(view);
    }
  });

  const accessors = [];
  const accMap = new Map();
  tj.accessors.forEach((acc, i) => {
    if (anim.has(i)) return;
    const out = { ...acc };
    if (acc.bufferView !== undefined) {
      if (accessorView.has(i)) {
        out.bufferView = accessorView.get(i);
        delete out.byteOffset;
      } else {
        out.bufferView = viewMap.get(acc.bufferView);
      }
    }
    accMap.set(i, accessors.length);
    accessors.push(out);
  });

  const remap = (obj) => {
    for (const k of Object.keys(obj)) obj[k] = accMap.get(obj[k]);
  };
  for (const m of tj.meshes || []) {
    for (const p of m.primitives) {
      remap(p.attributes || {});
      if (p.indices !== undefined) p.indices = accMap.get(p.indices);
      for (const t of p.targets || []) remap(t);
      const d = p.extensions?.KHR_draco_mesh_compression;
      if (d) d.bufferView = viewMap.get(d.bufferView);
    }
  }
  for (const s of tj.skins || []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = accMap.get(s.inverseBindMatrices);
  for (const img of tj.images || []) if (img.bufferView !== undefined) img.bufferView = viewMap.get(img.bufferView);

  // The clips of the source. A channel finds its node by name.
  const byName = new Map(tj.nodes.map((n, i) => [n.name, i]));
  const srcAcc = new Map();
  const copyAccessor = (si) => {
    if (srcAcc.has(si)) return srcAcc.get(si);
    const acc = sj.accessors[si];
    const bytes = accessorBytes(source, si);
    const view = views.length;
    views.push({ buffer: 0, byteOffset: add(bytes), byteLength: bytes.length });
    const { bufferView, byteOffset, ...rest } = acc;
    srcAcc.set(si, accessors.length);
    accessors.push({ ...rest, bufferView: view });
    return srcAcc.get(si);
  };
  const animations = (sj.animations || []).map((a) => ({
    name: a.name,
    samplers: a.samplers.map((s) => ({ ...s, input: copyAccessor(s.input), output: copyAccessor(s.output) })),
    channels: a.channels.map((c) => {
      const name = sj.nodes[c.target.node].name;
      if (!byName.has(name)) throw new Error(`clip ${a.name}: no node "${name}" in the target`);
      return { sampler: c.sampler, target: { node: byName.get(name), path: c.target.path } };
    }),
  }));

  tj.accessors = accessors;
  tj.bufferViews = views;
  tj.animations = animations;
  tj.buffers = [{ byteLength: length }];
  return { json: tj, bin: Buffer.concat(parts) };
}

// The largest rest-pose difference between the nodes of the two files that
// the clips animate. The clips are local transforms, so the rest must match.
export function restDifference(target, source) {
  const byName = new Map(target.json.nodes.map((n) => [n.name, n]));
  const animated = new Set();
  for (const a of source.json.animations || []) for (const c of a.channels) animated.add(c.target.node);
  let worst = 0;
  for (const i of animated) {
    const s = source.json.nodes[i];
    const t = byName.get(s.name);
    if (!t) continue;
    const pairs = [
      [s.translation || [0, 0, 0], t.translation || [0, 0, 0]],
      [s.rotation || [0, 0, 0, 1], t.rotation || [0, 0, 0, 1]],
      [s.scale || [1, 1, 1], t.scale || [1, 1, 1]],
    ];
    for (const [a, b] of pairs) for (let k = 0; k < a.length; k += 1) worst = Math.max(worst, Math.abs(a[k] - b[k]));
  }
  return worst;
}

// Samples a channel at a time (linear; rotations are compared as raw values).
function sample(glb, sampler, t) {
  const times = accessorFloats(glb, sampler.input);
  const values = accessorFloats(glb, sampler.output);
  const n = values.length / times.length;
  let k = 0;
  while (k < times.length - 1 && times[k + 1] < t) k += 1;
  const k2 = Math.min(k + 1, times.length - 1);
  const span = times[k2] - times[k];
  const w = span > 0 ? Math.min(Math.max((t - times[k]) / span, 0), 1) : 0;
  const out = [];
  for (let c = 0; c < n; c += 1) out.push(values[k * n + c] * (1 - w) + values[k2 * n + c] * w);
  return out;
}

export function compare(target, source) {
  const out = [];
  const tAnims = new Map(target.json.animations.map((a) => [a.name, a]));
  for (const a of source.json.animations) {
    const b = tAnims.get(a.name);
    if (!b) {
      out.push({ clip: a.name, diff: Infinity, note: "missing in target" });
      continue;
    }
    const key = (glb, c) => `${glb.json.nodes[c.target.node].name}/${c.target.path}`;
    const bCh = new Map(b.channels.map((c) => [key(target, c), b.samplers[c.sampler]]));
    const aKeys = new Set(a.channels.map((c) => key(source, c)));
    // A channel in only one file counts as missing (the other file has the rest pose there).
    const extra = [...bCh.keys()].filter((k) => !aKeys.has(k)).length;
    let worst = 0;
    let missing = 0;
    for (const c of a.channels) {
      const sb = bCh.get(key(source, c));
      if (!sb) {
        missing += 1;
        continue;
      }
      const sa = a.samplers[c.sampler];
      // Sample at the key times of both files, so a key in only one file counts.
      const times = new Set([...accessorFloats(source, sa.input), ...accessorFloats(target, sb.input)]);
      for (const t of times) {
        const va = sample(source, sa, t);
        const vb = sample(target, sb, t);
        // q and -q are the same rotation.
        const sign = c.target.path === "rotation" && va.reduce((s, v, i) => s + v * vb[i], 0) < 0 ? -1 : 1;
        for (let i = 0; i < va.length; i += 1) worst = Math.max(worst, Math.abs(va[i] - sign * vb[i]));
      }
    }
    out.push({ clip: a.name, diff: worst, channels: a.channels.length, missing, extra });
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const get = (flag) => argv.flatMap((v, i) => (v === flag ? [argv[i + 1]] : []));
  const [clipsPath] = get("--clips");
  if (!clipsPath) throw new Error("--clips is required");
  const source = readGlb(clipsPath);
  for (const path of get("--compare")) {
    const target = readGlb(path);
    console.log(`${path}: rest difference ${restDifference(target, source).toExponential(2)}`);
    for (const r of compare(target, source)) {
      console.log(`  ${r.clip.padEnd(18)} max diff ${r.diff.toFixed(4)}  channels ${r.channels}  missing ${r.missing}  only in target ${r.extra ?? 0}${r.note ? " " + r.note : ""}`);
    }
  }
  for (const path of get("--into")) {
    const target = readGlb(path);
    const rest = restDifference(target, source);
    if (rest > 1e-3) throw new Error(`${path}: the rest pose differs by ${rest} from the clip GLB`);
    const before = fs.statSync(path).size;
    writeGlb(path, splice(target, source));
    console.log(`${path}: ${before} -> ${fs.statSync(path).size} bytes, ${source.json.animations.length} clips, rest difference ${rest.toExponential(2)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
