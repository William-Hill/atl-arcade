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
      edge *= 1.0 - smoothstep(fadeNear, fadeFar, d);
      col.rgb *= 1.0 - strength * edge;
      gl_FragColor = col;
    }`,
};

export function createPost(renderer, scene, camera, { fadeNear, fadeFar }) {
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
  }
  return {
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
  };
}
