// Merges the animation accessors of a GLB that hold the same bytes (#413).
//
// The skater GLBs have about 2000 animation channels, and each channel has
// its own time (input) accessor and value (output) accessor. Most clips share
// a few key times, so most input accessors hold the same bytes. Each accessor
// adds about 110 bytes of JSON to the GLB, and the JSON is not compressed on
// the wire. This pass points every sampler at the first accessor with the
// same bytes and removes the accessors that no part of the file uses.
//
// The pass changes only the JSON chunk. The binary chunk does not change, so
// the mesh (Draco), the textures, and the key values stay the same bytes. The
// bytes of a removed accessor stay in the binary chunk, unused.
//
// Pure: no file system. scripts/assets/glb-anim-dedup.mjs is the command.

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

// Extensions that can point at an accessor from a place this pass does not
// renumber. A GLB that uses one of them is refused.
const UNSAFE_EXTENSIONS = ["EXT_mesh_gpu_instancing", "KHR_animation_pointer", "KHR_gaussian_splatting"];

export function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a GLB");
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(data));
    else if (type === CHUNK_BIN) bin = data;
    offset += 8 + length;
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

function pad4(bytes, fill) {
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4).fill(fill);
  padded.set(bytes);
  return padded;
}

export function writeGlb({ json, bin }) {
  const jsonBytes = pad4(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binBytes = bin ? pad4(bin, 0) : null;
  const total = 12 + 8 + jsonBytes.byteLength + (binBytes ? 8 + binBytes.byteLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  if (binBytes) {
    const at = 20 + jsonBytes.byteLength;
    view.setUint32(at, binBytes.byteLength, true);
    view.setUint32(at + 4, CHUNK_BIN, true);
    out.set(binBytes, at + 8);
  }
  return out;
}

// The bytes of an accessor, packed (a byteStride is followed).
function accessorBytes(json, bin, index) {
  const a = json.accessors[index];
  if (a.sparse || a.bufferView == null) return null;
  const bv = json.bufferViews[a.bufferView];
  if ((bv.buffer ?? 0) !== 0) return null;
  const element = COMPONENTS[a.type] * COMPONENT_BYTES[a.componentType];
  const stride = bv.byteStride ?? element;
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Uint8Array(a.count * element);
  for (let i = 0; i < a.count; i += 1) out.set(bin.subarray(start + i * stride, start + i * stride + element), i * element);
  return out;
}

function accessorKey(json, bin, index) {
  const bytes = accessorBytes(json, bin, index);
  if (!bytes) return null;
  const a = json.accessors[index];
  return `${a.type}|${a.componentType}|${a.normalized ? 1 : 0}|${a.count}|${Buffer.from(bytes).toString("base64")}`;
}

// Calls visit(holder, key) for every place in the JSON that holds an
// accessor index.
function eachAccessorRef(json, visit) {
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      for (const name of Object.keys(prim.attributes ?? {})) visit(prim.attributes, name);
      if (prim.indices != null) visit(prim, "indices");
      for (const target of prim.targets ?? []) for (const name of Object.keys(target)) visit(target, name);
    }
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices != null) visit(skin, "inverseBindMatrices");
  for (const anim of json.animations ?? []) {
    for (const s of anim.samplers ?? []) {
      visit(s, "input");
      visit(s, "output");
    }
  }
}

// Returns { json, before, after }: a new JSON object (the input is not
// changed) and the accessor counts before and after.
export function dedupAnimationAccessors(json, bin) {
  const unsafe = (json.extensionsUsed ?? []).filter((e) => UNSAFE_EXTENSIONS.includes(e));
  if (unsafe.length) throw new Error(`glb-anim-dedup does not handle ${unsafe.join(", ")}`);
  const out = structuredClone(json);
  const before = out.accessors?.length ?? 0;
  if (!out.animations?.length) return { json: out, before, after: before };

  // 1. Point each sampler at the first accessor with the same bytes.
  const firstOf = new Map();
  const keyOf = new Map();
  const canonical = (index) => {
    if (!keyOf.has(index)) keyOf.set(index, accessorKey(out, bin, index));
    const key = keyOf.get(index);
    if (key == null) return index;
    if (!firstOf.has(key)) firstOf.set(key, index);
    return firstOf.get(key);
  };
  for (const anim of out.animations) {
    for (const s of anim.samplers) {
      s.input = canonical(s.input);
      s.output = canonical(s.output);
    }
  }

  // 2. Keep the accessors that something uses, in their order, and renumber.
  const used = new Set();
  eachAccessorRef(out, (holder, key) => used.add(holder[key]));
  const newIndex = new Map();
  const kept = [];
  out.accessors.forEach((a, i) => {
    if (!used.has(i)) return;
    newIndex.set(i, kept.length);
    kept.push(a);
  });
  out.accessors = kept;
  eachAccessorRef(out, (holder, key) => {
    holder[key] = newIndex.get(holder[key]);
  });
  return { json: out, before, after: kept.length };
}

// The whole pass on GLB bytes. Returns { bytes, before, after }.
export function dedupGlbAnimations(bytes) {
  const { json, bin } = parseGlb(bytes);
  const result = dedupAnimationAccessors(json, bin);
  return { bytes: writeGlb({ json: result.json, bin }), before: result.before, after: result.after };
}
