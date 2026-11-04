import * as THREE from "three";

// A stylized day sky: a gradient dome with a sun disc and, on the high
// tier, cel-shaded clouds (two hard color steps, as in the toon ramp).
// The dome follows the camera, so it never comes nearer. The fog color is
// the horizon color, so far buildings fade into the sky.

export const SKY = {
  zenith: new THREE.Color(0x2f8fe8),
  horizon: new THREE.Color(0xbfe4ff),
};

export function createSky({ radius, sunDirection, clouds = false }) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    defines: clouds ? { CLOUDS: 1 } : {},
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
      #endif
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
        // Below the horizon: the horizon color (the fog hides the ground edge).
        if (d.y < 0.0) col = uHorizon;
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.93, 0.75) * (pow(s, 900.0) * 1.6 + pow(s, 12.0) * 0.18);
        #ifdef CLOUDS
        if (d.y > 0.02) {
          // Project the view ray on a cloud plane, so the clouds get smaller
          // toward the horizon.
          vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(uTime * 0.004, 0.0);
          float c = fbm(uv);
          float edge = smoothstep(0.02, 0.25, d.y);
          // The coverage moves the threshold: a clear day keeps a few small
          // clouds, an overcast day fills the dome. A storm darkens them.
          float thr = mix(0.75, 0.32, uCover);
          float body = smoothstep(thr, thr + 0.08, c) * edge;
          float shade = smoothstep(thr + 0.12, thr + 0.4, c);
          vec3 cloud = mix(vec3(0.80, 0.86, 0.95), vec3(1.0), shade) * mix(1.0, 0.5, uCloudDark);
          col = mix(col, cloud, body * 0.95);
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
