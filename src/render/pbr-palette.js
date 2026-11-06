// The Atlanta palette and the light grade of the pbr look (#157, #160).
//
// Pure tables and functions only (no Three.js), so Vitest can test them.
// src/render/pbr-look.js applies them to the scene each frame, and the
// facade shader (src/render/geo-view.js) uses the GLSL copies below.
// docs/style-sheet-pbr.md shows the same values.

// The albedo limits (docs/art-direction-pbr.md, "Color and palette"), in
// linear light. A wall, ground or prop albedo goes no higher than the
// ceiling; trim on thin pieces can go to the trim ceiling.
export const ALBEDO = { ceiling: 0.6, trim: 0.7, floor: 0.03 };

// Pure: sRGB 0..1 to linear, and back.
export function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
export function linearToSrgb(v) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

// Pure: a hex color (0xrrggbb or "#rrggbb") to linear [r, g, b].
export function hexToLinear(hex) {
  const n = typeof hex === "string" ? parseInt(hex.replace("#", ""), 16) : hex;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => srgbToLinear(c / 255));
}

// Pure: linear [r, g, b] to "#rrggbb".
export function linearToHex(c) {
  return "#" + c.map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255).toString(16).padStart(2, "0")).join("");
}

// Pure: pull a linear color under the ceiling. The whole color scales by
// one factor, so the hue and the chroma ratio stay. A color under the
// ceiling does not change.
export function albedoCeiling(c, ceiling = ALBEDO.ceiling) {
  const m = Math.max(c[0], c[1], c[2]);
  return m > ceiling ? c.map((v) => (v * ceiling) / m) : [...c];
}

// GLSL copy of albedoCeiling() for the facade shader.
export const ALBEDO_GLSL = /* glsl */ `
vec3 albedoCeiling(vec3 c, float ceiling) {
  float m = max(max(c.r, c.g), c.b);
  return m > ceiling ? c * (ceiling / m) : c;
}`;

// The roughness and metalness ranges per material class (the table in
// docs/art-direction-pbr.md). `roughness` is [min, max]; `metalness` too.
export const MATERIAL_CLASSES = {
  brick: { roughness: [0.8, 0.92], metalness: [0, 0] },
  stucco: { roughness: [0.75, 0.9], metalness: [0, 0] },
  glass: { roughness: [0.03, 0.28], metalness: [0, 0] },
  asphalt: { roughness: [0.85, 0.95], metalness: [0, 0] },
  concrete: { roughness: [0.75, 0.95], metalness: [0, 0] },
  grass: { roughness: [0.92, 1.0], metalness: [0, 0] },
  mural: { roughness: [0.7, 0.85], metalness: [0, 0] },
  paint: { roughness: [0.6, 0.9], metalness: [0, 0] },
  metal: { roughness: [0.25, 0.6], metalness: [0.6, 1.0] },
  carPaint: { roughness: [0.2, 0.4], metalness: [0, 0] },
  skin: { roughness: [0.45, 0.6], metalness: [0, 0] },
  cloth: { roughness: [0.7, 0.95], metalness: [0, 0] },
};

// Pure: the roughness and metalness of a material, kept in its class range.
export function clampToClass(cls, roughness, metalness = 0) {
  const c = MATERIAL_CLASSES[cls];
  if (!c) throw new Error(`unknown material class: ${cls}`);
  const k = (v, [a, b]) => Math.min(b, Math.max(a, v));
  return { roughness: k(roughness, c.roughness), metalness: k(metalness, c.metalness) };
}

// The lowest roughness of a character material that is not metal: no
// plastic skin or cloth (skin 0.45 to 0.6, satin 0.45, boots 0.4).
export const CHARACTER_MIN_ROUGHNESS = 0.42;

// Pure: the roughness of a character material (skater, NPC skater). Metal
// parts (plates, trucks) keep their value; the rest gets the floor.
export function characterRoughness(roughness, metalness = 0) {
  if (metalness >= 0.5) return roughness;
  return Math.max(roughness, CHARACTER_MIN_ROUGHNESS);
}

// The bold far-window colors (#160). A far building does not draw the
// interior rooms: each window gets one flat color from this list, picked by
// a hash, and the glass roughness still reflects the sky. Deep blues and
// teals in the day, with one warm pane in five (a lit room or a blind).
// Values are linear albedo.
export const WINDOW_COLORS = [
  { hex: "#1c3352", weight: 0.3 },
  { hex: "#1f4f55", weight: 0.22 },
  { hex: "#2a2f4f", weight: 0.18 },
  { hex: "#3f5f80", weight: 0.12 },
  { hex: "#8a6a3e", weight: 0.18 },
];

// Pure: the far-window color for a hash h in 0..1 (linear [r, g, b]).
export function windowColor(h) {
  let acc = 0;
  for (const w of WINDOW_COLORS) {
    acc += w.weight;
    if (h < acc) return hexToLinear(w.hex);
  }
  return hexToLinear(WINDOW_COLORS[WINDOW_COLORS.length - 1].hex);
}

// Pure: the weighted mean of WINDOW_COLORS (linear), the far facade color
// that the bold windows fade into.
export function windowMean() {
  const sum = [0, 0, 0];
  let wt = 0;
  for (const w of WINDOW_COLORS) {
    const c = hexToLinear(w.hex);
    for (let i = 0; i < 3; i++) sum[i] += c[i] * w.weight;
    wt += w.weight;
  }
  return sum.map((v) => v / wt);
}

const f3 = (v) => v.toFixed(4);
// GLSL copy of windowColor().
export function windowColorGlsl() {
  let acc = 0;
  const lines = WINDOW_COLORS.slice(0, -1).map((w) => {
    acc += w.weight;
    const c = hexToLinear(w.hex).map(f3).join(", ");
    return `  if (h < ${f3(acc)}) return vec3(${c});`;
  });
  const last = hexToLinear(WINDOW_COLORS[WINDOW_COLORS.length - 1].hex).map(f3).join(", ");
  return `vec3 boldWindow(float h) {\n${lines.join("\n")}\n  return vec3(${last});\n}`;
}

// The screen-size fades of the facade (#160), as the window cell size in
// pixels. `bold`: under these many pixels a window is a flat bold color (no
// room). `fine`: under these many pixels the fine detail (scan relief, sill
// and slab shadow bands, pane wobble) fades out. Each pair is [full, gone].
export const FACADE_FADE = { bold: [34, 16], fine: [48, 20] };

// Pure: the fade weight (0 full detail, 1 gone) for a window cell of `px`
// screen pixels and a fade pair [full, gone]. Smoothstep, as in the shader.
export function screenFade(px, [full, gone]) {
  const t = Math.min(1, Math.max(0, (full - px) / (full - gone)));
  return t * t * (3 - 2 * t);
}

// The district looks (#160): the palette, the accent, a light color grade
// and the height-fog tint of each neighborhood. The ids are the district ids
// of src/level/geo/styles.js; "trail" is the BeltLine corridor and the parks,
// and the default away from every anchor. The grade `tint` multiplies the
// linear color after the tone grade; keep it within 5 % of 1, so the art
// colors stay. The palette values are under the albedo ceiling.
export const DISTRICT_LOOKS = {
  "poncey-highland": {
    name: "Poncey-Highland",
    palette: ["#8c4538", "#9e4d3d", "#c4b08c", "#c9962e", "#4f9aa6", "#c96f6a", "#8fae86", "#cb8f5e"],
    accent: ["#c9962e", "#2f5d46"],
    grade: { tint: [1.03, 1.0, 0.96], saturation: 1.06 },
    fog: "#e2cdb4",
  },
  "old-fourth-ward": {
    name: "Old Fourth Ward",
    palette: ["#a8a39b", "#525c6b", "#cb7a48", "#6f9bbf", "#383d47", "#b9b2a6"],
    accent: ["#cb6a32", "#6f9bbf"],
    grade: { tint: [1.0, 1.0, 1.03], saturation: 1.04 },
    fog: "#c8d6e4",
  },
  "inman-park": {
    name: "Inman Park",
    palette: ["#8fa88f", "#cbb478", "#a890b8", "#8ab3c7", "#c6c0b0", "#c98fa6", "#b08a68"],
    accent: ["#a890b8", "#8fa88f"],
    grade: { tint: [1.0, 1.02, 0.98], saturation: 1.08 },
    fog: "#d3dcc2",
  },
  trail: {
    name: "BeltLine trail and parks",
    palette: ["#b8a27a", "#4f7a3a", "#6f9a4a", "#7a2e2e", "#2e3f66", "#c9962e"],
    accent: ["#7a2e2e", "#2e3f66", "#c9962e"],
    grade: { tint: [1.02, 1.0, 0.97], saturation: 1.06 },
    fog: "#d6e0e8",
  },
};

// The landmark brick (darker and richer than the lofts around it).
export const LANDMARK_PALETTE = ["#7e3a2e", "#8f4434", "#994a3b"];

// The width of the blend between two districts, in meters past the anchor
// radius. A skater who crosses a border sees the grade change over about
// 120 m, not in a cut.
export const DISTRICT_BLEND = 120;

// Pure: the weight of each district look at (x, z). `anchors` are
// { id, x, z, radius } (styles.js districtAnchors()). The weights sum to 1;
// "trail" gets what no anchor covers.
export function districtWeights(x, z, anchors = []) {
  const w = {};
  let sum = 0;
  for (const a of anchors) {
    if (!DISTRICT_LOOKS[a.id]) continue;
    const d = Math.hypot(x - a.x, z - a.z);
    const t = Math.min(1, Math.max(0, (a.radius + DISTRICT_BLEND - d) / DISTRICT_BLEND));
    const k = t * t * (3 - 2 * t);
    if (k > 0) {
      w[a.id] = (w[a.id] ?? 0) + k;
      sum += k;
    }
  }
  // Overlapping anchors share; full cover leaves no trail weight.
  if (sum > 1) {
    for (const id of Object.keys(w)) w[id] /= sum;
    sum = 1;
  }
  w.trail = (w.trail ?? 0) + (1 - sum);
  return w;
}

// Pure: the blended district grade and fog tint (linear) for the weights.
export function districtLook(weights) {
  const tint = [0, 0, 0];
  const fog = [0, 0, 0];
  let saturation = 0;
  for (const [id, k] of Object.entries(weights)) {
    const d = DISTRICT_LOOKS[id];
    if (!d || k <= 0) continue;
    const f = hexToLinear(d.fog);
    for (let i = 0; i < 3; i++) {
      tint[i] += d.grade.tint[i] * k;
      fog[i] += f[i] * k;
    }
    saturation += d.grade.saturation * k;
  }
  return { tint, saturation, fog };
}

// The tone grade by time of day (#160). Today's grade barely changes between
// 9:30 and 19:12 (docs/art-direction-pbr.md); these keys follow the light
// table there. `warm` is the split tone: warm lights and cool shadows (> 0).
// `lift` raises the blacks a little (dusk). `rim` is the skater rim strength.
export const TIME_GRADES = {
  day: { contrast: 1.14, saturation: 1.06, warm: 0.35, lift: 0, rim: 0.55 },
  golden: { contrast: 1.12, saturation: 1.14, warm: 1.0, lift: 0, rim: 0.8 },
  dusk: { contrast: 1.0, saturation: 1.04, warm: -0.35, lift: 0.01, rim: 0.45 },
  night: { contrast: 1.04, saturation: 1.12, warm: 0.45, lift: 0.006, rim: 0.3 },
};

const mixN = (a, b, t) => a + (b - a) * t;
function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function mixGrade(a, b, t) {
  return Object.fromEntries(Object.keys(a).map((k) => [k, mixN(a[k], b[k], t)]));
}

// Pure: the tone grade for a sun elevation (degrees). Night under -8,
// dusk around -3, golden hour from 0 to 14, day over 20. Cloud cover (0..1)
// pulls the warm split down (soft light, colors read true).
export function timeGrade(elevation, cloud = 0) {
  let g;
  if (elevation >= 20) g = { ...TIME_GRADES.day };
  else if (elevation >= 4) g = mixGrade(TIME_GRADES.golden, TIME_GRADES.day, smooth(4, 20, elevation));
  else if (elevation >= -4) g = mixGrade(TIME_GRADES.dusk, TIME_GRADES.golden, smooth(-4, 4, elevation));
  else g = mixGrade(TIME_GRADES.night, TIME_GRADES.dusk, smooth(-10, -4, elevation));
  g.warm *= 1 - 0.7 * Math.min(1, Math.max(0, cloud));
  return g;
}

// The grade of the pbr look on a linear color, as in the grade pass
// (src/render/post.js GradeShader). The contrast turns on the luma around
// `pivot`, so the hue stays; the saturation keeps the luma; the split tone
// cools the shadows and warms the lights; the district tint goes last.
export const GRADE_PIVOT = 0.18;
export const SPLIT = { shadow: [-0.03, -0.005, 0.045], light: [0.035, 0.0, -0.04], range: [0.04, 0.6] };
const LUMA = [0.2126, 0.7152, 0.0722];
const luma = (c) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];

export function gradePixel(c, { contrast = 1, saturation = 1, warm = 0, lift = 0, tint = [1, 1, 1], pivot = GRADE_PIVOT } = {}) {
  const l0 = luma(c);
  const l1 = l0 > 0 ? pivot * Math.pow(l0 / pivot, contrast) : 0;
  const k = l0 > 1e-6 ? l1 / l0 : 0;
  let o = c.map((v) => v * k);
  const l = luma(o);
  o = o.map((v) => Math.max(0, l + (v - l) * saturation));
  const w = smooth(SPLIT.range[0], SPLIT.range[1], l);
  return o.map((v, i) => (v * (1 + warm * (SPLIT.shadow[i] + (SPLIT.light[i] - SPLIT.shadow[i]) * w)) + lift) * tint[i]);
}

// The environment light by the sky (#160). The env map is baked from the
// sky dome, so at dusk and at night it takes the sky color; the night sky is
// about 13 times darker than the noon sky, which left the ground near black.
// The brightness falls only with the square root of the sky luma (a part of
// the city glow and the eye adapting), with a cap, and the ground disc (the
// bounce from the street) keeps a floor. `refLuma` is the noon sky luma
// (src/sim/weather.js day zenith and horizon, mean).
export const ENV_BY_SKY = { refLuma: 0.55, maxBoost: 3, groundFloor: 0.15 };

// Pure: the env intensity factor and the ground disc factor for a sky luma
// (the mean luma of the zenith and the horizon colors, linear).
export function envForSky(skyLuma, e = ENV_BY_SKY) {
  const k = Math.min(1, Math.max(0, skyLuma / e.refLuma));
  return { intensity: Math.min(e.maxBoost, 1 / Math.sqrt(Math.max(k, 1e-4))), ground: Math.max(e.groundFloor, k) };
}

// The bloom threshold of the pbr look by daylight (0 night, 1 noon), in
// linear luminance before the tone mapping. The brighter pbr sun puts a
// sunlit trail over the toon threshold (0.92), and a daytime surface must
// never glow (docs/art-direction-pbr.md). In the day only the sky glare and
// hot emissive signs pass; at night the lit windows and signs bloom.
export const BLOOM_THRESHOLD = { night: 0.92, day: 2.4 };

// Pure: the bloom threshold for the daylight factor.
export function bloomThreshold(day, b = BLOOM_THRESHOLD) {
  const t = Math.min(1, Math.max(0, day));
  return b.night + (b.day - b.night) * t;
}

// The height fog (#160): the distance fog of the scene, thicker near the
// ground and thinner up high, so far towers stand out of a warm haze and a
// near street stays clear. Heights are relative to the camera eye.
//   base: the haze is full under (eye height + base) m
//   falloff: the haze halves every falloff * ln 2 m above that
//   top: the share of the distance fog left high up
//   haze: the ground haze at mid range (before the distance fog)
//   hazeStart: where the ground haze starts, as a part of the fog near
//   tint: how much of the district fog color the fog takes (0..1)
export const HEIGHT_FOG = { base: -2, falloff: 28, top: 0.55, haze: 0.16, hazeStart: 0.3, tint: 0.4 };

// Pure: the fog factor (0 clear, 1 full fog) for a point at view distance
// `dist` and height `dy` over the camera, for a linear fog near..far. The
// shader chunk in pbr-look.js uses the same formula.
export function heightFogFactor(dist, dy, near, far, f = HEIGHT_FOG) {
  const fd = smooth(near, far, dist);
  const hk = Math.exp(-Math.max(dy - f.base, 0) / f.falloff);
  let k = fd * mixN(f.top, 1, hk);
  // The far end is full fog at every height, so the far cut never shows.
  k = mixN(k, 1, smooth(0.85, 1, fd));
  return Math.max(k, f.haze * hk * smooth(near * f.hazeStart, far, dist));
}

// Pure: count the materials of a scene graph by type. `root` is any object
// with `traverse(fn)` (a THREE.Object3D) whose meshes have `material`.
// Returns { counts: { MeshStandardMaterial: n, ... }, toon: [names] }.
export function materialAudit(root) {
  const counts = {};
  const toon = [];
  const seen = new Set();
  root.traverse((o) => {
    if (!o.material || !(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      counts[m.type] = (counts[m.type] ?? 0) + 1;
      if (m.isMeshToonMaterial || m.type === "MeshToonMaterial") toon.push(o.name || m.name || "(unnamed)");
    }
  });
  return { counts, toon };
}
