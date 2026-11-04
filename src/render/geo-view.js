import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SURFACE_COLORS, boundsDistance, buildGeoMeshes, meshBounds, unionBounds } from "../level/geo/geo-mesh.js";
import { STYLES } from "../level/geo/styles.js";
import { roadMarkings } from "../level/geo/markings.js";
import { storefrontAprons } from "../level/geo/aprons.js";
import { facadeKit, frontEdges } from "../level/geo/facade-kit.js";
import { drapeMesh, terrainOf } from "../level/geo/terrain.js";
import { mergeMeshes } from "../level/geo/extrude.js";
import { treeTemplates, withProceduralTrees } from "../level/geo/trees.js";
import { createMuralAtlas } from "./murals.js";
import { createPropBatch } from "./prop-batch.js";
import { BRICK_TONE, DETAIL_GLSL, DETAIL_NORMAL, ENV_LIGHT, FRAME_ROUGHNESS, GROUND_ALBEDO, LOOKS, ROUGHNESS, WALL_AO, litMaterial } from "./look.js";
import { createLeafDepthMaterial, patchLeafFragment, patchLeafVertex } from "./leaf-cut.js";
import brickInfo from "../../assets/landmarks/textures/brick/set.json";
import stoneInfo from "../../assets/landmarks/textures/trim/set.json";
import asphaltInfo from "../../assets/ground/asphalt/set.json";
import concreteInfo from "../../assets/ground/concrete/set.json";
import trailInfo from "../../assets/ground/trail/set.json";
import grassInfo from "../../assets/ground/grass/set.json";

const KIT_URL = new URL("../../assets/kit/street-kit.glb", import.meta.url).href;
// Props from other sources, in the kit format (one mesh, vertex colors):
// { kind: GLB URL }. See assets/props/<name>/provenance.json.
const EXTRA_PROP_URLS = {
  bench_painted: new URL("../../assets/props/painted_wooden_bench/painted_wooden_bench.glb", import.meta.url).href,
};
// The CC0 brick scan (scripts/landmark-textures.py), shared with the
// landmarks, so the buildings and the landmarks show the same brick.
const BRICK_URL = new URL("../../assets/landmarks/textures/brick/color.jpg", import.meta.url).href;
// The normal and roughness maps of the brick scan and of a CC0 plaster
// scan (beige_wall_001), for the relief of the walls in the pbr look.
const WALL_DETAIL_URLS = {
  brickNor: new URL("../../assets/landmarks/textures/brick/normal.jpg", import.meta.url).href,
  brickRough: new URL("../../assets/landmarks/textures/brick/rough.jpg", import.meta.url).href,
  stoneNor: new URL("../../assets/landmarks/textures/trim/normal.jpg", import.meta.url).href,
  stoneRough: new URL("../../assets/landmarks/textures/trim/rough.jpg", import.meta.url).href,
};
// Prop distances from the camera to each prop (m). Under
// PROP_LOD0_DISTANCE a prop shows its detailed shape, under
// PROP_DRAW_DISTANCE its simple shape, and past that nothing.
export const PROP_LOD0_DISTANCE = 60;
export const PROP_DRAW_DISTANCE = 200;
// The distance from the camera to the nearest edge of a surface tile past
// which the low tier shows the coarse terrain drape (m).
export const FAR_TERRAIN_DISTANCE = 60;
// The facade depth tiles (sills and piers) show when the camera is under
// this distance from the tile center (m). A depth tile is 50 m square, so
// every part under about 85 m shows. Past that a sill is about a pixel.
export const DEPTH_DISTANCE = 120;

// Three.js view of a geodata level: one merged mesh per material per tile,
// with a toon (cel) material and vertex colors. The simulation never sees
// any of this.

// A 3-step ramp gives the cel look. `soft` blends the steps, for round
// props (tree canopies), where hard steps show each face.
function toonRamp({ soft = false } = {}) {
  const data = new Uint8Array([110, 110, 110, 255, 180, 180, 180, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  const filter = soft ? THREE.LinearFilter : THREE.NearestFilter;
  tex.minFilter = filter;
  tex.magFilter = filter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function geoGeometry(mesh) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  if (mesh.colors) geom.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
  if (mesh.facade) geom.setAttribute("facade", new THREE.BufferAttribute(mesh.facade, 4));
  if (mesh.uvs) geom.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
  if (mesh.normals) geom.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  if (mesh.sway) geom.setAttribute("sway", new THREE.BufferAttribute(mesh.sway, 1));
  geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  if (!mesh.normals) geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

// The facade shader: a toon material that draws windows, storefronts, and
// cornices from the facade attribute (see src/level/geo/extrude.js). The
// windows cost no geometry.
//
// On a brick style the wall color gets the detail of the brick scan: the
// scan divided by its mean color, so each building keeps its own wall color
// and gets real brick courses, mortar, and brick-to-brick variation.
//
// With `interiors` (the high tier) each window shows a room behind the glass
// (interior mapping): the view ray goes through a window reveal and hits the
// walls, the floor, or the ceiling of a box room. The room has depth and
// parallax, at no geometry cost.
//
// In the pbr look (src/render/look.js) the glass is smooth, so it reflects
// the sky environment map, and the wall is rough. The base of each wall gets
// a ground-contact darkening (WALL_AO), and the fake sky reflection of the
// interior glass is weaker, because the environment map gives a real one.
// With `detailMaps` (loadWallDetail()) the pbr look also gets the relief of
// the scans: the brick courses and the mortar joints on a brick wall, a
// plaster grain on the other walls and on the stone sills, lintels, and kick
// plates, and the roughness of each. A painted steel frame is semi-gloss.
export function createFacadeMaterial(gradientMap, { brickMap = null, interiors = false, look = "toon", detailMaps = null } = {}) {
  const pbr = look === "pbr";
  const detail = pbr && detailMaps !== null;
  const mat = litMaterial(look, { vertexColors: true }, { gradientMap, roughness: ROUGHNESS.wall, envLight: ENV_LIGHT.wall });
  mat.defines = { ...(interiors ? { INTERIOR: 1 } : {}), ...(pbr ? { PBR_LOOK: 1 } : {}), ...(detail ? { DETAIL: 1 } : {}) };
  const n = STYLES.length;
  // styleA: window width and height (cell fractions), storefront, brick.
  const styleA = STYLES.map((s) => new THREE.Vector4(s.window[0], s.window[1], s.storefront ? 1 : 0, s.brick ? 1 : 0));
  // styleM: meters per bay and per floor, to tile the scan at its real size.
  const styleM = STYLES.map((s) => new THREE.Vector2(s.bay, s.floorHeight));
  // The scan's mean color (linear): its tint makes the mean the spec color.
  const brickMean = new THREE.Color(brickInfo.targetHex);
  const glass = STYLES.map((s) => new THREE.Vector3(...s.glass));
  const trim = STYLES.map((s) => new THREE.Vector3(...s.trim));
  // The window frames: the style frame color (painted steel), or the trim.
  const frameCol = STYLES.map((s) => new THREE.Vector3(...(s.frame ?? s.trim)));
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStyleA = { value: styleA };
    shader.uniforms.uGlass = { value: glass };
    shader.uniforms.uTrim = { value: trim };
    shader.uniforms.uFrame = { value: frameCol };
    shader.uniforms.uStyleM = { value: styleM };
    shader.uniforms.uBrick = { value: brickMap };
    shader.uniforms.uBrickMean = { value: new THREE.Vector3(brickMean.r, brickMean.g, brickMean.b) };
    shader.uniforms.uBrickTile = { value: brickInfo.tileMeters };
    shader.uniforms.uBrickOn = { value: brickMap ? 1 : 0 };
    if (detail) {
      shader.uniforms.uBrickNor = { value: detailMaps.brickNor };
      shader.uniforms.uBrickRough = { value: detailMaps.brickRough };
      shader.uniforms.uStoneNor = { value: detailMaps.stoneNor };
      shader.uniforms.uStoneRough = { value: detailMaps.stoneRough };
    }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 facade;\nvarying vec4 vFacade;\nflat varying vec3 vWallSeed;")
      .replace(
        "#include <begin_vertex>",
        // A seed for each wall face, from the model-space normal and the
        // wall plane. It does not change with the camera, so a room keeps
        // its look when the camera turns. All 4 corners of a wall give the
        // same value, and the flat varying keeps it exact.
        "#include <begin_vertex>\nvFacade = facade;\nvWallSeed = vec3(floor(normal.xz * 8.0 + 0.5), mod(floor(dot(position.xz, normal.xz) + 0.5), 97.0));",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec4 vFacade;
flat varying vec3 vWallSeed;
uniform vec4 uStyleA[${n}];
uniform vec3 uGlass[${n}];
uniform vec3 uTrim[${n}];
uniform vec3 uFrame[${n}];
uniform vec2 uStyleM[${n}];
uniform sampler2D uBrick;
uniform vec3 uBrickMean;
uniform float uBrickTile;
uniform float uBrickOn;
// The glass mask for the roughness (pbr look): 1 on a near window pixel,
// and the glass roughness of that window.
float facadeGlass = 0.0;
float facadeGlassRough = ${ROUGHNESS.glass.toFixed(3)};
float facadeHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
#ifdef DETAIL
uniform sampler2D uBrickNor;
uniform sampler2D uBrickRough;
uniform sampler2D uStoneNor;
uniform sampler2D uStoneRough;
// The wall position in meters, and the weight of each surface on a wall
// pixel: brick, stone or plaster, and the painted frame.
vec2 facadeM = vec2(0.0);
float facadeKBrick = 0.0;
float facadeKStone = 0.0;
float facadeKFrame = 0.0;
#define BRICK_TILE ${brickInfo.tileMeters.toFixed(3)}
#define STONE_TILE ${stoneInfo.tileMeters.toFixed(3)}
${DETAIL_GLSL}
#endif
// The center (cell fraction) of the shop window on the ground floor.
#define SHOP_CY 0.46
#ifdef INTERIOR
float roomHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
// Room colors: warm white, beige, pale blue, sage, peach, and a deep teal.
vec3 roomColor(float h) {
  if (h < 0.22) return vec3(0.95, 0.9, 0.8);
  if (h < 0.4) return vec3(0.86, 0.76, 0.6);
  if (h < 0.56) return vec3(0.66, 0.78, 0.86);
  if (h < 0.72) return vec3(0.7, 0.8, 0.66);
  if (h < 0.9) return vec3(0.96, 0.74, 0.6);
  return vec3(0.22, 0.46, 0.5);
}
#endif`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  int st = int(vFacade.x + 0.5);
  float kind = vFacade.w;
  if (kind > 0.5 && kind < 1.5) {
    vec2 cell = fract(vFacade.yz);
    float level = floor(vFacade.z);
    vec4 a = uStyleA[st];
    bool shop = level < 0.5 && a.z > 0.5;
    // The shop glass ends at 0.13 of the floor: a stone kick plate is under it.
    vec2 win = shop ? vec2(0.84, 0.66) : a.xy;
    vec2 d = abs(cell - vec2(0.5, shop ? SHOP_CY : 0.55)) * 2.0;
    // Anti-aliased edges: blend over one screen pixel, not a hard step.
    vec2 aa = max(fwidth(vFacade.yz) * 2.0, vec2(1e-4));
    float inWin = (1.0 - smoothstep(win.x - aa.x, win.x + aa.x, d.x)) * (1.0 - smoothstep(win.y - aa.y, win.y + aa.y, d.y));
    vec2 fw = win + vec2(0.07, 0.07);
    float inFrame = (1.0 - smoothstep(fw.x - aa.x, fw.x + aa.x, d.x)) * (1.0 - smoothstep(fw.y - aa.y, fw.y + aa.y, d.y));
    float frame = clamp(inFrame - inWin, 0.0, 1.0);
    // A sill under each window, and a center mullion on wide windows.
    float sillY = (shop ? SHOP_CY : 0.55) - win.y * 0.5 - 0.05;
    float sill = (1.0 - smoothstep(fw.x - aa.x, fw.x + aa.x, d.x)) * (1.0 - smoothstep(0.03 - aa.y, 0.03 + aa.y, abs(cell.y - sillY)));
    // A stone lintel over each upper window of a brick style: a band over
    // the frame top, a little wider than the frame.
    float lintelY = 0.55 + win.y * 0.5 + 0.035;
    float lintel = (!shop && a.w > 0.5) ? (1.0 - smoothstep(fw.x + 0.04 - aa.x, fw.x + 0.04 + aa.x, d.x)) * (1.0 - smoothstep(0.03 - aa.y, 0.03 + aa.y, abs(cell.y - lintelY - 0.03))) : 0.0;
    // The kick plate under the shop glass: from the floor to the frame
    // bottom, as wide as the frame.
    float kick = shop ? (1.0 - smoothstep(fw.x - aa.x, fw.x + aa.x, d.x)) * (1.0 - smoothstep(SHOP_CY - fw.y * 0.5 - aa.y, SHOP_CY - fw.y * 0.5 + aa.y, cell.y)) : 0.0;
    float mull = win.x > 0.5 ? (1.0 - smoothstep(0.025 - aa.x, 0.025 + aa.x, abs(cell.x - 0.5))) * inWin : 0.0;
    vec3 glass = uGlass[st] + vec3(0.18 * cell.y) + vec3(0.12) * (1.0 - smoothstep(0.0, 0.25, abs(cell.x - cell.y * 0.6 - 0.2)));
    #ifdef PBR_LOOK
    // Each window pane is a little different: its tint and how sharp its
    // reflection is. A real facade reads as a patchwork, not a grid.
    float paneH = facadeHash(vec3(floor(vFacade.yz), float(st) * 7.0 + vFacade.x));
    glass *= 0.82 + 0.36 * paneH;
    facadeGlassRough = mix(0.03, 0.28, fract(paneH * 7.31));
    #endif
    vec3 wallCol = diffuseColor.rgb;
    // The brick tone of the wall face (look.js brickTone()): one value for
    // each face, so two faces of a building do not have the same tone.
    if (a.w > 0.5) {
      float tk = 2.0 * facadeHash(vWallSeed + float(st)) - 1.0;
      wallCol *= vec3(1.0) + tk * vec3(${(BRICK_TONE.value + BRICK_TONE.warm).toFixed(3)}, ${BRICK_TONE.value.toFixed(3)}, ${(BRICK_TONE.value - BRICK_TONE.warm).toFixed(3)});
    }
    #ifdef INTERIOR
    vec3 roomGlow = vec3(0.0);
    {
      // A view-space frame for the wall: T along the wall (the way u grows),
      // U up, and N out of the wall.
      vec3 N = normalize(vNormal);
      vec3 U = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      vec3 T = normalize(cross(U, N));
      vec3 P = -vViewPosition;
      float su = dot(dFdx(P), T) * dFdx(vFacade.y) + dot(dFdy(P), T) * dFdy(vFacade.y);
      if (su < 0.0) T = -T;
      vec3 rd = normalize(P);
      // The ray in room meters: x along the wall, y up, z into the room.
      vec3 r = vec3(dot(rd, T), dot(rd, U), max(-dot(rd, N), 0.05));
      vec2 m = uStyleM[st];
      float depth = shop ? 6.0 : 4.0;
      float reveal = 0.22;
      vec3 p = vec3(cell.x * m.x, cell.y * m.y, 0.0);
      // The window opening, in meters, and the ray at the glass plane.
      float cy = shop ? SHOP_CY : 0.55;
      vec2 o0 = vec2(0.5 - win.x * 0.5, cy - win.y * 0.5) * m;
      vec2 o1 = vec2(0.5 + win.x * 0.5, cy + win.y * 0.5) * m;
      vec3 q = p + r * (reveal / r.z);
      // The wall color in steps of 1/32: an interpolated vertex color differs
      // a little from pixel to pixel, and the hash made each pixel a
      // different room (a speckle on the glass).
      vec3 rid = vec3(floor(vFacade.yz), float(st) + dot(floor(wallCol * 32.0 + 0.5), vec3(7.0, 13.0, 3.0)) + dot(vWallSeed, vec3(5.0, 9.0, 0.37)));
      float h0 = roomHash(rid);
      float h1 = roomHash(rid + 17.3);
      float h2 = roomHash(rid + 41.9);
      vec3 col;
      if (q.x < o0.x || q.x > o1.x || q.y < o0.y || q.y > o1.y) {
        // The reveal: the wall depth around the glass. The bottom is the sill.
        col = (q.y < o0.y) ? uTrim[st] * 0.95 : wallCol * 0.62;
      } else {
        // Hit the room box: the side walls, the floor or the ceiling, or the back.
        float tx = r.x > 0.0 ? (m.x - p.x) / r.x : -p.x / min(r.x, -1e-4);
        float ty = r.y > 0.0 ? (m.y - p.y) / r.y : -p.y / min(r.y, -1e-4);
        float tz = (reveal + depth) / r.z;
        float t = min(min(tx, ty), tz);
        vec3 h = p + r * t;
        vec3 base = roomColor(h0);
        bool lit = shop || h1 > 0.3;
        if (shop && (t == tz || t == tx) && h.y > 0.3 && h.y < 2.3) {
          // Shop shelves: rows of goods in bright colors, with dark shelf lines.
          float along = t == tz ? h.x : h.z;
          float g = roomHash(vec3(floor(along / 0.45), floor(h.y / 0.5), rid.z));
          col = roomColor(g) * (t == tz ? 0.85 : 0.65);
          if (fract(h.y / 0.5) < 0.14) col = vec3(0.32, 0.27, 0.24);
        } else if (t == tz) {
          col = base * 0.92;
          // Furniture: a low dark band on the back wall in some rooms.
          if (h2 > 0.45 && h.y < m.y * (0.25 + 0.15 * h2)) col = mix(vec3(0.3, 0.24, 0.22), roomColor(h2), 0.35);
        } else if (t == tx) {
          col = base * 0.74;
        } else if (r.y < 0.0) {
          col = vec3(0.46, 0.33, 0.24) * (0.85 + 0.3 * h2);
        } else {
          col = vec3(0.97, 0.96, 0.92);
          // A light panel on the ceiling.
          vec2 lp = abs(vec2(h.x / m.x - 0.5, h.z / (reveal + depth) - 0.55));
          if (lit && lp.x < 0.18 && lp.y < 0.1) col = vec3(1.4, 1.3, 1.1);
        }
        // Far into the room is a little darker.
        col *= mix(1.0, 0.7, clamp(h.z / (reveal + depth), 0.0, 1.0));
        if (!lit) col *= 0.42;
        // Blinds pulled down from the top in some windows.
        float blind = h2 < 0.35 ? h2 * 1.6 : 0.0;
        // The blind slats: 40 for each floor. Where a slat is under about a
        // pixel, use the mean, so far blinds do not shimmer.
        float slatW = aa.y * 20.0; // aa is 2 fwidth, taken outside the branch
        float slat = mix(step(0.5, fract(cell.y * 40.0)), 0.5, smoothstep(0.35, 0.8, slatW));
        if (!shop && cell.y > cy + win.y * 0.5 - win.y * blind) col = mix(uTrim[st], vec3(0.96, 0.93, 0.86), 0.5) * (0.82 + 0.1 * slat);
        roomGlow = lit ? col * (shop ? 0.24 : 0.2) : vec3(0.0);
        // The glass: a tint and a sky reflection that grows at a low angle.
        float fres = 0.1 + 0.55 * pow(1.0 - r.z, 3.0);
        #ifdef PBR_LOOK
        fres *= 0.35;
        #endif
        vec3 sky = mix(vec3(0.75, 0.87, 1.0), uGlass[st] + vec3(0.25), 0.4);
        col = mix(col * mix(vec3(1.0), uGlass[st] * 2.2, 0.25), sky, fres);
        col += vec3(0.08) * (1.0 - smoothstep(0.0, 0.25, abs(cell.x - cell.y * 0.6 - 0.2)));
      }
      glass = col;
    }
    #endif
    // Brick detail: the scan over its mean, kept in a safe range. The far
    // fade below turns it off where a brick is under a pixel.
    float far0 = smoothstep(0.25, 0.6, max(aa.x, aa.y));
    // Sample outside the branch, so the mipmap level stays correct.
    vec3 detail = clamp(texture2D(uBrick, vFacade.yz * uStyleM[st] / uBrickTile).rgb / uBrickMean, 0.35, 2.2);
    if (uBrickOn > 0.5 && a.w > 0.5) wallCol *= mix(detail, vec3(1.0), far0);
    // The frame is painted steel; the sill, the lintel, and the kick plate
    // are cast stone.
    vec3 col = mix(wallCol, uFrame[st], frame * 0.85);
    col = mix(col, uTrim[st], max(sill, lintel) * 0.85);
    col = mix(col, uTrim[st] * 0.85, kick);
    #ifdef PBR_LOOK
    // A floor band at each slab, above the ground floor: a thin line a little
    // darker than the wall, so a tall building shows its floors.
    float slab = level > 0.5 ? 1.0 - smoothstep(0.035, 0.035 + aa.y, cell.y) : 0.0;
    col *= 1.0 - 0.22 * slab;
    #endif
    col = mix(col, glass, inWin);
    col = mix(col, uFrame[st], mull * 0.9);
    // Far away a window cell is under a few pixels: fade to the mean color,
    // so the grid does not shimmer.
    float far = far0;
    // The trim area is in the mean, so the near and the far colors match.
    vec3 mean = mix(mix(wallCol, uTrim[st], 0.08), uGlass[st] + vec3(0.09), win.x * win.y * 0.9);
    diffuseColor.rgb = mix(col, mean, far);
    facadeGlass = inWin * (1.0 - far);
    #ifdef DETAIL
    {
      float stonePart = clamp(max(max(sill, lintel), kick), 0.0, 1.0);
      float wallPart = (1.0 - inFrame) * (1.0 - stonePart);
      float near = 1.0 - far;
      facadeM = vFacade.yz * uStyleM[st];
      facadeKBrick = a.w > 0.5 ? wallPart * near : 0.0;
      facadeKStone = (a.w > 0.5 ? stonePart : wallPart + stonePart) * near;
      facadeKFrame = clamp(frame + mull, 0.0, 1.0) * near;
    }
    #endif
    #ifdef PBR_LOOK
    // Ground contact: darker at the base of the wall (look.js wallOcclusion).
    diffuseColor.rgb *= ${WALL_AO.base.toFixed(3)} + ${(1 - WALL_AO.base).toFixed(3)} * smoothstep(0.0, ${WALL_AO.floors.toFixed(3)}, vFacade.z);
    #endif
    #ifdef INTERIOR
    totalEmissiveRadiance += roomGlow * inWin * (1.0 - far);
    #endif
  }
}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
#ifdef DETAIL
{
  // Sample at the top level, so the mipmap level is correct.
  float rb = texture2D(uBrickRough, facadeM / BRICK_TILE).r;
  float rs = texture2D(uStoneRough, facadeM / STONE_TILE).r;
  roughnessFactor = mix(roughnessFactor, rb, facadeKBrick);
  roughnessFactor = mix(roughnessFactor, rs, facadeKStone);
  roughnessFactor = mix(roughnessFactor, ${FRAME_ROUGHNESS.toFixed(3)}, facadeKFrame);
}
#endif
roughnessFactor = mix(roughnessFactor, facadeGlassRough, facadeGlass);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
#ifdef DETAIL
{
  // The wall frame in view space: tu along the wall (the way the wall meters
  // grow), tv up.
  vec3 P = -vViewPosition;
  vec3 tv = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 tu = cross(tv, normal);
  float su = dot(dFdx(P), tu) * dFdx(facadeM.x) + dot(dFdy(P), tu) * dFdy(facadeM.x);
  tu = su < 0.0 ? -tu : tu;
  vec3 nb = texture2D(uBrickNor, facadeM / BRICK_TILE).rgb - vec3(0.5, 0.5, 1.0);
  vec3 ns = texture2D(uStoneNor, facadeM / STONE_TILE).rgb - vec3(0.5, 0.5, 1.0);
  nb.xy *= ${DETAIL_NORMAL.brick.toFixed(3)};
  ns.xy *= ${DETAIL_NORMAL.stone.toFixed(3)};
  vec3 s = vec3(0.5, 0.5, 1.0) + nb * facadeKBrick + ns * facadeKStone;
  if (facadeKBrick + facadeKStone > 0.0) normal = detailNormal(normal, tu, tv, s, 1.0);
}
#endif`,
      );
  };
  mat.customProgramCacheKey = () => `facade-v8${brickMap ? "-brick" : ""}${interiors ? "-interior" : ""}${pbr ? "-pbr" : ""}${detail ? "-detail" : ""}`;
  return mat;
}

// The ground scans (scripts/ground-textures.py, CC0). One static URL per
// file, so Vite bundles each map.
// The normal and roughness maps are for the pbr look only.
const GROUND = [
  {
    info: asphaltInfo,
    url: new URL("../../assets/ground/asphalt/color.jpg", import.meta.url).href,
    nor: new URL("../../assets/ground/asphalt/normal.jpg", import.meta.url).href,
    rough: new URL("../../assets/ground/asphalt/rough.jpg", import.meta.url).href,
  },
  {
    info: concreteInfo,
    url: new URL("../../assets/ground/concrete/color.jpg", import.meta.url).href,
    nor: new URL("../../assets/ground/concrete/normal.jpg", import.meta.url).href,
    rough: new URL("../../assets/ground/concrete/rough.jpg", import.meta.url).href,
  },
  {
    info: trailInfo,
    url: new URL("../../assets/ground/trail/color.jpg", import.meta.url).href,
    nor: new URL("../../assets/ground/trail/normal.jpg", import.meta.url).href,
    rough: new URL("../../assets/ground/trail/rough.jpg", import.meta.url).href,
  },
  {
    info: grassInfo,
    url: new URL("../../assets/ground/grass/color.jpg", import.meta.url).href,
    nor: new URL("../../assets/ground/grass/normal.jpg", import.meta.url).href,
    rough: new URL("../../assets/ground/grass/rough.jpg", import.meta.url).href,
  },
];
// The lowest ground roughness from a map. A smoother ground reflects the
// bright sky at a low angle and gives a white haze (look.js ENV_LIGHT).
const GROUND_MIN_ROUGHNESS = 0.75;
// Surface kind -> ground set (index in GROUND) and detail strength.
const GROUND_OF = {
  ground: [3, 0.6],
  park: [3, 0.65],
  street: [0, 0.8],
  path: [1, 0.8],
  sidewalk: [1, 0.8],
  trail: [2, 0.7],
};

// The surface shader: a toon material whose art color (the vertex color of
// each surface kind) gets the detail of a real scan, sampled in world
// meters. The detail is the scan over its mean color, so the palette stays.
// A second, rotated, larger sample breaks the tile repeat. The detail fades
// out with distance, where a tile is under a few pixels.
//
// With `detailMaps` (loadGroundDetail(), the pbr look) the ground also gets
// the relief and the roughness of each scan: the asphalt grain, the slab
// joints, and the grass blades catch the sun.
export function createSurfaceMaterial(gradientMap, { maps = null, look = "toon", detailMaps = null } = {}) {
  const mat = litMaterial(look, { vertexColors: true }, { gradientMap, roughness: ROUGHNESS.ground, envLight: ENV_LIGHT.ground });
  if (!maps) return mat;
  const detail = look === "pbr" && detailMaps !== null;
  if (detail) mat.defines = { DETAIL: 1 };
  const kinds = Object.keys(GROUND_OF);
  const kindColor = kinds.map((k) => new THREE.Vector3(...SURFACE_COLORS[k]));
  const kindSet = kinds.map((k) => GROUND_OF[k][0]);
  const kindStrength = kinds.map((k) => GROUND_OF[k][1]);
  mat.onBeforeCompile = (shader) => {
    GROUND.forEach((g, i) => {
      shader.uniforms[`uGround${i}`] = { value: maps[i] };
      shader.uniforms[`uGroundMean${i}`] = { value: new THREE.Vector3(...g.info.meanLinear) };
      shader.uniforms[`uGroundTile${i}`] = { value: g.info.tileMeters };
    });
    shader.uniforms.uKindColor = { value: kindColor };
    shader.uniforms.uKindSet = { value: kindSet };
    shader.uniforms.uKindStrength = { value: kindStrength };
    if (detail) {
      GROUND.forEach((_, i) => {
        shader.uniforms[`uGroundNor${i}`] = { value: detailMaps.nor[i] };
        shader.uniforms[`uGroundRough${i}`] = { value: detailMaps.rough[i] };
      });
    }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGroundXZ;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    const decl = GROUND.map((_, i) => `uniform sampler2D uGround${i};\nuniform vec3 uGroundMean${i};\nuniform float uGroundTile${i};`).join("\n");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec2 vGroundXZ;
${decl}
uniform vec3 uKindColor[${kinds.length}];
uniform float uKindSet[${kinds.length}];
uniform float uKindStrength[${kinds.length}];
#ifdef DETAIL
${GROUND.map((_, i) => `uniform sampler2D uGroundNor${i};\nuniform sampler2D uGroundRough${i};`).join("\n")}
// The ground set of this pixel and the weight of its detail.
float groundSet = -1.0;
float groundK = 0.0;
${DETAIL_GLSL}
#endif
vec3 groundDetail(sampler2D t, vec3 mean, float tile, vec2 xz) {
  vec3 a = texture2D(t, xz / tile).rgb / mean;
  vec2 r = mat2(0.8, -0.6, 0.6, 0.8) * xz;
  vec3 b = texture2D(t, r / (tile * 4.7)).rgb / mean;
  return clamp(a * mix(vec3(1.0), b, 0.45), 0.3, 2.5);
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  // The surface kind from its art color (each kind has its own color).
  float set = -1.0;
  float strength = 0.0;
  for (int i = 0; i < ${kinds.length}; i++) {
    if (distance(vColor.rgb, uKindColor[i]) < 0.01) { set = uKindSet[i]; strength = uKindStrength[i]; }
  }
  // Sample every set outside the branches, so the mipmap level is correct.
  vec3 d0 = groundDetail(uGround0, uGroundMean0, uGroundTile0, vGroundXZ);
  vec3 d1 = groundDetail(uGround1, uGroundMean1, uGroundTile1, vGroundXZ);
  vec3 d2 = groundDetail(uGround2, uGroundMean2, uGroundTile2, vGroundXZ);
  vec3 d3 = groundDetail(uGround3, uGroundMean3, uGroundTile3, vGroundXZ);
  vec3 det = set < -0.5 ? vec3(1.0) : set < 0.5 ? d0 : set < 1.5 ? d1 : set < 2.5 ? d2 : d3;
  float fade = 1.0 - smoothstep(90.0, 280.0, length(vViewPosition));
  // The scans are sampled in world x and z, so a vertical face (a curb side)
  // gets streaks. Only a face that points up gets the detail.
  fade *= smoothstep(0.5, 0.85, dot(normalize(vNormal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)));
  diffuseColor.rgb *= mix(vec3(1.0), det, strength * fade);
  #ifdef DETAIL
  groundSet = set;
  groundK = strength * fade;
  diffuseColor.rgb *= set < -0.5 ? 1.0 : set < 0.5 ? ${GROUND_ALBEDO[0].toFixed(3)} : set < 1.5 ? ${GROUND_ALBEDO[1].toFixed(3)} : set < 2.5 ? ${GROUND_ALBEDO[2].toFixed(3)} : ${GROUND_ALBEDO[3].toFixed(3)};
  #endif
}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
#ifdef DETAIL
{
  // Sample every set at the top level, so the mipmap level is correct.
${GROUND.map((_, i) => `  float r${i} = texture2D(uGroundRough${i}, vGroundXZ / uGroundTile${i}).r;`).join("\n")}
  float rg = groundSet < -0.5 ? roughnessFactor : groundSet < 0.5 ? r0 : groundSet < 1.5 ? r1 : groundSet < 2.5 ? r2 : r3;
  roughnessFactor = mix(roughnessFactor, max(rg, ${GROUND_MIN_ROUGHNESS.toFixed(3)}), groundK);
}
#endif`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
#ifdef DETAIL
{
${GROUND.map((_, i) => `  vec3 n${i} = texture2D(uGroundNor${i}, vGroundXZ / uGroundTile${i}).rgb;`).join("\n")}
  vec3 sn = groundSet < -0.5 ? vec3(0.5, 0.5, 1.0) : groundSet < 0.5 ? n0 : groundSet < 1.5 ? n1 : groundSet < 2.5 ? n2 : n3;
  float kn = groundSet < 0.5 ? ${DETAIL_NORMAL.ground[0].toFixed(3)} : groundSet < 1.5 ? ${DETAIL_NORMAL.ground[1].toFixed(3)} : groundSet < 2.5 ? ${DETAIL_NORMAL.ground[2].toFixed(3)} : ${DETAIL_NORMAL.ground[3].toFixed(3)};
  vec3 d = (sn - vec3(0.5, 0.5, 1.0)) * groundK;
  d.xy *= kn;
  // The map u grows along world x and v along world z (vGroundXZ).
  vec3 tu = (viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
  vec3 tv = (viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
  if (groundK > 0.0) normal = detailNormal(normal, tu, tv, vec3(0.5, 0.5, 1.0) + d, 1.0);
}
#endif`,
      );
  };
  mat.customProgramCacheKey = () => `surface-v2-ground-${look}${detail ? "-detail" : ""}`;
  return mat;
}

function loadGroundMaps() {
  return GROUND.map((g) => {
    const t = new THREE.TextureLoader().load(g.url);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  });
}

// The ground normal and roughness maps of the pbr look, in the order of
// GROUND. The maps hold data, so they stay in linear space.
function loadGroundDetail() {
  const load = (url) => {
    const t = new THREE.TextureLoader().load(url);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { nor: GROUND.map((g) => load(g.nor)), rough: GROUND.map((g) => load(g.rough)) };
}

// The brick scan for the facade shader. It tiles by the shader's own meter
// coordinates, so it needs only repeat wrap and mipmaps.
function loadBrickMap() {
  const t = new THREE.TextureLoader().load(BRICK_URL);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// The wall detail maps of the pbr look (createFacadeMaterial()). The maps
// hold data, not colors, so they stay in linear space.
function loadWallDetail() {
  const maps = {};
  for (const [name, url] of Object.entries(WALL_DETAIL_URLS)) {
    const t = new THREE.TextureLoader().load(url);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    maps[name] = t;
  }
  return maps;
}

function addMesh(root, byId, name, geometry, material, { castShadow = false } = {}) {
  const obj = new THREE.Mesh(geometry, material);
  obj.name = name;
  obj.castShadow = castShadow;
  obj.receiveShadow = true;
  obj.matrixAutoUpdate = false;
  root.add(obj);
  byId.set(name, obj);
  return obj;
}

// The kit prop that stands in for an extra prop that did not load, so that
// its solid obstacle (src/level/geo/props.js) is never invisible.
export const EXTRA_PROP_FALLBACK = { bench_painted: "bench" };

// Pure: adds the extra templates to the kit templates. `results` has one
// { status, value | reason } (Promise.allSettled) for each kind. An extra GLB
// must have exactly one mesh. A kind that failed gets its fallback kit
// template. Returns the list of problems as text.
export function addExtraTemplates(kit, kinds, results, fallback = EXTRA_PROP_FALLBACK) {
  const problems = [];
  kinds.forEach((kind, i) => {
    const r = results[i];
    const found = r.status === "fulfilled" ? Object.values(r.value) : [];
    if (found.length === 1) {
      kit[kind] = found[0];
      return;
    }
    problems.push(r.status === "fulfilled" ? `${kind}: ${found.length} meshes, expected 1` : `${kind}: ${r.reason}`);
    if (kit[fallback[kind]]) kit[kind] = kit[fallback[kind]];
  });
  return problems;
}

// The time limit for one extra prop GLB (ms). A request that takes longer
// counts as a failure, so it cannot stop the kit props.
export const EXTRA_PROP_TIMEOUT_MS = 15000;

// Rejects when `promise` does not settle in `ms` milliseconds.
export function withTimeout(promise, ms, label = "request") {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: no answer in ${ms} ms`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// The kit templates and the extra props. A failed or slow extra GLB does
// not stop the kit: the kind gets its fallback kit template.
export async function loadPropTemplates() {
  const kinds = Object.keys(EXTRA_PROP_URLS);
  const extras = kinds.map((k) => withTimeout(loadKitTemplates(EXTRA_PROP_URLS[k]), EXTRA_PROP_TIMEOUT_MS, k));
  const [kit, results] = await Promise.all([loadKitTemplates(), Promise.allSettled(extras)]);
  for (const problem of addExtraTemplates(kit, kinds, results)) console.warn(`extra prop: ${problem}`);
  return kit;
}

// Reads the kit GLB into plain templates: { kind: { positions, indices, colors } }.
export async function loadKitTemplates(url = KIT_URL) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const templates = {};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const pos = g.attributes.position;
    const col = g.attributes.color;
    const nor = g.attributes.normal;
    const normals = nor ? new Float32Array(pos.count * 3) : null;
    const positions = new Float32Array(pos.count * 3);
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) {
      positions[i * 3] = pos.getX(i);
      positions[i * 3 + 1] = pos.getY(i);
      positions[i * 3 + 2] = pos.getZ(i);
      colors[i * 3] = col ? col.getX(i) : 1;
      colors[i * 3 + 1] = col ? col.getY(i) : 1;
      colors[i * 3 + 2] = col ? col.getZ(i) : 1;
      if (normals) {
        normals[i * 3] = nor.getX(i);
        normals[i * 3 + 1] = nor.getY(i);
        normals[i * 3 + 2] = nor.getZ(i);
      }
    }
    const indices = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
    templates[o.name] = normals ? { positions, indices, colors, normals } : { positions, indices, colors };
  });
  return templates;
}

// The prop material: the soft toon ramp (or pbr), wind on the tree crowns,
// and, with `leaves`, the leaf cut on the tree cards. The vertex shader
// moves each vertex by its sway weight (0 for trunks and kit props), with a
// phase from the world position, so near trees do not move as one. The
// shadow map does not get the wind; the move is under 0.3 m. In the prop
// batch (src/render/prop-batch.js) the position is in the template space:
// the batching matrix gives the world position, and its inverse turns the
// world wind move into the template space.
function createPropMaterial({ wind = true, look = "toon", leaves = false } = {}) {
  const material = litMaterial(look, { vertexColors: true }, { gradientMap: toonRamp({ soft: true }), roughness: ROUGHNESS.props, envLight: ENV_LIGHT.props });
  // A card is a single quad: both sides must draw.
  if (leaves) material.side = THREE.DoubleSide;
  const time = { value: 0 };
  if (wind || leaves) {
    material.onBeforeCompile = (shader) => {
      if (leaves) {
        patchLeafVertex(shader);
        patchLeafFragment(shader);
      }
      if (!wind) return;
      shader.uniforms.uWindTime = time;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float sway;\nuniform float uWindTime;")
        .replace(
          "#include <begin_vertex>",
          [
            "#include <begin_vertex>",
            "#ifdef USE_BATCHING",
            "vec3 windWorld = (batchingMatrix * vec4(position, 1.0)).xyz;",
            "#else",
            "vec3 windWorld = position;",
            "#endif",
            "float windPhase = uWindTime * 1.3 + windWorld.x * 0.17 + windWorld.z * 0.13;",
            "vec3 windMove = sway * vec3(0.2 * sin(windPhase) + 0.05 * sin(windPhase * 2.7), 0.0, 0.12 * cos(windPhase * 0.8));",
            "#ifdef USE_BATCHING",
            // A yaw and a uniform scale: the inverse is the transpose over the scale squared.
            "mat3 windBasis = mat3(batchingMatrix);",
            "transformed += transpose(windBasis) * windMove / dot(windBasis[0], windBasis[0]);",
            "#else",
            "transformed += windMove;",
            "#endif",
          ].join("\n"),
        );
    };
    material.customProgramCacheKey = () => `geo-props${wind ? "-wind" : ""}${leaves ? "-leaves" : ""}-${look}`;
  }
  return { material, time };
}

// `groundDetail: false` keeps the flat art colors on the ground.
// `trees: false` keeps the two street kit trees (for an A/B check).
// `aprons: false` leaves out the concrete aprons of the shops (aprons.js).
export function createGeoView(level, meshes = buildGeoMeshes(level), { lod0Distance = PROP_LOD0_DISTANCE, drawDistance = PROP_DRAW_DISTANCE, groundDetail = true, markings = true, aprons = true, kit = true, depth = true, depthDistance = DEPTH_DISTANCE, interiors = false, farTerrain = false, trees = true, wind = true, look = "toon" } = {}) {
  const root = new THREE.Group();
  root.name = level.name;
  const gradientMap = toonRamp();
  let muralMap = null;
  const materials = {
    surface: createSurfaceMaterial(gradientMap, { maps: groundDetail ? loadGroundMaps() : null, look, detailMaps: groundDetail && look === "pbr" ? loadGroundDetail() : null }),
    building: createFacadeMaterial(gradientMap, { brickMap: loadBrickMap(), interiors, look, detailMaps: look === "pbr" ? loadWallDetail() : null }),
    props: null,
    get mural() {
      if (!muralMap) muralMap = litMaterial(look, { map: createMuralAtlas() }, { gradientMap, roughness: ROUGHNESS.mural, envLight: ENV_LIGHT.mural });
      return muralMap;
    },
  };
  // The leaf cards on the trees come with the pbr look (look.js).
  const leaves = trees && look === "pbr";
  const propMaterial = createPropMaterial({ wind, look, leaves });
  materials.props = propMaterial.material;
  const byId = new Map();
  // Road markings join the render copy of their surface tile (no extra
  // draw call). The shared meshes, which the physics reads, stay as they are.
  // The markings follow the terrain like the streets (terrain.js).
  const terrain = terrainOf(level);
  // The concrete aprons around the storefront buildings (aprons.js) join
  // the surface tiles in the same way. The kit and the aprons share the
  // front walls.
  const fronts = kit || aprons ? frontEdges(level) : null;
  const groundExtras = new Map();
  for (const t of [...(markings ? roadMarkings(level) : []), ...(aprons ? storefrontAprons(level, fronts) : [])]) {
    const list = groundExtras.get(t.tile) ?? [];
    list.push(drapeMesh(t.mesh, terrain));
    groundExtras.set(t.tile, list);
  }
  const markingTiles = new Map([...groundExtras].map(([tile, list]) => [tile, list.length > 1 ? mergeMeshes(list) : list[0]]));
  // The facade kit (cornices, copings, belt courses, house roofs) joins the
  // render copy of its building tile in the same way.
  const kitParts = kit ? facadeKit(level, fronts) : { tiles: [], depthTiles: [], counts: {} };
  const kitTiles = new Map(kitParts.tiles.map((t) => [t.tile, t.mesh]));
  for (const { material, tile, mesh } of meshes) {
    const extra = material === "surface" ? markingTiles.get(tile) : material === "building" ? kitTiles.get(tile) : null;
    if (extra && material === "surface") markingTiles.delete(tile);
    if (extra && material === "building") kitTiles.delete(tile);
    addMesh(root, byId, `${material}-${tile}`, geoGeometry(extra ? mergeMeshes([mesh, extra]) : mesh), materials[material], { castShadow: material === "building" });
  }
  for (const [tile, mesh] of markingTiles) addMesh(root, byId, `markings-${tile}`, geoGeometry(mesh), materials.surface);

  // A far level of detail for the surfaces (the low tier): a surface tile
  // past FAR_TERRAIN_DISTANCE shows a drape on a 16 m terrain, with about a
  // quarter of the triangles. The physics keeps the exact tiles.
  // The distance uses the bounds of the meshes, not the tile square: a strip
  // joins the tile of its first point and can run far out of it. The coarse
  // drape sits above the exact ground, so it must never show near the camera.
  const terrainLods = [];
  if (farTerrain && !terrain.flat) {
    for (const { tile, mesh } of buildGeoMeshes(level, { terrainStep: 2, surfacesOnly: true })) {
      const near = byId.get(`surface-${tile}`);
      if (!near) continue;
      const far = addMesh(root, byId, `surface-far-${tile}`, geoGeometry(mesh), materials.surface);
      far.visible = false;
      const bounds = unionBounds(meshBounds({ positions: near.geometry.attributes.position.array }), meshBounds(mesh));
      terrainLods.push({ near, far, bounds });
    }
  }
  const terrainLod = { tiles: terrainLods.length, far: 0, nearestFar: Infinity };
  for (const [tile, mesh] of kitTiles) addMesh(root, byId, `kit-${tile}`, geoGeometry(mesh), materials.building, { castShadow: true });
  // The sills and the piers: one mesh per depth tile, hidden far away in
  // update().
  const depthTiles = [];
  for (const t of depth ? kitParts.depthTiles : []) {
    const obj = addMesh(root, byId, `depth-${t.tile}`, geoGeometry(t.mesh), materials.building);
    obj.userData.center = t.center;
    obj.userData.triangles = t.mesh.indices.length / 3;
    obj.visible = false;
    depthTiles.push(obj);
  }
  const facadeDepth = { tiles: depthTiles.length, near: 0, nearTriangles: 0 };

  // Kit props load after the level shows. All props are one batch (one
  // draw call); update() picks the LOD of each prop.
  let propBatch = null;
  const props = { count: 0, instances: 0, kinds: 0, drawn: 0, lod0: 0, loaded: false, error: null };
  function addProps(placements, templates) {
    // The procedural trees take the place of the two kit trees.
    const all = trees ? { ...templates, ...treeTemplates({ cards: leaves }) } : templates;
    const placed = trees ? withProceduralTrees(placements) : placements;
    propBatch = createPropBatch(placed, all, materials.props, { lod0Distance, drawDistance });
    if (leaves) propBatch.mesh.customDepthMaterial = createLeafDepthMaterial();
    root.add(propBatch.mesh);
    byId.set("props", propBatch.mesh);
    props.count = placements.length;
    props.instances = propBatch.info.instances;
    props.kinds = propBatch.info.kinds;
    props.loaded = true;
  }

  return {
    root,
    byId,
    get meshCount() {
      return meshes.length + (propBatch ? 1 : 0);
    },
    props,
    kit: kitParts.counts,
    // The far terrain: the tile count, the far tiles now, and the distance
    // from the camera to the nearest far tile (Infinity with none).
    terrainLod,
    facadeDepth,
    addProps,
    // Shows each prop at one level of detail by its distance from the
    // camera, and hides the far props and depth tiles.
    update(cameraPosition, seconds = performance.now() / 1000) {
      propMaterial.time.value = seconds;
      let farTiles = 0;
      let nearestFar = Infinity;
      for (const t of terrainLods) {
        const d = boundsDistance(t.bounds, cameraPosition.x, cameraPosition.z);
        const far = d > FAR_TERRAIN_DISTANCE;
        t.near.visible = !far;
        t.far.visible = far;
        if (far) {
          farTiles += 1;
          nearestFar = Math.min(nearestFar, d);
        }
      }
      terrainLod.far = farTiles;
      terrainLod.nearestFar = nearestFar;
      let near = 0;
      let nearTriangles = 0;
      for (const obj of depthTiles) {
        const [cx, cz] = obj.userData.center;
        obj.visible = Math.hypot(cx - cameraPosition.x, cz - cameraPosition.z) < depthDistance;
        if (obj.visible) {
          near += 1;
          nearTriangles += obj.userData.triangles;
        }
      }
      facadeDepth.near = near;
      facadeDepth.nearTriangles = nearTriangles;
      if (propBatch) {
        propBatch.update(cameraPosition);
        props.drawn = propBatch.info.drawn;
        props.lod0 = propBatch.info.lod0;
      }
    },
  };
}

// Daylight for a big level. The shadow box follows the skater, because one
// shadow map cannot cover 2 km at a useful resolution. The shell turns the
// shadow map off on a geodata level for speed; the light keeps the setup
// for a faster machine.
export function createGeoLights({ shadowRadius = 45, shadowMapSize = 2048, look = "toon" } = {}) {
  const group = new THREE.Group();
  const L = LOOKS[look];
  group.add(new THREE.HemisphereLight(L.hemisphereSky, L.hemisphereGround, L.hemisphere));
  const sun = new THREE.DirectionalLight(L.sunColor, L.sun);
  // The offset keeps about the old distance (62 m), so the shadow camera
  // (near 1, far 200) still holds the shadow box.
  const offset = new THREE.Vector3(...L.sunOffset).setLength(62);
  sun.position.copy(offset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  const r = shadowRadius;
  sun.shadow.camera.left = -r;
  sun.shadow.camera.right = r;
  sun.shadow.camera.top = r;
  sun.shadow.camera.bottom = -r;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  group.add(sun);
  group.add(sun.target);
  return {
    group,
    sun,
    sunDirection: offset.clone().normalize(),
    // Snap to whole meters, so the shadow edges do not shimmer.
    follow(x, z, y = 0) {
      const sx = Math.round(x);
      const sz = Math.round(z);
      const sy = Math.round(y);
      sun.target.position.set(sx, sy, sz);
      sun.position.set(sx + offset.x, sy + offset.y, sz + offset.z);
    },
  };
}
