import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

// Tilt-shift blur for photo mode (#90). A horizontal band of the picture
// stays sharp. Above and below the band the picture blurs, and the blur
// grows with the depth step from the focus depth (the depth at the band
// center). The city then looks like a small model.
//
// The pass reads the depth buffer that GTAO already draws for the ink
// pass, so it costs no extra scene pass. It is off in normal play: the
// blur hides the path ahead of the skater. A disabled pass costs nothing,
// because EffectComposer skips it.

// center: the band center in UV (0 bottom, 1 top). halfWidth: half of the
// sharp band height in UV. feather: the UV distance from sharp to full
// blur. strength: 0..1. maxRadius: the blur radius in px at strength 1.
// depthMix: how much of the blur comes from the depth step (0..1).
export const TILT_SHIFT = { center: 0.45, halfWidth: 0.08, feather: 0.3, strength: 0.6, maxRadius: 14, depthMix: 0.6 };

export const BAND_LIMITS = { min: 0.1, max: 0.9 };

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

// Pure: the band center, held inside the limits. A bad value gets the default.
export function clampBand(center) {
  if (!Number.isFinite(center)) return TILT_SHIFT.center;
  return Math.min(Math.max(center, BAND_LIMITS.min), BAND_LIMITS.max);
}

// Pure: the blur strength, held in 0..1. A bad value gets the default.
export function clampStrength(strength) {
  if (!Number.isFinite(strength)) return TILT_SHIFT.strength;
  return clamp01(strength);
}

// Pure: 0 inside the sharp band, 1 at full blur, as in the shader.
export function bandMask(y, { center, halfWidth, feather } = TILT_SHIFT) {
  return smoothstep(halfWidth, halfWidth + feather, Math.abs(y - center));
}

// Pure: the blur radius in px for a pixel at UV height `y` and view depth
// `depth`, with the focus depth `focus`, as in the shader.
export function blurRadius(y, depth, focus, p = TILT_SHIFT) {
  const step = clamp01(Math.abs(depth - focus) / Math.max(focus, 1e-3));
  const depthFactor = 1 - p.depthMix + p.depthMix * step;
  return p.strength * p.maxRadius * bandMask(y, p) * depthFactor;
}

const SAMPLES = 32;

export const TiltShiftShader = {
  defines: { SAMPLES },
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    center: { value: TILT_SHIFT.center },
    halfWidth: { value: TILT_SHIFT.halfWidth },
    feather: { value: TILT_SHIFT.feather },
    strength: { value: TILT_SHIFT.strength },
    maxRadius: { value: TILT_SHIFT.maxRadius },
    depthMix: { value: TILT_SHIFT.depthMix },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float center;
    uniform float halfWidth;
    uniform float feather;
    uniform float strength;
    uniform float maxRadius;
    uniform float depthMix;
    varying vec2 vUv;
    float viewDepth(vec2 uv) {
      return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
    }
    // The blur radius in px, as blurRadius() in tilt-shift.js.
    float radiusAt(vec2 uv, float focus) {
      float band = smoothstep(halfWidth, halfWidth + feather, abs(uv.y - center));
      float dstep = clamp(abs(viewDepth(uv) - focus) / max(focus, 0.001), 0.0, 1.0);
      return strength * maxRadius * band * (1.0 - depthMix + depthMix * dstep);
    }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float focus = viewDepth(vec2(0.5, center));
      float r = radiusAt(vUv, focus);
      if (r < 0.5) { gl_FragColor = base; return; }
      vec3 sum = base.rgb;
      float total = 1.0;
      // A golden-angle disc. A sample counts only as far as its own blur
      // reaches this pixel, so the sharp band does not bleed into the blur.
      for (int i = 0; i < SAMPLES; i++) {
        float fi = float(i) + 0.5;
        float rr = sqrt(fi / float(SAMPLES)) * r;
        float a = fi * 2.39996323;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * rr / resolution;
        float w = clamp(radiusAt(uv, focus) / max(rr, 0.5), 0.0, 1.0);
        sum += texture2D(tDiffuse, uv).rgb * w;
        total += w;
      }
      gl_FragColor = vec4(sum / total, base.a);
    }`,
};

// Adds the tilt-shift pass to the high tier post chain (src/render/post.js),
// after the ink pass and before bloom. The pass starts disabled.
export function addTiltShift(post, camera, renderer) {
  const pass = new ShaderPass(TiltShiftShader);
  pass.enabled = false;
  const index = post.composer.passes.indexOf(post.ink);
  post.composer.insertPass(pass, index >= 0 ? index + 1 : post.composer.passes.length - 1);
  const u = pass.uniforms;
  const size = new THREE.Vector2();

  return {
    pass,
    get enabled() {
      return pass.enabled;
    },
    set enabled(v) {
      pass.enabled = Boolean(v);
    },
    get params() {
      return { center: u.center.value, halfWidth: u.halfWidth.value, feather: u.feather.value, strength: u.strength.value, maxRadius: u.maxRadius.value, depthMix: u.depthMix.value };
    },
    set({ center, strength } = {}) {
      if (center !== undefined) u.center.value = clampBand(center);
      if (strength !== undefined) u.strength.value = clampStrength(strength);
    },
    // Call before each render while the pass is on.
    sync() {
      u.tDepth.value = post.gtao.depthTexture;
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
      renderer.getDrawingBufferSize(size);
      u.resolution.value.copy(size);
      u.maxRadius.value = TILT_SHIFT.maxRadius * Math.max(1, renderer.getPixelRatio());
    },
  };
}
