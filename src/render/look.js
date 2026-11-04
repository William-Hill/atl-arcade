import * as THREE from "three";

// The city look: "toon" (the cel look, MeshToonMaterial) or "pbr" (stylized
// physically based materials, lit by an environment map made from the sky).
//
// The pbr look keeps the art colors, the facade shader, and the ground scans.
// It changes how light falls on them: the sky gives the ambient light and
// the reflections, glass is smooth and walls are rough. Neutral tone mapping
// keeps the art colors (AgX made them gray in the spike, see
// docs/decisions.md).
//
// ?look=toon|pbr sets it. With no parameter the high tier gets pbr and the
// other tiers get toon, because the phone and the software GPU cannot pay for
// the extra light cost.

// Lighting for each look. Intensities are for the renderer's physical units.
export const LOOKS = {
  toon: {
    toneMapping: "Neutral",
    exposure: 1.05,
    hemisphere: 0.7,
    hemisphereSky: 0xcfe8ff,
    hemisphereGround: 0x5a6a48,
    sun: 1.5,
    // The sun direction (from the target to the light, m) and its color.
    sunOffset: [30, 50, 20],
    sunColor: 0xfff1d6,
    environment: 0,
    // The darkening of the ink outline (src/render/post.js).
    ink: 0.85,
    grade: false,
  },
  pbr: {
    toneMapping: "Neutral",
    exposure: 1.0,
    hemisphere: 0.15,
    // A near-white sky color, so the hemisphere light does not add blue to
    // the shade (direction change 6).
    hemisphereSky: 0xe6eef6,
    hemisphereGround: 0x5a6a48,
    // A lower, warmer sun than the toon look (27 degrees over the horizon,
    // not 54): long shadows, light that grazes the walls, so the relief and
    // the normal maps show, and less light on flat ground, so the grass does
    // not go white. The azimuth is the same as the toon sun.
    sun: 3.8,
    sunOffset: [50, 30, 33],
    sunColor: 0xffd7a3,
    environment: 0.6,
    // A thin contact line, not a cel outline: the relief of the normal maps
    // and the AO carry the shapes.
    ink: 0.3,
    grade: true,
  },
};

// The surface detail of the pbr look: the strength of the normal map of
// each CC0 scan (1 is the scan as it is). The toon look gets no normal maps,
// because its 3-step ramp turns the small slopes into noise.
export const DETAIL_NORMAL = {
  brick: 1.4,
  stone: 0.9,
  // In the order of the ground sets in src/render/geo-view.js (GROUND).
  ground: [1.0, 0.8, 0.9, 1.2],
};
// The albedo of each ground set in the pbr look, as a factor on the art
// color, in the order of GROUND. The sun of the pbr look (3.2) falls full on
// flat ground, and the art colors are for the toon ramp, so a light grass
// went near white. Real grass reflects about 10 to 20 % of the light.
//
// Each factor is RGB. The asphalt is darker and less blue than its art
// color, and the slab sidewalk is near its art color, so a road and a
// sidewalk differ at once in value (about 3 to 1 in linear light).
export const GROUND_ALBEDO = [
  [0.62, 0.62, 0.54],
  [1.0, 1.0, 0.98],
  [0.85, 0.85, 0.85],
  [0.55, 0.55, 0.55],
];
// The roughness of a painted steel window frame (semi-gloss).
export const FRAME_ROUGHNESS = 0.45;

// GLSL: tilt the view-space normal n by a normal map sample s (0 to 1, the
// OpenGL convention). tu is the view-space direction in which the map u
// grows, and tv the direction in which v grows. k scales the slope.
export const DETAIL_GLSL = /* glsl */ `
vec3 detailNormal(vec3 n, vec3 tu, vec3 tv, vec3 s, float k) {
  vec3 m = s * 2.0 - 1.0;
  m.xy *= k;
  vec3 t = normalize(tu - n * dot(tu, n));
  vec3 b = normalize(tv - n * dot(tv, n) - t * dot(tv, t));
  return normalize(t * m.x + b * m.y + n * max(m.z, 0.05));
}`;

// Pure: the same tilt as DETAIL_GLSL, for the tests. Vectors are [x, y, z].
export function detailNormal(n, tu, tv, s, k) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b, f) => a.map((v, i) => v - b[i] * f);
  const norm = (a) => {
    const l = Math.hypot(...a);
    return a.map((v) => v / l);
  };
  const m = s.map((v) => v * 2 - 1);
  m[0] *= k;
  m[1] *= k;
  const t = norm(sub(tu, n, dot(tu, n)));
  const b = norm(sub(sub(tv, n, dot(tv, n)), t, dot(tv, t)));
  const mz = Math.max(m[2], 0.05);
  return norm([0, 1, 2].map((i) => t[i] * m[0] + b[i] * m[1] + n[i] * mz));
}

// The color grade of the pbr look, on the linear color before the tone
// mapping (src/render/post.js). Contrast turns around a mid gray of 0.18,
// saturation keeps the luma, and the shadows get a little cool and the
// lights a little warm, as in a sunny photo.
export const GRADE = {
  contrast: 1.1,
  saturation: 1.12,
  shadowTint: [0.96, 0.99, 1.05],
  lightTint: [1.04, 1.0, 0.95],
  // The luma range over which the tint goes from shadow to light.
  split: [0.04, 0.5],
};

// Pure: the grade of one linear color [r, g, b].
export function gradeColor(c, g = GRADE) {
  const l0 = luma(c);
  // Contrast on the luma only, so the hue stays.
  const l1 = l0 > 0 ? 0.18 * Math.pow(l0 / 0.18, g.contrast) : 0;
  const k = l0 > 0 ? l1 / l0 : 0;
  let o = c.map((v) => v * k);
  const l = luma(o);
  o = o.map((v) => Math.max(0, l + (v - l) * g.saturation));
  const t = Math.min(1, Math.max(0, (l - g.split[0]) / (g.split[1] - g.split[0])));
  const w = t * t * (3 - 2 * t);
  return o.map((v, i) => v * (g.shadowTint[i] + (g.lightTint[i] - g.shadowTint[i]) * w));
}

// Roughness for each material in the pbr look. Glass is a mask in the facade
// shader: a window pixel gets `glass`, the wall around it gets `wall`.
export const ROUGHNESS = {
  wall: 0.88,
  glass: 0.08,
  ground: 0.95,
  props: 0.8,
  mural: 0.85,
};

// The environment light on each material, as a fraction of the scene value.
// At a low angle the ground reflects the bright sky (Fresnel), which gives a
// white haze on grass and asphalt, so the ground gets less. The wall gets
// 0.8: the warm ground bounce in ENV_SKY makes the shade brighter, and 0.8
// keeps the shade value of a wall where it was.
export const ENV_LIGHT = {
  wall: 0.8,
  ground: 0.4,
  props: 0.6,
  mural: 0.7,
};

// Pure: the sun elevation of a look, in degrees over the horizon.
export function sunElevation(look) {
  const [x, y, z] = LOOKS[look].sunOffset;
  return (Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI;
}

// Pure: the look for a URL value and a quality tier.
export function lookFor(param, quality) {
  if (param === "toon" || param === "pbr") return param;
  return quality === "high" ? "pbr" : "toon";
}

// Pure: the ground-contact darkening of a wall, from its height in floors
// above the base. A wall is darkest where it meets the ground, as in the
// ambient occlusion of a real street. The facade shader uses the same formula.
export const WALL_AO = { base: 0.62, floors: 0.9 };
export function wallOcclusion(floor, { base, floors } = WALL_AO) {
  const t = Math.min(Math.max(floor / floors, 0), 1);
  const s = t * t * (3 - 2 * t); // smoothstep
  return base + (1 - base) * s;
}

// Pure: the brick tone of one wall face: a value shift and a small
// red-yellow shift, from a hash h in 0..1. The mean over h is 1, so the
// palette stays. The facade shader uses the same formula on a brick style.
export const BRICK_TONE = { value: 0.06, warm: 0.03 };
export function brickTone(h, { value, warm } = BRICK_TONE) {
  const k = 2 * h - 1;
  return [1 + k * value + k * warm, 1 + k * value, 1 + k * value - k * warm];
}

// A lit material for the look. `params` are the shared material parameters
// (vertexColors, map, ...). The toon look adds the gradient map; the pbr look
// adds the roughness and no metalness.
export function litMaterial(look, params, { gradientMap = null, roughness = ROUGHNESS.wall, envLight = 1 } = {}) {
  if (look === "pbr") return new THREE.MeshStandardMaterial({ ...params, roughness, metalness: 0, envMapIntensity: envLight });
  return new THREE.MeshToonMaterial({ ...params, gradientMap });
}

// The sky for the environment map. In shade the environment map is the only
// strong light. The sky colors are a saturated blue in linear values (the
// zenith is 0.03, 0.27, 0.81), so a cream trim in shade turned blue-gray.
// A real shade also gets the bounce light of the sunlit ground and walls,
// which is warm. So the map uses a sky with less color (`saturation` keeps
// that part of the chroma) and a ground disc at the value of a sunlit
// pavement (linear 0.39, 0.31, 0.22). The sky dome that the player sees does
// not change. See docs/decisions.md.
export const ENV_SKY = { saturation: 0.45, ground: 0xa89880 };

const LUMA = [0.2126, 0.7152, 0.0722];
function luma(c) {
  return LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];
}

// Pure: a linear color with a part `s` of its chroma. The luma stays.
export function desaturate(c, s) {
  const l = luma(c);
  return c.map((v) => l + (v - l) * s);
}

// Pure: the mean light (linear RGB) on a vertical wall from the environment
// map, before the intensity. It integrates the sky gradient of sky.js (the
// horizon color below the horizon, as the shader does) and the ground disc,
// with the cosine weight of a diffuse surface. The PMREM blur at roughness 1
// gives about the same value.
export function wallSkyLight({ zenith, horizon, ground, saturation = ENV_SKY.saturation, steps = 64 }) {
  const z = desaturate(zenith, saturation);
  const h = desaturate(horizon, saturation);
  const sum = [0, 0, 0];
  let weight = 0;
  // The half sphere in front of a wall with the normal +x: y is up.
  for (let i = 0; i < steps; i++) {
    const y = -1 + (2 * (i + 0.5)) / steps;
    const r = Math.sqrt(1 - y * y);
    for (let j = 0; j < steps * 2; j++) {
      const phi = (Math.PI * (j + 0.5)) / (steps * 2) - Math.PI / 2;
      const w = r * Math.cos(phi); // the cosine to the normal
      // The disc is 4 % of the radius under the eye, so it starts a little
      // under the horizon.
      let c;
      if (y < -0.04) c = ground;
      else {
        const t = Math.pow(Math.max(y, 0), 0.55);
        c = [0, 1, 2].map((k) => h[k] + (z[k] - h[k]) * t);
      }
      for (let k = 0; k < 3; k++) sum[k] += c[k] * w;
      weight += w;
    }
  }
  return sum.map((v) => v / weight);
}

// An environment map from the sky dome, for the image-based light of the
// pbr look. The sky shader draws the horizon color below the horizon; a
// ground disc in the ground color covers that half, so a surface that faces
// down gets a warm bounce light and not a sky-blue light. The map uses a
// copy of the sky material with the ENV_SKY colors.
export function createSkyEnvironment(renderer, sky, { ground = ENV_SKY.ground, saturation = ENV_SKY.saturation, radius = 400 } = {}) {
  const scene = new THREE.Scene();
  const material = sky.mesh.material.clone();
  for (const name of ["uZenith", "uHorizon"]) {
    const c = material.uniforms[name].value;
    const [r, g, b] = desaturate([c.r, c.g, c.b], saturation);
    c.setRGB(r, g, b);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
  dome.frustumCulled = false;
  scene.add(dome);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.98, 32), new THREE.MeshBasicMaterial({ color: ground }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -radius * 0.04;
  scene.add(disc);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02, 0.1, radius * 1.2);
  pmrem.dispose();
  dome.geometry.dispose();
  material.dispose();
  disc.geometry.dispose();
  disc.material.dispose();
  return target.texture;
}

// The renderer tone mapping constant for a look.
export function toneMappingOf(look) {
  return THREE[`${LOOKS[look].toneMapping}ToneMapping`];
}
