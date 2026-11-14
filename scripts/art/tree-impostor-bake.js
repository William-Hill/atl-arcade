// The bake page of scripts/bake-tree-impostors.mjs (#281). It renders one
// tree of each impostor cell with Three.js and an orthographic side camera,
// and gives the pixels to the script in window.__bake.
//
// The output is data, not a final color:
// - R: the toon shade (the soft 3-step ramp of the sun, times the baked
//   occlusion of the vertex colors), divided by SHADE_SCALE.
// - G: the bark mask (1 on the trunk and the branches, 0 on the crown).
// - B: 0.
// - A: the coverage.
// The game multiplies the shade by the season colors of each tree
// (src/render/tree-impostors.js), so one texture serves every season.

import * as THREE from "three";
import { treeTemplate } from "../../src/level/geo/trees.js";
import { IMPOSTOR_CELLS, SHADE_SCALE, templateBounds } from "../../src/render/tree-impostors.js";

const CELL = 256;
const SAMPLES = 4;
// The sun of the bake: high, a little to the right and to the front, as
// the game sun is seen on the lit side of a far tree.
const SUN = new THREE.Vector3(0.45, 0.8, 0.4).normalize();

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(CELL * IMPOSTOR_CELLS.length, CELL);
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);
const target = new THREE.WebGLRenderTarget(CELL * SAMPLES, CELL * SAMPLES, { type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace });

const material = new THREE.ShaderMaterial({
  uniforms: { uSun: { value: SUN }, uScale: { value: SHADE_SCALE } },
  vertexShader: `
    attribute vec3 color;
    attribute float tone;
    attribute float bark;
    varying vec3 vNormal;
    varying float vTone;
    varying float vBark;
    void main() {
      vNormal = normal;
      vTone = tone;
      vBark = bark;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 uSun;
    uniform float uScale;
    varying vec3 vNormal;
    varying float vTone;
    varying float vBark;
    void main() {
      // The soft toon ramp of the props (geo-view.js toonRamp): 110, 180, 255.
      float l = clamp(dot(normalize(vNormal), uSun) * 0.5 + 0.5, 0.0, 1.0);
      float ramp = l < 0.5 ? mix(110.0, 180.0, l * 2.0) : mix(180.0, 255.0, l * 2.0 - 1.0);
      float shade = ramp / 255.0 * vTone;
      gl_FragColor = vec4(clamp(shade / uScale, 0.0, 1.0), vBark, 0.0, 1.0);
    }`,
  side: THREE.DoubleSide,
});

// The tone of a vertex is its luminance over the mean luminance of its part
// (bark or crown), so the texture keeps the baked occlusion and the game
// gives the hue. A vertex is bark when its color is more red than green; the
// bake uses summer, when every crown of the bake trees is green.
function bakeGeometry(t) {
  const n = t.positions.length / 3;
  const lum = new Float32Array(n);
  const bark = new Float32Array(n);
  const sum = [0, 0];
  const count = [0, 0];
  for (let i = 0; i < n; i += 1) {
    const [r, g, b] = [t.colors[i * 3], t.colors[i * 3 + 1], t.colors[i * 3 + 2]];
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    bark[i] = r > g ? 1 : 0;
    sum[bark[i]] += lum[i];
    count[bark[i]] += 1;
  }
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i += 1) tone[i] = lum[i] / (sum[bark[i]] / Math.max(1, count[bark[i]]));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(t.positions), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(Float32Array.from(t.normals), 3));
  g.setAttribute("color", new THREE.BufferAttribute(Float32Array.from(t.colors), 3));
  g.setAttribute("tone", new THREE.BufferAttribute(tone, 1));
  g.setAttribute("bark", new THREE.BufferAttribute(bark, 1));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(t.indices), 1));
  return g;
}

const out = new Uint8Array(CELL * IMPOSTOR_CELLS.length * CELL * 4);
const big = new Uint8Array(CELL * SAMPLES * CELL * SAMPLES * 4);
IMPOSTOR_CELLS.forEach((cell, c) => {
  const t = treeTemplate(cell.species, cell.variant, 0, "summer");
  const b = templateBounds(t);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(bakeGeometry(t), material));
  // The camera looks at the tree from +z. The frame is the card rect of the
  // game: half width b.halfWidth, from y 0 to b.height.
  const camera = new THREE.OrthographicCamera(-b.halfWidth, b.halfWidth, b.height, 0, -100, 100);
  camera.position.set(0, 0, 50);
  camera.lookAt(0, 0, 0);
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(target, 0, 0, CELL * SAMPLES, CELL * SAMPLES, big);
  // Down-sample SAMPLES x SAMPLES to one pixel: the mean color of the
  // covered samples and the mean coverage. The rows come bottom first;
  // the PNG rows go top first.
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      let r = 0;
      let g = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const i = (((y * SAMPLES + sy) * CELL * SAMPLES) + x * SAMPLES + sx) * 4;
          if (big[i + 3] === 0) continue;
          r += big[i];
          g += big[i + 1];
          a += 1;
        }
      }
      const o = (((CELL - 1 - y) * CELL * IMPOSTOR_CELLS.length) + c * CELL + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = 0;
      out[o + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
    }
  }
});

// Spread the colors of the covered pixels into the empty pixels, so the
// mipmaps and the linear filter do not pull black into the card edges.
const W = CELL * IMPOSTOR_CELLS.length;
for (let pass = 0; pass < 16; pass += 1) {
  const filled = out.slice();
  let changed = 0;
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 4;
      if (out[o + 3] > 0 || out[o + 2] === 1) continue;
      let r = 0;
      let g = 0;
      let k = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        // Do not spread over the edge of a cell.
        if (nx < 0 || ny < 0 || nx >= W || ny >= CELL || Math.floor(nx / CELL) !== Math.floor(x / CELL)) continue;
        const p = (ny * W + nx) * 4;
        if (out[p + 3] === 0 && out[p + 2] !== 1) continue;
        r += out[p];
        g += out[p + 1];
        k += 1;
      }
      if (!k) continue;
      filled[o] = Math.round(r / k);
      filled[o + 1] = Math.round(g / k);
      // B = 1 marks a filled empty pixel (the game reads only R, G, and A).
      filled[o + 2] = 1;
      changed += 1;
    }
  }
  out.set(filled);
  if (!changed) break;
}

window.__bake = { width: W, height: CELL, pixels: Array.from(out), renderer: renderer.getContext().getParameter(renderer.getContext().VERSION), cells: IMPOSTOR_CELLS.map((c) => ({ ...c, ...templateBounds(treeTemplate(c.species, c.variant, 0, "summer")) })) };
