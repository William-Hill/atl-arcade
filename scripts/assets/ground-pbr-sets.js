// The full PBR ground sets (#158, assets/textures/ground-pbr/<set>/), as
// pure data for the preview page and its tests: which set goes on which
// surface kind, the file of each map and tier, and the GPU memory of a map.
// No Three.js here.

export const SET_IDS = ["sidewalk", "brick", "asphalt", "trail"];
export const MAPS = ["albedo", "normal", "orm"];
export const TIERS = { high: 1024, phone: 512 };
export const FORMATS = ["jpg", "ktx2"];

// The default surface kind -> set mapping: the surfaces the skater rides on.
// Brick has no surface kind in the levels yet (a district style can map
// sidewalk or path to it: ?sets=sidewalk:brick).
export const DEFAULT_SETS = { street: "asphalt", sidewalk: "sidewalk", path: "sidewalk", trail: "trail" };

// Pure: "street:asphalt,trail:trail" -> { street: "asphalt", trail: "trail" }.
// Unknown kinds or sets throw, so a typo in a shot URL fails loudly.
export function parseSets(value, kinds) {
  if (value == null || value === "") return { ...DEFAULT_SETS };
  const out = {};
  for (const pair of value.split(",")) {
    const [kind, set] = pair.split(":");
    if (!kinds.includes(kind)) throw new Error(`ground-pbr: unknown surface kind "${kind}"`);
    if (!SET_IDS.includes(set)) throw new Error(`ground-pbr: unknown set "${set}"`);
    out[kind] = set;
  }
  return out;
}

// Pure: the repo-relative file of one map.
export function mapFile(set, map, tier, format) {
  if (!SET_IDS.includes(set) || !MAPS.includes(map) || !(tier in TIERS) || !FORMATS.includes(format)) {
    throw new Error(`ground-pbr: no file for ${set}/${map}/${tier}/${format}`);
  }
  return `assets/textures/ground-pbr/${set}/${map}_${tier}.${format}`;
}

// Pure: GPU bytes of a square map with a full mip chain. A JPG decodes to
// RGBA8 (4 bytes a pixel). A UASTC KTX2 transcodes to BC7 (desktop) or
// ASTC 4x4 (phone), 1 byte a pixel; with no compressed format it falls back
// to RGBA8 too.
export function gpuBytes(size, bytesPerPixel) {
  let total = 0;
  for (let s = size; s >= 1; s = Math.floor(s / 2)) total += s * s * bytesPerPixel;
  return total;
}
