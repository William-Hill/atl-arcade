import * as THREE from "three";

// A stylized day sky: a gradient dome with a sun disc and, on the high
// tier, cel-shaded clouds (two hard color steps, as in the toon ramp).
// The dome follows the camera, so it never comes nearer. The fog color is
// the horizon color, so far buildings fade into the sky.
//
// The pbr look (#201) adds to this sky: a deeper zenith, a warm pale band
// at the horizon, a wide sun glow, and a few soft fair-weather clouds on a
// clear day. These parts fade out when the sun goes down, so dusk and night
// keep the weather colors. The toon look does not get them.

export const SKY = {
  zenith: new THREE.Color(0x2f8fe8),
  horizon: new THREE.Color(0xbfe4ff),
};

// The pbr sky values (linear). The shader and pbrSkyColor() use them.
//   deep: the zenith color multiplier in full day
//   curve: the gradient power (larger: the sky stays pale higher up)
//   bandColor: the warm pale color of the horizon band (luma 1)
//   bandLift: the band luma as a multiple of the horizon luma
//   bandWidth: the band falls to 1/e at this view height (sin of elevation)
//   bandAmount: the band part at the horizon
//   glowWide, glowNear: the sun glow (power, strength) pairs
//   fairChance: the part of the grid cells with a fair-weather cloud
//   fairScale: the grid scale on the cloud plane (larger: smaller clouds)
//   fairSize: the cloud radius range, as a part of the cell
//   cloudLit, cloudBase: the sunlit top and the shaded base of a cloud
export const PBR_SKY = {
  deep: 0.72,
  curve: 0.8,
  bandColor: [1.08, 0.99, 0.86],
  bandLift: 1.22,
  bandWidth: 0.09,
  bandAmount: 0.85,
  glowWide: [6, 0.22],
  glowNear: [48, 0.45],
  fairChance: 0.4,
  fairScale: 1.6,
  fairSize: [0.18, 0.34],
  cloudLit: 1.6,
  cloudBase: [0.66, 0.72, 0.82],
};

const LUMA = [0.2126, 0.7152, 0.0722];
const luma = (c) => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Pure: the daylight factor of the pbr sky parts from the sun height (the
// y of the unit sun direction). 0 at and under the horizon, 1 by about 15°.
export function pbrSkyDay(sunY) {
  return smooth(-0.02, 0.26, sunY);
}

// Pure: the pbr sky color (linear, before the sun and the clouds) for a
// view height y (the y of the unit view direction), as in the shader.
export function pbrSkyColor(y, zenith, horizon, sunY, p = PBR_SKY) {
  const day = pbrSkyDay(sunY);
  const h = Math.max(y, 0);
  const zen = zenith.map((v) => v * (1 + (p.deep - 1) * day));
  const t = Math.pow(h, 0.55 + (p.curve - 0.55) * day);
  let col = horizon.map((v, i) => v + (zen[i] - v) * t);
  const band = Math.exp(-h / p.bandWidth) * p.bandAmount * day;
  const warm = p.bandColor.map((v) => (v * p.bandLift * luma(horizon)) / luma(p.bandColor));
  col = col.map((v, i) => v + (warm[i] - v) * band);
  return col;
}

// Pure: the part of the grid cells with a fair-weather cloud, as in the
// shader. A clear day keeps a few small clouds; they fade out as the
// weather cover grows (the weather clouds take over), and at night.
export function pbrFairChance(cover, sunY, p = PBR_SKY) {
  return p.fairChance * pbrSkyDay(sunY) * (1 - smooth(0.2, 0.6, cover));
}

const g3 = (c) => `vec3(${c.map((v) => v.toFixed(4)).join(", ")})`;
const g1 = (v) => v.toFixed(4);

export function createSky({ radius, sunDirection, clouds = false, pbr = false }) {
  const P = PBR_SKY;
  const defines = {};
  if (clouds) defines.CLOUDS = 1;
  if (pbr) defines.PBR_SKY = 1;
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    defines,
    uniforms: {
      uZenith: { value: SKY.zenith.clone() },
      uHorizon: { value: SKY.horizon.clone() },
      uSun: { value: sunDirection.clone().normalize() },
      uTime: { value: 0 },
      // The weather (src/render/weather-view.js): the cloud coverage and
      // the storm darkening of the cloud color.
      uCover: { value: 0.42 },
      uCloudDark: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // On the far plane.
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSun;
      uniform float uTime;
      uniform float uCover;
      uniform float uCloudDark;
      varying vec3 vDir;
      #ifdef CLOUDS
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      #ifdef PBR_SKY
      // The fair-weather clouds: a grid on the cloud plane with at most one
      // cloud in each cell, at a random place and size. A cell has a cloud
      // with the probability "chance". Unlike the fbm threshold, this
      // spreads the clouds evenly over the sky, as fair-weather cumulus.
      // Returns > 0 inside a cloud (1 at the center).
      float fairPuffs(vec2 p, float chance) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float m = -1.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 cell = i + g;
            if (hash(cell) > chance) continue;
            vec2 o = vec2(hash(cell + 17.1), hash(cell + 31.7)) * 0.6 + 0.2;
            float r = ${g1(P.fairSize[0])} + ${g1(P.fairSize[1] - P.fairSize[0])} * hash(cell + 5.3);
            m = max(m, 1.0 - length(g + o - f) / r);
          }
        }
        return m;
      }
      #endif
      #endif
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        #ifdef PBR_SKY
        // pbrSkyColor(): a deeper zenith and a warm pale band at the
        // horizon, by daylight. Under the horizon the band color continues.
        float day = smoothstep(-0.02, 0.26, uSun.y);
        vec3 zen = uZenith * mix(1.0, ${g1(P.deep)}, day);
        vec3 col = mix(uHorizon, zen, pow(h, mix(0.55, ${g1(P.curve)}, day)));
        float hl = dot(uHorizon, vec3(0.2126, 0.7152, 0.0722));
        vec3 warm = ${g3(P.bandColor)} * (${g1(P.bandLift / luma(P.bandColor))} * hl);
        col = mix(col, warm, exp(-h / ${g1(P.bandWidth)}) * ${g1(P.bandAmount)} * day);
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.93, 0.75) * (pow(s, 900.0) * 1.6 + pow(s, 12.0) * 0.18);
        // The wide sun glow (day only).
        col += vec3(1.0, 0.95, 0.82) * day * (pow(s, ${g1(P.glowWide[0])}) * ${g1(P.glowWide[1])} + pow(s, ${g1(P.glowNear[0])}) * ${g1(P.glowNear[1])});
        #else
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
        // Below the horizon: the horizon color (the fog hides the ground edge).
        if (d.y < 0.0) col = uHorizon;
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.93, 0.75) * (pow(s, 900.0) * 1.6 + pow(s, 12.0) * 0.18);
        #endif
        #ifdef CLOUDS
        if (d.y > 0.02) {
          // Project the view ray on a cloud plane, so the clouds get smaller
          // toward the horizon.
          vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(uTime * 0.004, 0.0);
          float c = fbm(uv);
          float edge = smoothstep(0.02, 0.25, d.y);
          // The coverage moves the threshold: a clear day keeps a few small
          // clouds, an overcast day fills the dome. A storm darkens them.
          #ifdef PBR_SKY
          // By day the weather clouds are soft (no color steps). The fair-weather
          // clouds (fairPuffs()) add to them on a clear day, and fade out as
          // the weather cover grows (pbrFairChance()).
          // At night (day 0) the weather clouds are the same as in the toon
          // sky, so the night env light does not change.
          float thr = mix(0.75, 0.32, uCover);
          float body = smoothstep(thr, thr + mix(0.08, 0.12, day), c) * edge;
          float shade = smoothstep(thr + mix(0.12, 0.02, day), thr + mix(0.4, 0.22, day), c);
          float chance = ${g1(P.fairChance)} * day * (1.0 - smoothstep(0.2, 0.6, uCover));
          vec2 fuv = d.xz / (d.y + 0.12) * ${g1(P.fairScale)} + vec2(uTime * 0.004, 0.0);
          // A noise warp gives each cloud a lumpy outline.
          vec2 q = fuv + (vec2(fbm(fuv * 1.7), fbm(fuv * 1.7 + 9.2)) - 0.5) * 0.6;
          float n = (fbm(q * 3.3) - 0.5) * 0.5;
          float puff = fairPuffs(q, chance) + n;
          // The side toward the zenith (the sunlit top) is white, the side
          // toward the horizon (the base) is gray-blue: compare with a point
          // a little nearer to the zenith on the cloud plane.
          vec2 toZenith = -fuv / max(length(fuv), 1e-3) * 0.14;
          float puffUp = fairPuffs(q + toZenith, chance) + n;
          // Far clouds fade into the horizon haze.
          float fair = smoothstep(0.0, 0.12, puff) * smoothstep(0.05, 0.22, d.y);
          float fairShade = smoothstep(-0.12, 0.08, puff - puffUp) * 0.75 + 0.25 * smoothstep(0.0, 0.4, puff);
          shade = mix(shade, fairShade, fair * (1.0 - body));
          body = max(body, fair);
          vec3 lit = mix(vec3(1.0), vec3(${g1(P.cloudLit)}), day);
          vec3 base = mix(vec3(0.80, 0.86, 0.95), ${g3(P.cloudBase)}, day);
          vec3 cloud = mix(base, lit, shade) * mix(1.0, 0.5, uCloudDark);
          col = mix(col, cloud, body * 0.95);
          #else
          float thr = mix(0.75, 0.32, uCover);
          float body = smoothstep(thr, thr + 0.08, c) * edge;
          float shade = smoothstep(thr + 0.12, thr + 0.4, c);
          vec3 cloud = mix(vec3(0.80, 0.86, 0.95), vec3(1.0), shade) * mix(1.0, 0.5, uCloudDark);
          col = mix(col, cloud, body * 0.95);
          #endif
        }
        #endif
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
  mesh.name = "sky";
  mesh.frustumCulled = false;
  // Draw after the opaque scene: the dome is on the far plane, so the depth
  // test drops every pixel that a building or the ground covers, and the
  // sky shader runs only on the sky pixels.
  mesh.renderOrder = 1000;
  return {
    mesh,
    fogColor: SKY.horizon.clone(),
    update(camera, time) {
      mesh.position.copy(camera.position);
      material.uniforms.uTime.value = time;
    },
  };
}
