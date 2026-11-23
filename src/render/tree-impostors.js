import * as THREE from "three";
import { patchLeafFragment, patchLeafVertex, TREE_UNIFORMS } from "./leaf-cut.js";
import { templateGeometry } from "./prop-batch.js";

// The far trees: each near tree template drawn once from `views` sides into
// one atlas when the props load, then shown as that many crossed cards
// (the `${kind}_lod1` templates), so a far tree has the same shape and
// colors as the near one. The atlas is made in the browser: nothing to
// download. The cards light as one round crown, like the near trees.
export const IMPOSTOR = { cell: 128, views: 3 };

// Pure: the cell layout: a square grid of cells, `count` cells.
export function atlasGrid(count) {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

// Pure: the extent of a template: the crown radius (m) around the trunk
// axis, the top, and the card size (square, so the cells are square).
export function impostorExtent(t) {
  let r = 0;
  let top = 0;
  for (let i = 0; i < t.positions.length; i += 3) {
    r = Math.max(r, Math.hypot(t.positions[i], t.positions[i + 2]));
    top = Math.max(top, t.positions[i + 1]);
  }
  const size = Math.max(2 * r, top) * 1.02;
  return { radius: r, top, size, bottom: top - size };
}

// Pure: the crossed cards of one impostor. `cells[v]` is the atlas rect
// [u0, v0, u1, v1] of view v. Leaf code -10 - v marks an impostor pixel.
export function impostorTemplate(extent, cells) {
  const { size, top, bottom, radius } = extent;
  const positions = [];
  const normals = [];
  const colors = [];
  const sway = [];
  const leaf = [];
  const indices = [];
  const views = cells.length;
  const mid = top * 0.45;
  cells.forEach(([u0, v0, u1, v1], v) => {
    const a = (Math.PI * v) / views;
    const hx = Math.cos(a);
    const hz = Math.sin(a);
    const base = positions.length / 3;
    for (const [s, up, u, w] of [[-1, 0, u0, v0], [1, 0, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]]) {
      const x = (hx * s * size) / 2;
      const z = (hz * s * size) / 2;
      const y = up ? top : bottom;
      positions.push(x, y, z);
      const n = new THREE.Vector3(x / Math.max(radius, 0.1), (y - mid) / Math.max(top * 0.6, 0.1), z / Math.max(radius, 0.1)).normalize();
      n.y += 0.45;
      n.normalize();
      normals.push(n.x, n.y, n.z);
      colors.push(1, 1, 1);
      sway.push(up ? 0.5 : 0);
      leaf.push(u, w, -10 - v);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { positions, normals, colors, sway, leaf, indices };
}

// Draws the atlas with `renderer` and returns { templates: { `${kind}_lod1` },
// atlas, bytes }. The atlas becomes TREE_UNIFORMS.uTreeAtlas.
export function bakeTreeImpostors(renderer, templates, { cell = IMPOSTOR.cell, views = IMPOSTOR.views } = {}) {
  const kinds = Object.keys(templates).sort();
  const grid = atlasGrid(kinds.length * views);
  const px = grid * cell;
  const target = new THREE.WebGLRenderTarget(px, px, { colorSpace: THREE.SRGBColorSpace });
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    patchLeafVertex(shader);
    patchLeafFragment(shader);
    // Not the atlas itself: no feedback loop while it draws.
    shader.uniforms.uTreeAtlas = { value: new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) };
    shader.uniforms.uTreeAtlas.value.needsUpdate = true;
  };
  material.customProgramCacheKey = () => "tree-impostor-bake";
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera();
  const saved = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear };
  renderer.autoClear = false;
  const out = {};
  let n = 0;
  for (const kind of kinds) {
    const t = templates[kind];
    const ext = impostorExtent(t);
    const geom = templateGeometry(t);
    const mesh = new THREE.Mesh(geom, material);
    scene.add(mesh);
    // The clear color: the mean leaf color, so the mip edges are not dark.
    const mean = [0, 0, 0];
    let cards = 0;
    for (let i = 0; i < t.leaf.length; i += 3) {
      if (t.leaf[i + 2] > 0) {
        for (let c = 0; c < 3; c += 1) mean[c] += t.colors[i + c];
        cards += 1;
      }
    }
    renderer.setClearColor(new THREE.Color(...mean.map((v) => v / Math.max(cards, 1))), 0);
    const cells = [];
    for (let v = 0; v < views; v += 1, n += 1) {
      const cx = n % grid;
      const cy = Math.floor(n / grid);
      const a = (Math.PI * v) / views;
      // The camera looks at the card plane (spanned by +y and (cos a, 0, sin a)).
      const normal = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      camera.left = -ext.size / 2;
      camera.right = ext.size / 2;
      camera.top = ext.top;
      camera.bottom = ext.bottom;
      camera.near = 0.1;
      camera.far = 200;
      camera.position.copy(normal).multiplyScalar(100);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      target.viewport.set(cx * cell, cy * cell, cell, cell);
      target.scissor.set(cx * cell, cy * cell, cell, cell);
      target.scissorTest = true;
      renderer.setRenderTarget(target);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
      cells.push([cx / grid, cy / grid, (cx + 1) / grid, (cy + 1) / grid]);
    }
    scene.remove(mesh);
    geom.dispose();
    out[`${kind}_lod1`] = impostorTemplate(ext, cells);
  }
  renderer.setRenderTarget(saved.target);
  renderer.setClearColor(saved.color, saved.alpha);
  renderer.autoClear = saved.autoClear;
  material.dispose();
  // Read back once into a plain texture with mips: sampling the render
  // target itself gave black on some GPUs (SwiftShader).
  const pixels = new Uint8Array(px * px * 4);
  renderer.readRenderTargetPixels(target, 0, 0, px, px, pixels);
  renderer.setRenderTarget(saved.target);
  target.dispose();
  const atlas = new THREE.DataTexture(pixels, px, px, THREE.RGBAFormat);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.needsUpdate = true;
  TREE_UNIFORMS.uTreeAtlas.value = atlas;
  // RGBA8 with the mip chain.
  return { templates: out, atlas, pixels, size: px, bytes: Math.round(px * px * 4 * (4 / 3)) };
}
