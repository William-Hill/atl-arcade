// Asset table for the graphics and characters audit (#65).
// Usage: node asset-table.mjs  (run from the repo root)
// Reads every GLB, landmark JSON, and texture set. Prints JSON.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function imgDims(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { type: "png", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: "jpeg", h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  if (buf.slice(0, 4).toString() === "RIFF") return { type: "webp", w: null, h: null };
  if (buf.slice(1, 7).toString() === "KTX 20") return { type: "ktx2", w: buf.readUInt32LE(20), h: buf.readUInt32LE(24) };
  return { type: "unknown" };
}

function glb(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
  const binStart = 20 + jsonLen + 8;
  let tris = 0;
  const meshes = [];
  for (const m of json.meshes ?? []) {
    let mt = 0;
    for (const p of m.primitives) {
      const mode = p.mode ?? 4;
      if (mode !== 4) continue;
      const n = p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count;
      mt += n / 3;
    }
    tris += mt;
    meshes.push({ name: m.name, tris: mt });
  }
  const images = (json.images ?? []).map((im) => {
    const bv = json.bufferViews[im.bufferView];
    const b = buf.slice(binStart + (bv.byteOffset ?? 0), binStart + (bv.byteOffset ?? 0) + bv.byteLength);
    return { name: im.name, mime: im.mimeType, bytes: bv.byteLength, ...imgDims(b) };
  });
  const skins = (json.skins ?? []).map((s) => s.joints.length);
  const skinned = (json.nodes ?? []).filter((n) => n.skin !== undefined).length;
  const anims = (json.animations ?? []).map((a) => ({ name: a.name, channels: a.channels.length, dur: Math.max(...a.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0)) }));
  const mats = (json.materials ?? []).map((m) => ({ name: m.name, keys: Object.keys(m).filter((k) => k !== "name"), pbr: Object.keys(m.pbrMetallicRoughness ?? {}), ext: Object.keys(m.extensions ?? {}) }));
  return { bytes: buf.length, jsonBytes: jsonLen, extensionsUsed: json.extensionsUsed ?? [], tris, meshes, images, skins, skinnedNodes: skinned, anims, mats };
}

function landmarkJson(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  let tris = 0, geoms = 0;
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === "object") {
      if (o.data && o.data.attributes && o.data.attributes.position) {
        geoms++;
        const n = o.data.index ? o.data.index.array.length : o.data.attributes.position.array.length / 3;
        tris += n / 3;
        return;
      }
      for (const v of Object.values(o)) walk(v);
    }
  };
  walk(j);
  return { bytes: fs.statSync(file).size, geometries: geoms, tris: Math.round(tris), topKeys: Object.keys(j) };
}

function texDir(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(png|jpe?g|webp|ktx2)$/i.test(f)) continue;
    const p = path.join(dir, f);
    const b = fs.readFileSync(p);
    out.push({ file: f, bytes: b.length, ...imgDims(b) });
  }
  return out;
}

const result = {
  glb: {},
  landmarks: {},
  textures: {},
};
for (const f of ["assets/skaters/nia/skater.glb", "assets/skaters/marcus/skater.glb", "assets/kit/street-kit.glb"]) result.glb[f] = glb(path.join(root, f));
for (const f of ["assets/landmarks/ponce-city-market-tower.json", "assets/landmarks/krog-street-market-front.json"]) result.landmarks[f] = landmarkJson(path.join(root, f));
for (const d of ["assets/ground/asphalt", "assets/ground/concrete", "assets/ground/grass", "assets/ground/trail", "assets/landmarks/textures/brick", "assets/landmarks/textures/metal", "assets/landmarks/textures/trim", "assets/skaters/nia/face"]) result.textures[d] = texDir(path.join(root, d));
console.log(JSON.stringify(result, null, 1));
