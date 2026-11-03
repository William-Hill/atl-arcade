import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

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
    uniform vec3 halftone;
    varying vec2 vUv;
    float viewDepth(vec2 uv) {
      return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
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
        float dn2 = 1.0 - dot(n, viewNormal(uv));
        edge = max(edge, smoothstep(0.35, 0.6, dn2) * step(abs(dz), 0.05));
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

export function createPost(renderer, scene, camera, { fadeNear, fadeFar, halftone = true }) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  // World units are meters: a 2.5 m radius darkens the ground at a wall
  // foot, the inside corners, and under the trees.
  gtao.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.5, thickness: 4, scale: 1.2, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  gtao.blendIntensity = 0.9;
  composer.addPass(gtao);

  const ink = new ShaderPass(InkShader);
  ink.uniforms.fadeNear.value = fadeNear;
  ink.uniforms.fadeFar.value = fadeFar;
  if (!halftone) ink.uniforms.halftone.value.x = 0;
  composer.addPass(ink);

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.28, 0.5, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function sync() {
    ink.uniforms.tDepth.value = gtao.depthTexture;
    ink.uniforms.tNormal.value = gtao.normalTexture;
    ink.uniforms.cameraNear.value = camera.near;
    ink.uniforms.cameraFar.value = camera.far;
    ink.uniforms.thickness.value = 1.25 * Math.max(1, renderer.getPixelRatio());
    if (ink.uniforms.halftone.value.x > 0) ink.uniforms.halftone.value.x = HALFTONE.cell * Math.max(1, renderer.getPixelRatio());
  }
  return {
    kind: "full",
    composer,
    gtao,
    ink,
    bloom,
    render() {
      sync();
      composer.render();
    },
    setSize() {
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      // EffectComposer multiplies by the pixel ratio itself.
      composer.setSize(s.x / renderer.getPixelRatio(), s.y / renderer.getPixelRatio());
      ink.uniforms.resolution.value.set(s.x, s.y);
    },
    dispose() {
      composer.dispose();
      target.dispose();
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
