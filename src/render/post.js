import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { withLeafCut } from "./leaf-cut.js";
import { GRADE_PIVOT, SPLIT, TIME_GRADES } from "./pbr-palette.js";

// The high tier post chain:
//   scene (MSAA x4) -> GTAO ambient occlusion -> ink outlines -> bloom -> output.
// The ink pass reads the depth and normal buffers that GTAO already draws,
// so the outlines cost no extra scene pass. The outlines give the Jet Set
// Radio cel look; they fade out with the fog.
//
// The ink pass also draws a halftone in the shadows: a screen grid of dots,
// turned 45 degrees, that darkens a dark pixel. A dot grows as the pixel
// gets darker, as in print. It fades out with the ink.

export const HALFTONE = { cell: 5, start: 0.16, strength: 0.22 };

// Pure: the dot radius (in cells, 0..0.5) for a linear luminance, as in the
// shader. Black gets a radius of 0.5, and `start` or brighter gets none.
export function halftoneRadius(luma, { start } = HALFTONE) {
  const t = Math.min(Math.max(1 - luma / start, 0), 1);
  return 0.5 * Math.sqrt(t);
}

// Sync the composer with the renderer. The EffectComposer keeps its own copy
// of the pixel ratio from its constructor. When the governor (#72) changes
// the renderer pixel ratio, the composer must get the new value, or the
// chain renders at the old resolution. `size` is the drawing buffer size.
export function syncComposerSize(composer, renderer, size) {
  const pr = renderer.getPixelRatio();
  composer.setPixelRatio(pr);
  composer.setSize(size.x / pr, size.y / pr);
}

// Dispose a composer and its passes. EffectComposer.dispose() frees only
// its own render targets and its copy pass. GTAO, bloom, and the shader
// passes own render targets and materials, so each pass gets a dispose call.
export function disposeComposer(composer) {
  for (const pass of composer.passes) {
    if (typeof pass.dispose === "function") pass.dispose();
  }
  composer.dispose();
}

// The crease test of the ink pass, on the normal buffer. A crease draws
// ink where the normal step `dn` (1 - cos) goes from `start` to `end`. The
// step must hold 2 pixels out (`wide`), and this pixel must not be a sliver
// between two neighbors that agree (`sliver`): a face under one pixel wide
// shows at some pixels only and gives a dotted line.
export const INK_CREASE = { start: 0.35, end: 0.6, wide: [0.2, 0.35], sliver: [0.1, 0.2] };

function smooth(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Pure: the crease ink (0..1) at a pixel with the normal n, as in the
// shader. na is the normal one step out, nb two steps out, and nc one step
// back.
export function creaseInk(n, na, nb, nc, c = INK_CREASE) {
  const wide = smooth(c.wide[0], c.wide[1], 1 - dot3(n, nb)) * smooth(c.sliver[0], c.sliver[1], 1 - dot3(nc, na));
  return smooth(c.start, c.end, 1 - dot3(n, na)) * wide;
}

const f3 = (v) => v.toFixed(3);

const InkShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    tNormal: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    fadeNear: { value: 120 },
    fadeFar: { value: 400 },
    strength: { value: 0.85 },
    thickness: { value: 1 },
    // 1 for an orthographic camera (the isometric map bake).
    ortho: { value: 0 },
    // x: the dot cell (px), y: the luminance where the dots start, z: the
    // darkening inside a dot. x = 0 turns the halftone off.
    halftone: { value: new THREE.Vector3(HALFTONE.cell, HALFTONE.start, HALFTONE.strength) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform sampler2D tNormal;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float fadeNear;
    uniform float fadeFar;
    uniform float strength;
    uniform float thickness;
    uniform float ortho;
    uniform vec3 halftone;
    varying vec2 vUv;
    float viewDepth(vec2 uv) {
      float z = texture2D(tDepth, uv).x;
      return ortho > 0.5 ? -orthographicDepthToViewZ(z, cameraNear, cameraFar) : -perspectiveDepthToViewZ(z, cameraNear, cameraFar);
    }
    vec3 viewNormal(vec2 uv) { return unpackRGBToNormal(texture2D(tNormal, uv).rgb); }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 px = thickness / resolution;
      float d = viewDepth(vUv);
      vec3 n = viewNormal(vUv);
      float edge = 0.0;
      vec2 offs[4];
      offs[0] = vec2(px.x, 0.0); offs[1] = vec2(-px.x, 0.0); offs[2] = vec2(0.0, px.y); offs[3] = vec2(0.0, -px.y);
      for (int i = 0; i < 4; i++) {
        vec2 uv = vUv + offs[i];
        float dn = viewDepth(uv);
        // A depth step relative to the depth: a silhouette edge. Only the
        // nearer side draws ink, so an edge is one pixel wide.
        float dz = (dn - d) / d;
        edge = max(edge, smoothstep(0.04, 0.12, dz));
        // A normal step: a crease, such as a wall corner or a roof edge.
        vec3 na = viewNormal(uv);
        float dn2 = 1.0 - dot(n, na);
        // A face under one pixel wide (the top of a sign band, the end of
        // a name panel) shows in the normal buffer at some pixels only, and
        // gives a dotted line. The normal buffer has no MSAA. So a crease
        // must hold for 2 pixels: the pixel 2 steps away also differs from
        // this pixel, and this pixel is not a sliver between two neighbors
        // that agree.
        vec3 nb = viewNormal(vUv + offs[i] * 2.0);
        vec3 nc = viewNormal(vUv - offs[i]);
        float wide = smoothstep(${f3(INK_CREASE.wide[0])}, ${f3(INK_CREASE.wide[1])}, 1.0 - dot(n, nb)) * smoothstep(${f3(INK_CREASE.sliver[0])}, ${f3(INK_CREASE.sliver[1])}, 1.0 - dot(nc, na));
        edge = max(edge, smoothstep(${f3(INK_CREASE.start)}, ${f3(INK_CREASE.end)}, dn2) * step(abs(dz), 0.05) * wide);
      }
      float fade = 1.0 - smoothstep(fadeNear, fadeFar, d);
      edge *= fade;
      if (halftone.x > 0.0) {
        float luma = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
        float r = 0.5 * sqrt(clamp(1.0 - luma / halftone.y, 0.0, 1.0));
        vec2 p = gl_FragCoord.xy / halftone.x;
        p = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p;
        float dist = length(fract(p) - 0.5);
        float dotMask = 1.0 - smoothstep(r - 0.08, r + 0.08, dist);
        col.rgb *= 1.0 - halftone.z * dotMask * step(0.01, r) * fade;
      }
      col.rgb *= 1.0 - strength * edge;
      gl_FragColor = col;
    }`,
};

// The grade pass (pbr look), on the linear color before the tone mapping:
// a contrast on the luma around a mid gray (GRADE_PIVOT), a saturation that
// keeps the luma, a split tone (cool shadows, warm lights) scaled by uWarm,
// a small black lift, and the district tint (src/render/pbr-palette.js
// gradePixel() is the same formula). src/render/pbr-look.js writes the
// uniforms each frame by the time of day and the district.
const v3 = (c) => `vec3(${c.map((v) => v.toFixed(4)).join(", ")})`;
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: TIME_GRADES.day.contrast },
    uSat: { value: TIME_GRADES.day.saturation },
    uWarm: { value: TIME_GRADES.day.warm },
    uLift: { value: 0.0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uContrast;
    uniform float uSat;
    uniform float uWarm;
    uniform float uLift;
    uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec3 c = max(col.rgb, vec3(0.0));
      float l0 = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float l1 = l0 > 0.0 ? ${GRADE_PIVOT.toFixed(4)} * pow(l0 / ${GRADE_PIVOT.toFixed(4)}, uContrast) : 0.0;
      c *= l0 > 1e-6 ? l1 / l0 : 0.0;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(vec3(l) + (c - vec3(l)) * uSat, vec3(0.0));
      float w = smoothstep(${SPLIT.range[0].toFixed(4)}, ${SPLIT.range[1].toFixed(4)}, l);
      c = (c * (vec3(1.0) + uWarm * mix(${v3(SPLIT.shadow)}, ${v3(SPLIT.light)}, w)) + vec3(uLift)) * uTint;
      gl_FragColor = vec4(c, col.a);
    }`,
};

export function createPost(renderer, scene, camera, { fadeNear, fadeFar, halftone = true, ink: inkStrength = 0.85, look = "toon" }) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  // The tree leaf cut (src/render/leaf-cut.js): the AO sees the trunks, the
  // crown cores and the impostors, but not the leaf cards (#202).
  withLeafCut(gtao.normalMaterial);
  // World units are meters: a 2.5 m radius darkens the ground at a wall
  // foot, the inside corners, and under the trees. A 1 m thickness: only
  // geometry within 1 m in depth occludes, so a pole in front of open
  // ground leaves no dark halo on it.
  gtao.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.5, thickness: 1, scale: 1.2, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  const pbr = look === "pbr";
  // Characters (skinned: Nia, the NPC skaters, the people, the dog) stay out
  // of the AO depth, as points and lines do: their legs left a speckled dark
  // patch on the ground around the feet. The sun shadow grounds them. Only
  // the pbr look: the toon ink reads its outlines from this depth.
  if (pbr) gtao._overrideVisibility = function () {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      if ((o.isPoints || o.isLine || o.isLine2 || o.isSkinnedMesh) && o.visible) {
        o.visible = false;
        cache.push(o);
      }
    });
  };
  gtao.blendIntensity = pbr ? 1.0 : 0.9;
  composer.addPass(gtao);

  // The pbr look drops the ink lines and the halftone dots — the Jet Set
  // Radio effect — and grades instead. The toon look keeps the ink pass.
  let ink = null;
  let grade = null;
  if (pbr) {
    grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
  } else {
    ink = new ShaderPass(InkShader);
    ink.uniforms.fadeNear.value = fadeNear;
    ink.uniforms.fadeFar.value = fadeFar;
    if (!halftone) ink.uniforms.halftone.value.x = 0;
    ink.uniforms.strength.value = inkStrength;
    composer.addPass(ink);
  }

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.28, 0.5, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function sync() {
    if (ink) {
      ink.uniforms.tDepth.value = gtao.depthTexture;
      ink.uniforms.tNormal.value = gtao.normalTexture;
      ink.uniforms.cameraNear.value = camera.near;
      ink.uniforms.cameraFar.value = camera.far;
      ink.uniforms.ortho.value = camera.isOrthographicCamera ? 1 : 0;
      ink.uniforms.thickness.value = 1.25 * Math.max(1, renderer.getPixelRatio());
      if (ink.uniforms.halftone.value.x > 0) ink.uniforms.halftone.value.x = HALFTONE.cell * Math.max(1, renderer.getPixelRatio());
    }
  }
  return {
    kind: "full",
    composer,
    gtao,
    ink,
    grade,
    bloom,
    render() {
      sync();
      composer.render();
    },
    setSize() {
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      // EffectComposer multiplies by the pixel ratio itself.
      syncComposerSize(composer, renderer, s);
      if (ink) ink.uniforms.resolution.value.set(s.x, s.y);
    },
    dispose() {
      // The composer also disposes `target`, its first render target.
      disposeComposer(composer);
    },
  };
}

// The phone tier post pass (#72): one scene pass into a target with a depth
// texture, then one fullscreen pass that draws the ink and the halftone.
// There is no normal buffer, so the creases come from the depth only: the
// inverse view depth is linear across a flat surface in screen space, so its
// second difference is near zero on a plane and large at a corner or an
// edge. No GTAO, no bloom, and no MSAA.
const LiteInkShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    fadeNear: { value: 120 },
    fadeFar: { value: 400 },
    strength: { value: 0.85 },
    thickness: { value: 1 },
    crease: { value: new THREE.Vector2(0.012, 0.04) },
    halftone: { value: new THREE.Vector3(HALFTONE.cell, HALFTONE.start, HALFTONE.strength) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float fadeNear;
    uniform float fadeFar;
    uniform float strength;
    uniform float thickness;
    uniform vec2 crease;
    uniform vec3 halftone;
    varying vec2 vUv;
    float viewDepth(vec2 uv) {
      return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
    }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 px = thickness / resolution;
      float d = viewDepth(vUv);
      float dl = viewDepth(vUv - vec2(px.x, 0.0));
      float dr = viewDepth(vUv + vec2(px.x, 0.0));
      float dd = viewDepth(vUv - vec2(0.0, px.y));
      float du = viewDepth(vUv + vec2(0.0, px.y));
      // Silhouette: a far neighbor. Only the nearer side draws ink.
      float edge = 0.0;
      edge = max(edge, smoothstep(0.04, 0.12, (dl - d) / d));
      edge = max(edge, smoothstep(0.04, 0.12, (dr - d) / d));
      edge = max(edge, smoothstep(0.04, 0.12, (dd - d) / d));
      edge = max(edge, smoothstep(0.04, 0.12, (du - d) / d));
      // Crease: the second difference of the inverse depth.
      float w = 1.0 / d;
      float lx = abs(1.0 / dl + 1.0 / dr - 2.0 * w) / w;
      float ly = abs(1.0 / du + 1.0 / dd - 2.0 * w) / w;
      edge = max(edge, smoothstep(crease.x, crease.y, max(lx, ly)));
      float fade = 1.0 - smoothstep(fadeNear, fadeFar, d);
      edge *= fade;
      if (halftone.x > 0.0) {
        float luma = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
        float r = 0.5 * sqrt(clamp(1.0 - luma / halftone.y, 0.0, 1.0));
        vec2 p = gl_FragCoord.xy / halftone.x;
        p = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p;
        float dist = length(fract(p) - 0.5);
        float dotMask = 1.0 - smoothstep(r - 0.08, r + 0.08, dist);
        col.rgb *= 1.0 - halftone.z * dotMask * step(0.01, r) * fade;
      }
      col.rgb *= 1.0 - strength * edge;
      gl_FragColor = col;
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export function createLitePost(renderer, scene, camera, { fadeNear, fadeFar, halftone = true }) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    depthTexture: new THREE.DepthTexture(size.x, size.y),
    depthBuffer: true,
  });
  // An sRGB target keeps 8-bit colors without dark banding.
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(LiteInkShader.uniforms),
    vertexShader: LiteInkShader.vertexShader,
    fragmentShader: LiteInkShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const u = material.uniforms;
  u.tDiffuse.value = target.texture;
  u.tDepth.value = target.depthTexture;
  u.fadeNear.value = fadeNear;
  u.fadeFar.value = fadeFar;
  if (!halftone) u.halftone.value.x = 0;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function sync() {
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    const pr = Math.max(1, renderer.getPixelRatio());
    u.thickness.value = 1.25 * pr;
    if (u.halftone.value.x > 0) u.halftone.value.x = HALFTONE.cell * pr;
  }
  return {
    kind: "lite",
    ink: { uniforms: u },
    render() {
      sync();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCamera);
    },
    setSize() {
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      target.setSize(s.x, s.y);
      u.resolution.value.set(s.x, s.y);
    },
    dispose() {
      target.dispose();
      material.dispose();
      quad.geometry.dispose();
    },
  };
}
