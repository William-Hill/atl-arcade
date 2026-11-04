import * as THREE from "three";

// Rain streaks in a box that wraps around the camera. A port of the
// gen-city rain.wgsl (github.com/greggman/gen-city-auto, MIT-0): each drop
// is a quad stretched along its velocity, animated on the GPU with no per
// frame CPU work. The fragment colors the streak with the sky ambient and
// the night city glow, so it reads against dark facades and a gray sky.
//
// One instanced draw call. `count` drops recycle inside a BOX meter cube:
// a drop that leaves the box at the bottom wraps back at the top.

const BOX = 36;

export function createRain({ count = 1800 } = {}) {
  const geo = new THREE.InstancedBufferGeometry();
  // Two triangles per drop: corner x is the streak width, y the length.
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, 0, 1, 0, 1, 1, -1, 0, 1, 1, -1, 1]), 2));
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < seeds.length; i += 1) seeds[i] = Math.random();
  geo.setAttribute("seed", new THREE.InstancedBufferAttribute(seeds, 3));
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Premultiplied "over": the streak partly replaces what is behind it.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2(0.9, 0.3) },
      uSky: { value: new THREE.Color(0.4, 0.45, 0.55) },
      uGlow: { value: new THREE.Color(0, 0, 0) },
      uResY: { value: 720 },
      uIntensity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCam;
      uniform vec2 uWind;
      uniform float uResY;
      attribute vec3 seed;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        vec3 h = seed;
        float speed = 9.0 + h.x * 3.0;
        vec3 wind = vec3(uWind.x, 0.0, uWind.y) * 2.5;
        vec3 vel = vec3(wind.x, -speed, wind.z);
        // The drop wraps inside a box that follows the camera.
        vec3 p = h * ${BOX.toFixed(1)} + vel * uTime;
        p = p - floor((p - uCam + ${(BOX / 2).toFixed(1)}) / ${BOX.toFixed(1)}) * ${BOX.toFixed(1)};
        // A motion-blurred streak, about a 1/50 s exposure.
        float len = speed * mix(0.03, 0.055, h.y);
        vec3 dir = normalize(vel);
        vec3 toCam = normalize(uCam - p);
        // At least about 0.7 px wide so the streak does not average away.
        float pxW = distance(p, uCam) * 1.4 / uResY;
        vec3 side = normalize(cross(dir, toCam)) * max(mix(0.004, 0.008, h.z), pxW);
        vec3 w = p + side * position.x + dir * len * position.y;
        vUv = position.xy;
        vFade = smoothstep(${(BOX / 2).toFixed(1)}, ${(BOX * 0.2).toFixed(1)}, distance(p, uCam)) * smoothstep(0.3, 2.0, distance(p, uCam));
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSky;
      uniform vec3 uGlow;
      uniform float uIntensity;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        float a = (1.0 - abs(vUv.x)) * pow(sin(vUv.y * 3.14159), 0.7) * vFade * 0.42;
        vec3 c = uSky * 1.9 + uGlow * 6.0;
        gl_FragColor = vec4(c * a * uIntensity, a * uIntensity);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 900;
  return {
    mesh,
    // camera: the camera (the box follows it). state: a weather.js
    // skyState — sets the tint, the intensity, and whether it draws.
    update(camera, time, state, height = 720) {
      const u = material.uniforms;
      u.uTime.value = time;
      u.uCam.value.copy(camera.position);
      u.uResY.value = height;
      u.uIntensity.value = state ? state.rainRate : 0;
      mesh.visible = Boolean(state && state.rainRate > 0.02);
      if (state) {
        u.uSky.value.setRGB(state.horizon[0] * 0.6 + 0.15, state.horizon[1] * 0.6 + 0.15, state.horizon[2] * 0.6 + 0.15);
        u.uGlow.value.setRGB(state.glow[0], state.glow[1], state.glow[2]);
      }
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
