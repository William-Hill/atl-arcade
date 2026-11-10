// An estimate of the GPU memory of the textures a scene uses (#246), for the
// perf budget: three.js counts textures (renderer.info.memory.textures) but
// not their bytes. The estimate is width x height x layers x bytes per
// pixel, plus a third for a mip chain. It does not know the driver's real
// layout, so use it to compare two looks, not as a phone number.

// Pure: the bytes of one texture, from its facts:
// { width, height, depth (array layers or cube faces), channels, bytesPerChannel, mips }.
export function textureBytes({ width = 0, height = 0, depth = 1, channels = 4, bytesPerChannel = 1, mips = false } = {}) {
  const base = Math.max(0, width) * Math.max(0, height) * Math.max(1, depth) * channels * bytesPerChannel;
  return Math.round(mips ? (base * 4) / 3 : base);
}

// three.js constants (src/constants.js), by value, so this file needs no import.
const BYTES_BY_TYPE = { 1009: 1, 1010: 1, 1011: 2, 1012: 2, 1013: 4, 1014: 4, 1015: 4, 1016: 2 };
const CHANNELS_BY_FORMAT = { 1021: 1, 1023: 4, 1024: 1, 1025: 2, 1026: 1, 1027: 2, 1028: 1, 1029: 1, 1030: 2, 1031: 2, 1033: 4 };
const NO_MIPS = new Set([1003, 1006]); // NearestFilter, LinearFilter

// Pure: the facts of a three.js texture for textureBytes(). A WebGL RGB
// image upload is stored as RGBA, so 3 channels count as 4.
export function textureFacts(t) {
  const img = t?.image ?? t?.source?.data ?? null;
  const first = Array.isArray(img) ? img[0] : img;
  const width = first?.width ?? first?.videoWidth ?? 0;
  const height = first?.height ?? first?.videoHeight ?? 0;
  const depth = t?.isCubeTexture ? 6 : (first?.depth ?? 1);
  return {
    width,
    height,
    depth,
    channels: CHANNELS_BY_FORMAT[t?.format] ?? 4,
    bytesPerChannel: BYTES_BY_TYPE[t?.type] ?? 1,
    mips: Boolean(t?.generateMipmaps || (t?.mipmaps?.length ?? 0) > 1) && !NO_MIPS.has(t?.minFilter),
  };
}

// The textures of a scene: every texture in a material property or a
// uniform of a drawn object, the scene environment and background, each
// counted once. Returns { count, bytes, MB, top } (top: the 8 largest).
export function sceneTextureMemory(scene, extra = []) {
  const seen = new Map();
  const add = (t, where) => {
    if (!t?.isTexture || seen.has(t.uuid)) return;
    const f = textureFacts(t);
    seen.set(t.uuid, { name: t.name || where, width: f.width, height: f.height, depth: f.depth, bytes: textureBytes(f) });
  };
  add(scene.environment, "environment");
  add(scene.background, "background");
  for (const t of extra) add(t, "extra");
  scene.traverse((o) => {
    for (const m of [o.material, o.customDepthMaterial].flat()) {
      if (!m) continue;
      for (const [key, v] of Object.entries(m)) if (v?.isTexture) add(v, `${o.name || o.type}.${key}`);
      for (const [key, u] of Object.entries(m.uniforms ?? {})) if (u?.value?.isTexture) add(u.value, `${o.name || o.type}.${key}`);
    }
  });
  const list = [...seen.values()].sort((a, b) => b.bytes - a.bytes);
  const bytes = list.reduce((s, t) => s + t.bytes, 0);
  return { count: list.length, bytes, MB: Math.round((bytes / 1048576) * 10) / 10, top: list.slice(0, 8) };
}
