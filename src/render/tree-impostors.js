import * as THREE from "three";

// Far tree impostors (#281). The props hide past PROP_DRAW_DISTANCE
// (geo-view.js). Past that distance, each tree shows as a flat card with a
// baked picture of a tree (an impostor): 2 triangles per tree. All the far
// trees are one InstancedMesh, thus one draw call.
//
// - The art: assets/trees/impostors.png, two cells (tree_round, tree_tall),
//   from scripts/bake-tree-impostors.mjs. The texture keeps the toon shade
//   and a bark mask, not a color. Each card gets the leaf color and the bark
//   color of its tree in the season (the LOD1 template colors), so the cards
//   use the season colors of geo-view.js.
// - The cards turn about their vertical axis to the camera, and lean back a
//   little when the camera is high, so a view from a roof does not see a
//   thin card.
// - A card fades in with a screen-door dither from `near - nearBand` to
//   `near`. The LOD1 tree still shows in that band, so the change at the
//   prop draw distance is not a pop. A card fades out in the same way from
//   `far - farBand` to `far`, so the tree line has no hard edge.
// - The CPU picks the trees in the ring around the camera (with a margin)
//   only when the camera moves `step` meters. The shader gives the exact
//   fade of each card in each frame.

// The far edge of the layer (m). The near edge is the prop draw distance.
export const FAR_TREE_DISTANCE = 450;
// The fade bands (m) and the camera move (m) that starts a new pick.
export const FAR_TREES = { nearBand: 20, farBand: 60, step: 10 };
// The two cells of the impostor atlas, left to right: the kind, and the
// procedural tree (src/level/geo/trees.js) of the bake.
export const IMPOSTOR_CELLS = [
  { kind: "tree_round", species: "oak", variant: 0 },
  { kind: "tree_tall", species: "pine", variant: 0 },
];
// The bake stores the shade divided by this value, so a shade over 1 (a
// light vertex color in the sun) does not clip.
export const SHADE_SCALE = 1.25;
// The light of the cards for each look. The near trees get the scene
// lights; the cards are not lit, so this value sets them to the same
// brightness at the near edge (checked on the screenshots at 200 m).
export const CARD_LIGHT = { toon: 1.0, pbr: 0.95 };

const IMPOSTOR_URL = new URL("../../assets/trees/impostors.png", import.meta.url).href;

// Pure: the atlas cell of a species. The pine (the tall kind) has its own
// cell. The other species have a round crown.
export function impostorCellFor(species) {
  return species === "pine" ? 1 : 0;
}

// Pure: the species of a procedural tree kind ("tree:oak:2"), or null.
export function treeSpeciesOf(kind) {
  const m = /^tree:([a-z]+):\d+$/.exec(kind);
  return m ? m[1] : null;
}

function smooth(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

// Pure: the fade (0 to 1) of a card at `distance` (m) from the camera. The
// same function as the GLSL smoothstep() of the card shader.
export function farTreeFade(distance, { near, far, nearBand = FAR_TREES.nearBand, farBand = FAR_TREES.farBand }) {
  if (!(distance >= 0)) return 0;
  return smooth((distance - (near - nearBand)) / nearBand) * (1 - smooth((distance - (far - farBand)) / farBand));
}

// Pure: the trees of the far layer for a camera at (cx, cz). `xz` holds
// x, z for each tree. A tree is in the layer when its distance is from
// `near - nearBand - margin` to `far + margin` (the margin covers the camera
// move until the next pick). The indices go into `out`; the return value is
// the count.
export function selectFarTrees(xz, cx, cz, { near, far, nearBand = FAR_TREES.nearBand, margin = FAR_TREES.step }, out) {
  const lo = Math.max(0, near - nearBand - margin);
  const hi = far + margin;
  const lo2 = lo * lo;
  const hi2 = hi * hi;
  let n = 0;
  for (let i = 0; i < xz.length / 2; i += 1) {
    const dx = xz[i * 2] - cx;
    const dz = xz[i * 2 + 1] - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= lo2 && d2 < hi2) {
      out[n] = i;
      n += 1;
    }
  }
  return n;
}

// Pure: the card rect of a tree template ({ positions }): the half width
// (the largest distance from the trunk axis) and the height (the top),
// in m at scale 1.
export function templateBounds(t) {
  let r2 = 0;
  let top = 0;
  for (let i = 0; i < t.positions.length; i += 3) {
    r2 = Math.max(r2, t.positions[i] * t.positions[i] + t.positions[i + 2] * t.positions[i + 2]);
    top = Math.max(top, t.positions[i + 1]);
  }
  return { halfWidth: Math.sqrt(r2), height: top };
}

// The vertices of one side of one LOD1 card (trees.js cardTree()): 4 trunk
// vertices, then the crown center and 8 rim vertices.
const CARD_SIDE = { trunk: 4, size: 13 };

// Pure: the mean leaf color and the mean bark color (linear RGB) of a LOD1
// tree template, in the season of the template.
export function cardColors(t) {
  const leaf = [0, 0, 0];
  const bark = [0, 0, 0];
  let nl = 0;
  let nb = 0;
  for (let i = 0; i < t.colors.length / 3; i += 1) {
    const isBark = i % CARD_SIDE.size < CARD_SIDE.trunk;
    const sum = isBark ? bark : leaf;
    for (let c = 0; c < 3; c += 1) sum[c] += t.colors[i * 3 + c];
    if (isBark) nb += 1;
    else nl += 1;
  }
  return { leaf: leaf.map((v) => v / Math.max(1, nl)), bark: bark.map((v) => v / Math.max(1, nb)) };
}

// Pure: the card data of each tree placement with a procedural tree kind
// and its templates. Returns { x, y, z, halfWidth, height, cell, flip, leaf, bark }
// for each far tree.
export function farTreeCards(placements, templates) {
  const byKind = new Map();
  const cards = [];
  for (const p of placements) {
    const species = treeSpeciesOf(p.kind);
    if (!species || !templates[p.kind]) continue;
    let k = byKind.get(p.kind);
    if (!k) {
      const lod1 = templates[`${p.kind}_lod1`] ?? templates[p.kind];
      k = { ...templateBounds(templates[p.kind]), ...cardColors(lod1), cell: impostorCellFor(species) };
      byKind.set(p.kind, k);
    }
    const s = p.scale ?? 1;
    // Half the cards show the picture mirrored, so the far trees of one
    // kind do not all lean the same way.
    const flip = (Math.round(p.x * 7) + Math.round(p.z * 13)) & 1;
    cards.push({ x: p.x, y: p.y ?? 0, z: p.z, halfWidth: k.halfWidth * s, height: k.height * s, cell: k.cell, flip, leaf: k.leaf, bark: k.bark });
  }
  return cards;
}

const VERTEX = /* glsl */ `
  attribute float aCell;
  attribute vec3 aLeaf;
  attribute vec3 aBark;
  uniform vec4 uFade;
  varying vec2 vUv;
  varying vec3 vLeaf;
  varying vec3 vBark;
  varying float vFade;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec3 base = instanceMatrix[3].xyz;
    float halfWidth = instanceMatrix[0][0];
    float height = instanceMatrix[1][1];
    vec3 to = cameraPosition - (base + vec3(0.0, height * 0.5, 0.0));
    float flat_ = max(length(to.xz), 0.001);
    vec3 forward = vec3(to.x / flat_, 0.0, to.z / flat_);
    vec3 right = vec3(forward.z, 0.0, -forward.x);
    // Lean the card back by half the camera elevation.
    float lean = 0.5 * atan(max(to.y, 0.0), flat_);
    vec3 up = vec3(0.0, cos(lean), 0.0) - forward * sin(lean);
    vec3 world = base + right * position.x * 2.0 * halfWidth + up * position.y * height;
    float d = length(cameraPosition.xz - base.xz);
    vFade = smoothstep(uFade.x, uFade.y, d) * (1.0 - smoothstep(uFade.z, uFade.w, d));
    // aCell is the cell, plus 2 for a mirrored card.
    float flip = step(1.5, aCell);
    float u = mix(position.x, -position.x, flip);
    vUv = vec2((u + 0.5 + aCell - 2.0 * flip) * 0.5, position.y);
    vLeaf = aLeaf;
    vBark = aBark;
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uLight;
  uniform float uShadeScale;
  varying vec2 vUv;
  varying vec3 vLeaf;
  varying vec3 vBark;
  varying float vFade;
  #include <common>
  #include <fog_pars_fragment>
  // A 4x4 Bayer matrix: the screen-door threshold of the fade.
  float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x / 2.0 + a.y * a.y * 0.75);
  }
  float bayer4(vec2 a) {
    return bayer2(0.5 * a) * 0.25 + bayer2(a) + 1.0 / 32.0;
  }
  void main() {
    vec4 t = texture2D(uMap, vUv);
    if (t.a < 0.5) discard;
    if (vFade <= bayer4(gl_FragCoord.xy)) discard;
    vec3 color = mix(vLeaf, vBark, step(0.5, t.g)) * t.r * uShadeScale * uLight;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

// The impostor texture: data (the shade, the mask, the coverage), not
// color, so no color space conversion.
function loadImpostorMap(url = IMPOSTOR_URL) {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

// The far tree layer for the placements of a level (after
// withProceduralTrees) and the tree templates. `near` is the prop draw
// distance. Returns { mesh, info, update(cameraPosition) }.
export function createTreeImpostors(placements, templates, { near, far = FAR_TREE_DISTANCE, look = "toon", map = null } = {}) {
  const cards = farTreeCards(placements, templates);
  const n = cards.length;
  const geom = new THREE.PlaneGeometry(1, 1);
  // The card base is at y 0: x from -0.5 to 0.5, y from 0 to 1.
  geom.translate(0, 0.5, 0);
  const cell = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n)), 1);
  const leaf = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
  const bark = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
  for (const a of [cell, leaf, bark]) a.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute("aCell", cell);
  geom.setAttribute("aLeaf", leaf);
  geom.setAttribute("aBark", bark);
  const range = { near, far, nearBand: FAR_TREES.nearBand, farBand: FAR_TREES.farBand };
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMap: { value: null },
        uLight: { value: CARD_LIGHT[look] ?? 1 },
        uShadeScale: { value: SHADE_SCALE },
        uFade: { value: new THREE.Vector4(near - range.nearBand, near, far - range.farBand, far) },
      },
    ]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: true,
    side: THREE.DoubleSide,
  });
  // The normal pass of the post chain (GTAOPass) sets an override material
  // on the scene. That material cannot turn a card to the camera, so the
  // cards stay out of that pass (see onBeforeRender below).
  material.allowOverride = false;
  const texture = map ?? loadImpostorMap();
  material.uniforms.uMap.value = texture;

  const mesh = new THREE.InstancedMesh(geom, material, Math.max(1, n));
  mesh.name = "far-trees";
  mesh.count = 0;
  mesh.visible = false;
  // The cards are around the camera and change each pick: no culling of the
  // whole mesh.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // In a pass with an override material (the GTAO normal and depth pass),
  // the count is 0 for that draw, so three.js skips it. The layer thus
  // costs 1 draw call on each tier. The AO is near the camera and the ink
  // is faint past the draw distance, so the cards do not need that pass.
  let shown = 0;
  mesh.onBeforeRender = (renderer, scene) => {
    shown = mesh.count;
    if (scene && scene.overrideMaterial) mesh.count = 0;
  };
  mesh.onAfterRender = () => {
    mesh.count = shown;
  };

  const xz = new Float32Array(n * 2);
  cards.forEach((c, i) => {
    xz[i * 2] = c.x;
    xz[i * 2 + 1] = c.z;
  });
  const picked = new Uint32Array(Math.max(1, n));
  const m = new THREE.Matrix4();
  const info = { trees: n, picked: 0, picks: 0, near, far };
  let lastX = Infinity;
  let lastZ = Infinity;

  function pick(cx, cz) {
    const count = selectFarTrees(xz, cx, cz, { near, far, nearBand: range.nearBand, margin: FAR_TREES.step }, picked);
    for (let j = 0; j < count; j += 1) {
      const c = cards[picked[j]];
      m.set(c.halfWidth, 0, 0, c.x, 0, c.height, 0, c.y, 0, 0, 1, c.z, 0, 0, 0, 1);
      mesh.setMatrixAt(j, m);
      cell.array[j] = c.cell + 2 * c.flip;
      leaf.array.set(c.leaf, j * 3);
      bark.array.set(c.bark, j * 3);
    }
    mesh.count = count;
    for (const a of [mesh.instanceMatrix, cell, leaf, bark]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, count * a.itemSize);
      a.needsUpdate = true;
    }
    info.picked = count;
    info.picks += 1;
  }

  return {
    mesh,
    info,
    texture,
    // Picks the far trees again when the camera moved FAR_TREES.step m.
    update(cameraPosition) {
      if (Math.hypot(cameraPosition.x - lastX, cameraPosition.z - lastZ) >= FAR_TREES.step) {
        lastX = cameraPosition.x;
        lastZ = cameraPosition.z;
        pick(lastX, lastZ);
      }
      mesh.visible = mesh.count > 0;
    },
    dispose() {
      geom.dispose();
      material.dispose();
      if (!map) texture.dispose();
    },
  };
}
