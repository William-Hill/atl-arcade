import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SURFACE_COLORS, boundsDistance, buildGeoMeshes, meshBounds, unionBounds } from "../level/geo/geo-mesh.js";
import { STYLES } from "../level/geo/styles.js";
import { roadMarkings } from "../level/geo/markings.js";
import { storefrontAprons } from "../level/geo/aprons.js";
import { facadeKit, frontEdges } from "../level/geo/facade-kit.js";
import { boardNamesBatch, shopNamesMesh } from "./shop-names.js";
import { shopSigns } from "../level/geo/shop-signs.js";
import { createShopSigns } from "./shop-signs-view.js";
import { drapeMesh, terrainOf } from "../level/geo/terrain.js";
import { mergeMeshes } from "../level/geo/extrude.js";
import { seasonColors, treeTemplates, withProceduralTrees } from "../level/geo/trees.js";
import { createMuralAtlas, createMuralMaterial } from "./murals.js";
import { ALBEDO, ALBEDO_GLSL, CONCRETE, FACADE_CALIBRATION, FACADE_FADE, PLASTER_SCAN, WALL_GRAIN, windowColorGlsl, windowMean } from "./pbr-palette.js";
import { createPropBatch } from "./prop-batch.js";
import { BRICK_TONE, DETAIL_GLSL, DETAIL_NORMAL, ENV_LIGHT, FRAME_ROUGHNESS, LOOKS, ROUGHNESS, WALL_AO, litMaterial } from "./look.js";
import { TREE_UNIFORMS, createLeafDepthMaterial, markCrownCores, patchLeafFragment, patchLeafVertex } from "./leaf-cut.js";
import { bakeTreeImpostors } from "./tree-impostors.js";
import { getDracoLoader } from "./skater-model.js";
import { facadeKitPlacements } from "../level/geo/facade-kit-glb.js";
import { createFacadeKitView } from "./facade-kit-view.js";
import { createPbrSurfaceMaterial } from "./pbr-ground.js";
import { LAMP_GLOBE } from "./ground-light.js";
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
// The band (m) under PROP_LOD0_DISTANCE where a GLB tree dithers into its
// impostor (leaf-cut.js, prop-batch.js).
export const TREE_FADE_BAND = 8;
export const PROP_DRAW_DISTANCE = 200;
// The distance from the camera to the nearest edge of a surface tile past
// which the low tier shows the coarse terrain drape (m). The high tier sets
// its own (src/render/quality.js).
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

// The window reveal shadow (createFacadeMaterial()): the width in meters of
// the shadow band under the window head and along each jamb, and how much
// each band darkens the glass.
export const REVEAL = { head: 0.16, jamb: 0.07, headShade: 0.5, jambShade: 0.28 };

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
// A wall that is not brick also gets the plaster grain in its albedo
// (pbr-palette.js WALL_GRAIN), so a mural host wall is not a flat color
// (#198).
//
// A FACE.concrete face (the structure of a bridge, geo-mesh.js) gets the
// concrete class in the pbr look (pbr-palette.js CONCRETE, #199): the warm
// gray albedo inside the class band, with the plaster scan for the grain,
// the relief, and the roughness. The scan tiles in world meters on the
// plane of the face. The toon look draws it as a cornice.
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
    // The window light factor (src/render/weather-view.js): 0 in the day,
    // up to 1 at night, more under a dark sky. The material keeps the
    // uniform so the weather can write it after the shader compiles.
    shader.uniforms.uLit = { value: 0 };
    mat.userData.uLit = shader.uniforms.uLit;
    // The sun direction in world space (+x east, +y up, +z south) and its
    // elevation factor in w (weather-view writes it): the lintels, the
    // sills, and the floor slabs shade the wall face under it.
    shader.uniforms.uSun = { value: new THREE.Vector4(0, 1, 0, 0) };
    mat.userData.uSun = shader.uniforms.uSun;
    if (detail) {
      shader.uniforms.uBrickNor = { value: detailMaps.brickNor };
      shader.uniforms.uBrickRough = { value: detailMaps.brickRough };
      shader.uniforms.uStoneNor = { value: detailMaps.stoneNor };
      shader.uniforms.uStoneRough = { value: detailMaps.stoneRough };
    }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 facade;\nvarying vec4 vFacade;\nflat varying vec3 vWallSeed;\n#ifdef DETAIL\nvarying vec3 vFacadeW;\n#endif")
      .replace(
        "#include <begin_vertex>",
        // A seed for each wall face, from the model-space normal and the
        // wall plane. It does not change with the camera, so a room keeps
        // its look when the camera turns. All 4 corners of a wall give the
        // same value, and the flat varying keeps it exact.
        "#include <begin_vertex>\nvFacade = facade;\nvWallSeed = vec3(floor(normal.xz * 8.0 + 0.5), mod(floor(dot(position.xz, normal.xz) + 0.5), 97.0));\n#ifdef DETAIL\nvFacadeW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif",
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
uniform float uLit;
uniform vec4 uSun;
// The glass mask for the roughness (pbr look): 1 on a near window pixel,
// and the glass roughness of that window.
float facadeGlass = 0.0;
float facadeGlassRough = ${ROUGHNESS.glass.toFixed(3)};
// The fine-detail fade by screen size (pbr look, #160): 0 near, 1 where a
// window cell is under FACADE_FADE.fine pixels.
float facadeFine = 0.0;
${ALBEDO_GLSL}
${windowColorGlsl()}
float facadeHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float roomHash(vec3 p) { return facadeHash(p); }
#ifdef DETAIL
uniform sampler2D uBrickNor;
uniform sampler2D uBrickRough;
uniform sampler2D uStoneNor;
uniform sampler2D uStoneRough;
varying vec3 vFacadeW;
// The wall position in meters, and the weight of each surface on a wall
// pixel: brick, stone or plaster, and the painted frame.
vec2 facadeM = vec2(0.0);
float facadeKBrick = 0.0;
float facadeKStone = 0.0;
float facadeKFrame = 0.0;
// 1 on a concrete face (FACE.concrete), for the concrete roughness.
float facadeConcrete = 0.0;
// The plaster scan grain (-1..1) of a scan sample.
float plasterGrain(float s) { return clamp((s - ${PLASTER_SCAN.mean.toFixed(4)}) / ${PLASTER_SCAN.spread.toFixed(4)}, -1.0, 1.0); }
#define BRICK_TILE ${brickInfo.tileMeters.toFixed(3)}
#define STONE_TILE ${stoneInfo.tileMeters.toFixed(3)}
// The grain at a wall point m (meters): the fine scan grain, and the same
// scan ${PLASTER_SCAN.coarse} times larger for patches that still read at
// street distance (the fine grain averages out in the mipmaps).
float plasterMottle(vec2 m) {
  float fine = plasterGrain(texture2D(uStoneRough, m / STONE_TILE).r);
  float coarse = plasterGrain(texture2D(uStoneRough, m / (STONE_TILE * ${PLASTER_SCAN.coarse.toFixed(1)}) + vec2(0.37, 0.61)).r);
  return clamp(0.4 * fine + 0.8 * coarse, -1.0, 1.0);
}
${DETAIL_GLSL}
#endif
// The center (cell fraction) of the shop window on the ground floor.
#define SHOP_CY 0.46
#ifdef INTERIOR
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
  // kind 1 is a wall, kind 3 a blank wall (a mural wall): no windows.
  // kind 4 (concrete) is after this block.
  if ((kind > 0.5 && kind < 1.5) || (kind > 2.5 && kind < 3.5)) {
    bool blank = kind > 2.5;
    vec2 cell = fract(vFacade.yz);
    float level = floor(vFacade.z);
    vec4 a = uStyleA[st];
    bool shop = !blank && level < 0.5 && a.z > 0.5;
    // The shop glass ends at 0.13 of the floor: a stone kick plate is under it.
    // A blank wall gets a window smaller than nothing, so no glass, frame,
    // sill, lintel, or mullion.
    vec2 win = blank ? vec2(-1.0) : shop ? vec2(0.84, 0.66) : a.xy;
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
    // The screen size of a window cell (px). Under FACADE_FADE.bold pixels
    // the window is one flat bold color and the room is not drawn; under
    // FACADE_FADE.fine pixels the fine detail fades out (pbr-palette.js
    // screenFade()).
    float cellPx = 2.0 / max(max(aa.x, aa.y), 1e-4);
    float boldK = 1.0 - smoothstep(${FACADE_FADE.bold[1].toFixed(1)}, ${FACADE_FADE.bold[0].toFixed(1)}, cellPx);
    facadeFine = 1.0 - smoothstep(${FACADE_FADE.fine[1].toFixed(1)}, ${FACADE_FADE.fine[0].toFixed(1)}, cellPx);
    #else
    float boldK = 0.0;
    #endif
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
    if (boldK < 0.999) {
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
        // More rooms are lit at night (uLit): about half in the day, most
        // of them after dark.
        bool lit = shop || h1 > mix(0.45, 0.18, uLit);
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
        // A daylit room is much darker than the facade (the reflection
        // carries the window); at night the lit room is the light source,
        // in a warm interior color.
        roomGlow = lit ? col * mix(0.05, shop ? 1.1 : 0.85, uLit) : vec3(0.0);
        roomGlow *= mix(vec3(1.0), vec3(1.0, 0.72, 0.42), uLit * 0.8);
        // The glass: a tint and a sky reflection that grows at a low angle
        // and dims at night, when the dark sky gives little to reflect.
        float fres = 0.1 + 0.55 * pow(1.0 - r.z, 3.0);
        #ifdef PBR_LOOK
        fres *= 0.35;
        #endif
        vec3 sky = mix(vec3(0.75, 0.87, 1.0), uGlass[st] + vec3(0.25), 0.4) * mix(1.0, 0.18, uLit);
        col = mix(col * mix(vec3(1.0), uGlass[st] * 2.2, 0.25), sky, fres);
        col += vec3(0.08) * (1.0 - smoothstep(0.0, 0.25, abs(cell.x - cell.y * 0.6 - 0.2)));
      }
      glass = col;
    }
    #endif
    #ifdef PBR_LOOK
    // The bold far window: one flat color per window (pbr-palette.js
    // WINDOW_COLORS); the smooth glass still reflects the sky.
    if (boldK > 0.0) {
      float bh = facadeHash(vec3(floor(vFacade.yz), float(st) + dot(vWallSeed, vec3(5.0, 9.0, 0.37)) + 53.0));
      glass = mix(glass, boldWindow(bh), boldK);
    }
    #endif
    // The window reveal (issue #135): the glass sits back in the wall, so
    // the head casts a shadow band on the top of the glass and each jamb a
    // thinner band on its side. The bands are in meters, so a tall shop
    // window and a small house window get the same reveal.
    {
      vec2 m = uStyleM[st];
      float cyR = shop ? SHOP_CY : 0.55;
      // The distance in meters from the glass point to the head and to the
      // nearest jamb.
      float toHead = (cyR + win.y * 0.5 - cell.y) * m.y;
      float toJamb = (win.x * 0.5 - abs(cell.x - 0.5)) * m.x;
      vec2 aam = aa * m;
      float head = 1.0 - smoothstep(${REVEAL.head.toFixed(3)} - aam.y, ${REVEAL.head.toFixed(3)} + aam.y, toHead);
      float jamb = 1.0 - smoothstep(${REVEAL.jamb.toFixed(3)} - aam.x, ${REVEAL.jamb.toFixed(3)} + aam.x, toJamb);
      glass *= 1.0 - ${REVEAL.headShade.toFixed(3)} * head - ${REVEAL.jambShade.toFixed(3)} * jamb * (1.0 - head);
    }
    // Brick detail: the scan over its mean, kept in a safe range. The far
    // fade below turns it off where a brick is under a pixel.
    float far0 = smoothstep(0.25, 0.6, max(aa.x, aa.y));
    // Sample outside the branch, so the mipmap level stays correct.
    vec3 detail = clamp(texture2D(uBrick, vFacade.yz * uStyleM[st] / uBrickTile).rgb / uBrickMean, 0.35, 2.2);
    if (uBrickOn > 0.5 && a.w > 0.5) wallCol *= mix(detail, vec3(1.0), far0);
    #ifdef DETAIL
    // A wall that is not brick: the plaster grain in the albedo (#198).
    float wallGrain = plasterMottle(vFacade.yz * uStyleM[st]);
    if (a.w < 0.5) wallCol *= 1.0 + ${WALL_GRAIN.toFixed(3)} * wallGrain;
    #endif
    // The frame is painted steel; the sill, the lintel, and the kick plate
    // are cast stone.
    vec3 col = mix(wallCol, uFrame[st], frame * 0.85);
    col = mix(col, uTrim[st], max(sill, lintel) * 0.85);
    col = mix(col, uTrim[st] * 0.85, kick);
    #ifdef PBR_LOOK
    // The sun on this wall face: the lintels, the sills, and the floor
    // slabs cast thin shadow bands (the self-shadowing cue of
    // docs/research/2026-11-04-gen-city-auto.md).
    float sunFace = max(dot(normalize(vNormal), normalize((viewMatrix * vec4(uSun.xyz, 0.0)).xyz)), 0.0) * clamp(uSun.w, 0.0, 1.0);
    // The lintel shadow: a band on the wall and the window top under the
    // lintel line.
    float lshade = (!shop && a.w > 0.5) ? (1.0 - smoothstep(fw.x + 0.04 - aa.x, fw.x + 0.04 + aa.x, d.x)) * (1.0 - smoothstep(0.05 - aa.y, 0.05 + aa.y, abs(cell.y - (lintelY - 0.055)))) : 0.0;
    sunFace *= 1.0 - facadeFine;
    col *= 1.0 - 0.3 * lshade * sunFace;
    // The sill shadow: a band on the wall under each sill.
    float sshade = (1.0 - smoothstep(fw.x - aa.x, fw.x + aa.x, d.x)) * (1.0 - smoothstep(0.055 - aa.y, 0.055 + aa.y, abs(cell.y - (sillY - 0.06))));
    col *= 1.0 - 0.22 * sshade * sunFace;
    // A floor band at each slab, above the ground floor: a thin line a little
    // darker than the wall, so a tall building shows its floors. The slab
    // shadow deepens it when the sun is on the face.
    float slab = (level > 0.5 && !blank) ? 1.0 - smoothstep(0.035, 0.035 + aa.y, cell.y) : 0.0;
    col *= 1.0 - (0.22 + 0.26 * sunFace) * slab * (1.0 - facadeFine);
    #endif
    col = mix(col, glass, inWin);
    col = mix(col, uFrame[st], mull * 0.9);
    // Far away a window cell is under a few pixels: fade to the mean color,
    // so the grid does not shimmer.
    float far = far0;
    // The trim area is in the mean, so the near and the far colors match.
    #ifdef PBR_LOOK
    // The far mean uses the bold window mean, so the bold windows fade into it.
    vec3 mean = mix(mix(wallCol, uTrim[st], 0.08), vec3(${windowMean().map((v) => v.toFixed(4)).join(", ")}), max(win.x, 0.0) * max(win.y, 0.0) * 0.9);
    #else
    vec3 mean = mix(mix(wallCol, uTrim[st], 0.08), uGlass[st] + vec3(0.09), max(win.x, 0.0) * max(win.y, 0.0) * 0.9);
    #endif
    diffuseColor.rgb = mix(col, mean, far);
    facadeGlass = inWin * (1.0 - far);
    #ifdef DETAIL
    {
      float stonePart = clamp(max(max(sill, lintel), kick), 0.0, 1.0);
      float wallPart = (1.0 - inFrame) * (1.0 - stonePart);
      float near = (1.0 - far) * (1.0 - facadeFine);
      facadeM = vFacade.yz * uStyleM[st];
      facadeKBrick = a.w > 0.5 ? wallPart * near : 0.0;
      facadeKStone = (a.w > 0.5 ? stonePart : wallPart + stonePart) * near;
      facadeKFrame = clamp(frame + mull, 0.0, 1.0) * near;
    }
    #endif
    #ifdef PBR_LOOK
    // The albedo calibration (the bleached white-box fix of the gen-city
    // research): darker walls, a little less chroma.
    diffuseColor.rgb *= ${FACADE_CALIBRATION.scale.toFixed(3)};
    float albL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(albL), ${FACADE_CALIBRATION.desaturate.toFixed(3)});
    // The albedo ceiling (#157, pbr-palette.js ALBEDO): no wall over 0.6
    // linear, so pale stucco and white trim do not bleach under the sun.
    diffuseColor.rgb = albedoCeiling(diffuseColor.rgb, ${ALBEDO.ceiling.toFixed(3)});
    #endif
    #ifdef PBR_LOOK
    // Ground contact: darker at the base of the wall (look.js wallOcclusion).
    diffuseColor.rgb *= ${WALL_AO.base.toFixed(3)} + ${(1 - WALL_AO.base).toFixed(3)} * smoothstep(0.0, ${WALL_AO.floors.toFixed(3)}, vFacade.z);
    #endif
    #ifdef INTERIOR
    totalEmissiveRadiance += roomGlow * inWin * (1.0 - far);
    #endif
    // The flat lit window: on the tier with no interior rooms it carries
    // the whole night look; with rooms it adds a faint lamp in the unlit
    // ones. A per-window hash picks which windows light and how warm.
    if (uLit > 0.01) {
      float wh = roomHash(vec3(floor(vFacade.yz), float(st) + dot(vWallSeed, vec3(5.0, 9.0, 0.37)) + 31.0));
      float litWin = step(wh, uLit * (shop ? 0.95 : 0.6));
      vec3 glowC = wh < 0.5 ? vec3(1.0, 0.76, 0.48) : vec3(0.82, 0.88, 1.0);
      #ifdef INTERIOR
      // A bold far window has no room glow, so it takes the full flat light.
      totalEmissiveRadiance += glowC * litWin * inWin * (1.0 - far) * uLit * mix(0.12, 0.55, boldK);
      #else
      totalEmissiveRadiance += glowC * litWin * inWin * (1.0 - far) * uLit * 0.55;
      #endif
    }
  }
  #ifdef PBR_LOOK
  if (kind > 3.5) {
    // Concrete (#199): the class albedo, with the plaster scan grain. The
    // scan is in world meters on the plane of the face.
    float grain = 0.0;
    #ifdef DETAIL
    vec3 wn = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
    bool horiz = abs(wn.y) > 0.5;
    vec2 cm = horiz ? vFacadeW.xz : (abs(wn.x) > abs(wn.z) ? vFacadeW.zy : vFacadeW.xy);
    // The grain and the relief fade out where a scan tile is under a few
    // pixels.
    float cnear = 1.0 - smoothstep(0.04, 0.2, max(length(fwidth(cm)), 1e-5));
    grain = plasterMottle(cm);
    facadeM = cm;
    facadeConcrete = 1.0;
    // The relief needs an up vector in the face: not on a top or a bottom.
    facadeKStone = horiz ? 0.0 : cnear;
    #endif
    vec3 conc = vec3(${CONCRETE.albedo.map((v) => v.toFixed(4)).join(", ")}) * (1.0 + ${CONCRETE.grain.toFixed(3)} * grain);
    diffuseColor.rgb = clamp(conc, vec3(${CONCRETE.range[0].toFixed(3)}), vec3(${CONCRETE.range[1].toFixed(3)}));
  }
  #endif
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
  // Concrete: the scan mapped into the class band (pbr-palette.js
  // concreteRoughness()).
  float cr = clamp(0.5 + 0.5 * plasterGrain(rs), 0.0, 1.0);
  roughnessFactor = mix(roughnessFactor, ${CONCRETE.roughness[0].toFixed(3)} + ${(CONCRETE.roughness[1] - CONCRETE.roughness[0]).toFixed(3)} * cr, facadeConcrete);
}
#endif
roughnessFactor = mix(roughnessFactor, facadeGlassRough, facadeGlass);`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
{
  // Each pane reflects at its own angle: a small normal wobble per window
  // cell (gen-city), so adjacent panes catch the sky differently.
  float wu = facadeHash(vec3(floor(vFacade.yz), vFacade.x + 11.0));
  float wv = facadeHash(vec3(floor(vFacade.yz), vFacade.x + 29.0));
  normal = normalize(normal + vec3(wu - 0.5, wv - 0.5, 0.0) * 0.06 * facadeGlass * (1.0 - facadeFine));
}`,
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
  // Concrete gets a stronger relief: the plaster scan is very flat.
  ns.xy *= ${DETAIL_NORMAL.stone.toFixed(3)} * (1.0 + 2.0 * facadeConcrete);
  vec3 s = vec3(0.5, 0.5, 1.0) + nb * facadeKBrick + ns * facadeKStone;
  if (facadeKBrick + facadeKStone > 0.0) normal = detailNormal(normal, tu, tv, s, 1.0);
}
#endif`,
      );
  };
  mat.customProgramCacheKey = () => `facade-v12${brickMap ? "-brick" : ""}${interiors ? "-interior" : ""}${pbr ? "-pbr" : ""}${detail ? "-detail" : ""}`;
  return mat;
}

// The ground scans of the toon look (scripts/ground-textures.py, CC0). One
// static URL per file, so Vite bundles each map. The pbr look has its own
// PBR sets (src/render/pbr-ground.js, #158).
const GROUND = [
  {
    info: asphaltInfo,
    url: new URL("../../assets/ground/asphalt/color.jpg", import.meta.url).href,
  },
  {
    info: concreteInfo,
    url: new URL("../../assets/ground/concrete/color.jpg", import.meta.url).href,
  },
  {
    info: trailInfo,
    url: new URL("../../assets/ground/trail/color.jpg", import.meta.url).href,
  },
  {
    info: grassInfo,
    url: new URL("../../assets/ground/grass/color.jpg", import.meta.url).href,
  },
];
// Surface kind -> ground set (index in GROUND) and detail strength.
const GROUND_OF = {
  ground: [3, 0.6],
  park: [3, 0.65],
  street: [0, 0.8],
  path: [1, 0.8],
  sidewalk: [1, 0.8],
  trail: [2, 0.7],
  // The street decals (#138) get the asphalt scan, with less detail on the
  // cast iron and the paint of a bike lane.
  patchDark: [0, 0.8],
  patchLight: [0, 0.8],
  iron: [0, 0.4],
  bike: [0, 0.5],
  // A brick path (#158) is a path in the toon look.
  brick: [1, 0.8],
};

// The surface shader: a toon material whose art color (the vertex color of
// each surface kind) gets the detail of a real scan, sampled in world
// meters. The detail is the scan over its mean color, so the palette stays.
// A second, rotated, larger sample breaks the tile repeat. The detail fades
// out with distance, where a tile is under a few pixels.
//
// The pbr look with ground maps uses createPbrSurfaceMaterial()
// (src/render/pbr-ground.js, #158) instead.
export function createSurfaceMaterial(gradientMap, { maps = null, look = "toon" } = {}) {
  const mat = litMaterial(look, { vertexColors: true }, { gradientMap, roughness: ROUGHNESS.ground, envLight: ENV_LIGHT.ground });
  // The albedo calibration (pbr look): a darker ground, toward real
  // asphalt and soil (docs/research gen-city: nothing stays near-white).
  if (look === "pbr") mat.color.setScalar(0.72);
  if (!maps) return mat;
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
    // The ground wetness (src/render/weather-view.js): 0 dry, 1 soaked.
    // Kept on the material so the weather can write it after compile.
    shader.uniforms.uWet = { value: 0 };
    mat.userData.uWet = shader.uniforms.uWet;
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
uniform float uWet;
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
  // A soaked street is darker; a material that has roughness gets the wet
  // sheen too (the toon shader has no roughness chunk, so that part only
  // lands on standard materials).
  diffuseColor.rgb *= mix(1.0, 0.72, uWet);
}`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor *= mix(1.0, 0.3, uWet);");
  };
  mat.customProgramCacheKey = () => `surface-v2-ground-${look}`;
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
// The Blender trees (scripts/blender/pbr_trees.py): one GLB per species with
// the templates tree:<species>:<variant> and their _lod1 copies, in the
// treeKindFor() names. They have branches and leaf cards for the pbr look.
export const TREE_GLB_URLS = {
  oak: new URL("../../assets/trees/oak.glb", import.meta.url).href,
  pine: new URL("../../assets/trees/pine.glb", import.meta.url).href,
  magnolia: new URL("../../assets/trees/magnolia.glb", import.meta.url).href,
  myrtle: new URL("../../assets/trees/myrtle.glb", import.meta.url).href,
  dogwood: new URL("../../assets/trees/dogwood.glb", import.meta.url).href,
  street: new URL("../../assets/trees/street.glb", import.meta.url).href,
};

// The kit templates and the extra props. A failed or slow extra GLB does
// not stop the kit: the kind gets its fallback kit template. With
// `glbTrees` the Blender tree templates come too; a species that fails
// keeps its procedural tree.
export async function loadPropTemplates({ glbTrees = false } = {}) {
  const kinds = Object.keys(EXTRA_PROP_URLS);
  const extras = kinds.map((k) => withTimeout(loadKitTemplates(EXTRA_PROP_URLS[k]), EXTRA_PROP_TIMEOUT_MS, k));
  const species = glbTrees ? Object.keys(TREE_GLB_URLS) : [];
  const treeLoads = species.map((k) => withTimeout(loadKitTemplates(TREE_GLB_URLS[k]), EXTRA_PROP_TIMEOUT_MS, `tree ${k}`));
  const [kit, results, treeResults] = await Promise.all([loadKitTemplates(), Promise.allSettled(extras), Promise.allSettled(treeLoads)]);
  for (const problem of addExtraTemplates(kit, kinds, results)) console.warn(`extra prop: ${problem}`);
  treeResults.forEach((r, i) => {
    if (r.status === "fulfilled") Object.assign(kit, r.value);
    else console.warn(`tree glb: ${species[i]}: ${r.reason}`);
  });
  return kit;
}

// Pure: the GLB tree templates under their treeKindFor() names. GLTFLoader
// drops the ":" from a node name, so the GLBs name them tree_oak_0.
const GLB_TREE_NAME = new RegExp(`^tree[:_]?(${Object.keys(TREE_GLB_URLS).join("|")})[:_]?(\\d+)(_lod1)?$`);
export function glbTreeTemplates(templates, season = "summer") {
  const out = {};
  for (const [k, t] of Object.entries(templates)) {
    // The far shapes are the impostors (tree-impostors.js), or the
    // procedural crown cards (trees.js) with no renderer to draw them.
    const m = GLB_TREE_NAME.exec(k);
    // The crown cores get their own leaf code (leaf-cut.js markCrownCores()).
    if (m && !m[3]) out[`tree:${m[1]}:${m[2]}`] = markCrownCores(seasonalGlbTree(t, m[1], season));
  }
  return out;
}

const toLinear = (v) => Math.pow(Math.max(0, v), 2.2);
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const unitHash = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

// Pure: a GLB tree (painted in its summer colors) in the colors of `season`
// (trees.js seasonColors). The leaves and the crown cores take the season
// leaf color; a card that blooms in summer (red over green) turns leaf in a
// season with no blooms; in a season with blooms, `share` of the cards (by
// their seed) take a bloom color. Each keeps its own shade. The bark keeps
// its colors.
export function seasonalGlbTree(t, species, season = "summer") {
  if (season === "summer" || !t.leaf) return t;
  const summer = seasonColors(species, "summer");
  const now = seasonColors(species, season);
  const ratio = now.leaf.map((c, i) => toLinear(c) / Math.max(toLinear(summer.leaf[i]), 1e-4));
  const src = t.colors;
  const n = src.length / 3;
  const bloomOf = (i) => t.leaf[i * 3 + 2] > 0 && src[i * 3] > src[i * 3 + 1];
  const leafRef = [0, 0, 0];
  const bloomRef = [0, 0, 0];
  let nl = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    if (!(t.leaf[i * 3 + 2] > 0)) continue;
    const ref = bloomOf(i) ? bloomRef : leafRef;
    for (let c = 0; c < 3; c += 1) ref[c] += src[i * 3 + c];
    if (ref === bloomRef) nb += 1;
    else nl += 1;
  }
  for (let c = 0; c < 3; c += 1) {
    leafRef[c] /= Math.max(nl, 1);
    bloomRef[c] /= Math.max(nb, 1);
  }
  const blooms = now.blooms ? now.blooms.map((b) => b.map(toLinear)) : null;
  const colors = new Float32Array(src.length);
  for (let i = 0; i < n; i += 1) {
    const code = t.leaf[i * 3 + 2];
    const c = [src[i * 3], src[i * 3 + 1], src[i * 3 + 2]];
    let out = c;
    if (code >= 0) {
      const wasBloom = bloomOf(i);
      const k = luma(c) / Math.max(luma(wasBloom ? bloomRef : leafRef), 1e-4);
      out = wasBloom ? leafRef.map((v, j) => v * ratio[j] * k) : c.map((v, j) => v * ratio[j]);
      if (code > 0 && blooms && unitHash(code) < now.share) {
        const b = blooms[Math.floor(unitHash(code * 7.31) * blooms.length) % blooms.length];
        out = b.map((v) => v * Math.min(1, k * 0.85));
      }
    }
    colors.set(out, i * 3);
  }
  return { ...t, colors };
}

// Pure: the color of one GLB tree placement (prop-batch tint): a little
// lighter or darker, warmer or cooler, from its position.
export function treeTint(p) {
  const a = unitHash(p.x * 0.731 + p.z * 1.917);
  const b = unitHash(p.x * 1.311 - p.z * 0.537);
  const k = 0.9 + 0.18 * a;
  const warm = (b - 0.5) * 2;
  return [k * (1 + 0.06 * warm), k, k * (1 - 0.08 * warm)];
}

// Reads the kit GLB into plain templates: { kind: { positions, indices, colors } }.
export async function loadKitTemplates(url = KIT_URL) {
  const gltf = await new GLTFLoader().setDRACOLoader(getDracoLoader()).loadAsync(url);
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
    const t = normals ? { positions, indices, colors, normals } : { positions, indices, colors };
    // The Blender trees carry the wind weight and the leaf card data
    // (glTF custom attributes _SWAY and _LEAF).
    if (g.attributes._sway) t.sway = Float32Array.from(g.attributes._sway.array);
    if (g.attributes._leaf) t.leaf = Float32Array.from(g.attributes._leaf.array);
    templates[o.name] = t;
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
// The leaf flutter of a tree card on top of the crown sway (m, rad/s).
export const LEAF_FLUTTER = { amplitude: 0.035, rate: 7.0 };
// With `coverage` (the high tier: the scene draws into a MSAA target) the
// leaf edges use alpha to coverage (#202). Without MSAA it has no effect, so
// the phone and low tiers keep the cut at 0.5 coverage.
function createPropMaterial({ wind = true, look = "toon", leaves = false, coverage = false } = {}) {
  const material = litMaterial(look, { vertexColors: true }, { gradientMap: toonRamp({ soft: true }), roughness: ROUGHNESS.props, envLight: ENV_LIGHT.props });
  // The albedo calibration (pbr look): darker leaves and props.
  if (look === "pbr") material.color.setScalar(0.8);
  // A card is a single quad: both sides must draw.
  if (leaves) material.side = THREE.DoubleSide;
  if (leaves && coverage) material.alphaToCoverage = true;
  const time = { value: 0 };
  // The pbr look: the warm globe of each kit lamp glows at night (#196).
  // The globe is the one vertex color LAMP_GLOBE in the kit lamp.
  const lampGlow = look === "pbr";
  if (lampGlow) material.userData.uLit = { value: 0 };
  if (wind || leaves || lampGlow) {
    material.onBeforeCompile = (shader) => {
      if (lampGlow) {
        shader.uniforms.uLit = material.userData.uLit;
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform float uLit;")
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>
#ifdef USE_COLOR
if (distance(vColor.rgb, vec3(${LAMP_GLOBE.color.join(", ")})) < 0.02) totalEmissiveRadiance += vColor.rgb * uLit * ${LAMP_GLOBE.night.toFixed(1)};
#endif`,
          );
      }
      if (leaves) {
        patchLeafVertex(shader);
        patchLeafFragment(shader, { backlight: look === "pbr" });
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
            "float windGust = 0.75 + 0.25 * sin(uWindTime * 0.37 + windWorld.x * 0.011 - windWorld.z * 0.007);",
            "vec3 windMove = windGust * sway * vec3(0.2 * sin(windPhase) + 0.05 * sin(windPhase * 2.7), 0.0, 0.12 * cos(windPhase * 0.8));",
            "#ifdef USE_BATCHING",
            // A yaw and a uniform scale: the inverse is the transpose over the scale squared.
            "mat3 windBasis = mat3(batchingMatrix);",
            "transformed += transpose(windBasis) * windMove / dot(windBasis[0], windBasis[0]);",
            "#else",
            "transformed += windMove;",
            "#endif",
            // The leaf flutter: each card shakes along its normal at its own phase.
            ...(leaves ? [`if (leaf.z > 0.0) transformed += sway * normal * ${LEAF_FLUTTER.amplitude.toFixed(3)} * sin(uWindTime * ${LEAF_FLUTTER.rate.toFixed(2)} + leaf.z * 61.0 + windWorld.y * 1.3);`] : []),
          ].join("\n"),
        );
    };
    material.customProgramCacheKey = () => `geo-props${wind ? "-wind" : ""}${leaves ? "-leaves" : ""}${lampGlow ? "-lamps" : ""}-${look}`;
  }
  return { material, time };
}

// `groundDetail: false` keeps the flat art colors on the ground.
// `trees: false` keeps the two street kit trees (for an A/B check).
// `aprons: false` leaves out the concrete aprons of the shops (aprons.js).
// `season` sets the tree colors: "spring", "summer" (the default), or "fall".
// `look` picks the material set ("toon" or "pbr", src/render/look.js).
// `kitGlb`: the loaded Blender facade kit nodes (facade-kit-view.js
// loadFacadeKit()) or null. The pbr look puts them in the depth tiles, and the
// procedural kit leaves out what they replace; without them (a failed load)
// the full procedural kit stays.
// The build options of the far surface tiles (the low tier).
export const FAR_TERRAIN_BUILD = { terrainStep: 2, surfacesOnly: true };

export function createGeoView(level, meshes = buildGeoMeshes(level), { lod0Distance = PROP_LOD0_DISTANCE, drawDistance = PROP_DRAW_DISTANCE, groundDetail = true, markings = true, aprons = true, kit = true, depth = true, depthDistance = DEPTH_DISTANCE, interiors = false, farTerrain = false, farTerrainDistance = FAR_TERRAIN_DISTANCE, trees = true, wind = true, season = "summer", look = "toon", kitGlb = null, pbrGround = true, farMeshes = null, leafCoverage = false } = {}) {
  const root = new THREE.Group();
  root.name = level.name;
  const gradientMap = toonRamp();
  let muralMap = null;
  const materials = {
    // The pbr look gets the PBR ground sets on every tier (#158): the full
    // maps with groundDetail, the small ones (no normal map) without.
    surface: look === "pbr" && pbrGround ? createPbrSurfaceMaterial({ tier: groundDetail ? "high" : "small" }) : createSurfaceMaterial(gradientMap, { maps: groundDetail ? loadGroundMaps() : null, look }),
    building: createFacadeMaterial(gradientMap, { brickMap: loadBrickMap(), interiors, look, detailMaps: look === "pbr" ? loadWallDetail() : null }),
    props: null,
    get mural() {
      // The pbr look: the painted atlas, its roughness, and the dry-brush
      // cut that shows the host wall (murals.js, #198).
      if (!muralMap) muralMap = look === "pbr" ? createMuralMaterial(look, litMaterial, { gradientMap, roughness: ROUGHNESS.mural, envLight: ENV_LIGHT.mural }) : litMaterial(look, { map: createMuralAtlas() }, { gradientMap, roughness: ROUGHNESS.mural, envLight: ENV_LIGHT.mural });
      return muralMap;
    },
  };
  // The leaf cards on the trees come with the pbr look (look.js).
  const leaves = trees && look === "pbr";
  const propMaterial = createPropMaterial({ wind, look, leaves, coverage: leafCoverage });
  materials.props = propMaterial.material;
  const byId = new Map();
  // Road markings join the render copy of their surface tile (no extra
  // draw call). The shared meshes, which the physics reads, stay as they are.
  // The markings follow the terrain like the streets (terrain.js).
  const terrain = terrainOf(level);
  // The concrete aprons around the storefront buildings (aprons.js) join
  // the surface tiles in the same way. The kit and the aprons share the
  // front walls. The lines on a bridge deck come at their final height
  // (no drape).
  const fronts = kit || aprons ? frontEdges(level) : null;
  const groundExtras = new Map();
  for (const t of [...(markings ? roadMarkings(level) : []), ...(aprons ? storefrontAprons(level, fronts) : [])]) {
    const list = groundExtras.get(t.tile) ?? [];
    list.push(t.deck ? mergeMeshes([drapeMesh(t.mesh, terrain), t.deck]) : drapeMesh(t.mesh, terrain));
    groundExtras.set(t.tile, list);
  }
  const markingTiles = new Map([...groundExtras].map(([tile, list]) => [tile, list.length > 1 ? mergeMeshes(list) : list[0]]));
  // The facade kit (cornices, copings, belt courses, house roofs) joins the
  // render copy of its building tile in the same way.
  const shopBoards = [];
  const signList = kit ? shopSigns(level, fronts) : [];
  const glbKit = kit && depth && kitGlb && look === "pbr" ? facadeKitPlacements(level, fronts, { signs: signList }) : null;
  // The pbr look frames each mural with a cap and a base (#198).
  const kitParts = kit ? facadeKit(level, fronts, shopBoards, undefined, glbKit?.covers ?? null, undefined, { muralFrames: look === "pbr" }) : { tiles: [], depthTiles: [], counts: {} };
  // The shop names on the GLB sign boards go in the GLB depth tiles, so they hide with their boards.
  const glbNames = glbKit ? boardNamesBatch(glbKit.buildings.flatMap((b) => b.boards), look) : null;
  const glbView = glbKit ? createFacadeKitView(kitGlb, glbKit.buildings, { depthDistance, names: glbNames }) : null;
  if (glbView) root.add(glbView.root);
  const facadeGlb = { on: glbView !== null, loaded: glbView !== null, instances: glbKit?.instances ?? 0, buildings: glbKit?.buildings.length ?? 0, near: 0, shown: 0, lod1: 0, drawCalls: 0, triangles: 0 };
  const kitTiles = new Map(kitParts.tiles.map((t) => [t.tile, t.mesh]));
  for (const { material, tile, mesh } of meshes) {
    // A "claimed" mesh is the footprint of a landmark with claim: true —
    // the landmark model draws it; physics still sees the collider.
    if (material === "claimed") continue;
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
    // `farMeshes`: the same build, made before (in a worker, #98).
    for (const { tile, mesh } of farMeshes ?? buildGeoMeshes(level, FAR_TERRAIN_BUILD)) {
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

  // The shop-name decals on the kit's sign boards, and the district names
  // on the trail (render/shop-names.js): one atlas, one merged mesh.
  const names = shopBoards.length ? shopNamesMesh(shopBoards, level, look) : null;
  if (names) root.add(names);
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
  // The shop name boards from the OSM shop and amenity tags (issue #135).
  const signs = kit ? createShopSigns(signList, (params) => litMaterial(look, params, { gradientMap, roughness: 0.7, envLight: ENV_LIGHT.props }), { hot: look === "pbr" }) : null;
  if (signs) root.add(signs.group);

  // Kit props load after the level shows. All props are one batch (one
  // draw call); update() picks the LOD of each prop.
  let propBatch = null;
  const props = { count: 0, instances: 0, kinds: 0, drawn: 0, lod0: 0, loaded: false, error: null, groundLight: null };
  // `renderer` draws the far tree impostors (tree-impostors.js).
  const treeCost = { impostorKinds: 0, atlasBytes: 0, bakeMs: 0 };
  const treeAtlas = { pixels: null, size: 0 };
  function addProps(placements, templates, { renderer = null } = {}) {
    // The procedural trees take the place of the two kit trees.
    // The GLB trees take the place of the procedural ones in the pbr look,
    // in the colors of the season.
    const glb = leaves ? glbTreeTemplates(templates, season) : {};
    let far = {};
    if (renderer && Object.keys(glb).length) {
      const t0 = performance.now();
      const baked = bakeTreeImpostors(renderer, glb);
      far = baked.templates;
      treeCost.impostorKinds = Object.keys(far).length;
      treeCost.atlasBytes = baked.bytes;
      treeCost.bakeMs = Math.round(performance.now() - t0);
      treeAtlas.pixels = baked.pixels;
      treeAtlas.size = baked.size;
    }
    const all = trees ? { ...templates, ...treeTemplates({ season, cards: leaves }), ...glb, ...far } : templates;
    const glbKinds = new Set(Object.keys(glb));
    // Each GLB tree gets its own turn when the data gives none.
    const placed = (trees ? withProceduralTrees(placements) : placements).map((p) => (glbKinds.has(p.kind) && !p.yaw ? { ...p, yaw: Math.round(unitHash(p.x * 3.7 + p.z * 0.29) * 6283) / 1000 } : p));
    const fade = glbKinds.size ? { band: TREE_FADE_BAND, kinds: [...glbKinds] } : null;
    if (fade) TREE_UNIFORMS.uLodFade.value.set(lod0Distance - TREE_FADE_BAND, lod0Distance);
    // The lamp pools and the mulch under the trees on the pbr ground
    // (ground-light.js): one map, baked once from the same placements.
    const groundLight = materials.surface.userData.setGroundLight?.(placed);
    if (groundLight) props.groundLight = groundLight;
    propBatch = createPropBatch(placed, all, materials.props, { lod0Distance, drawDistance, fade, tint: glbKinds.size ? (p) => (glbKinds.has(p.kind) ? treeTint(p) : null) : null });
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
    // The weather handles (src/render/weather-view.js): the facade
    // material gets uLit (window light) and the surface material gets
    // uWet (wet ground). The uniforms appear when the shaders compile.
    // The pbr ground, the prop lamps, the shop boards and the shop letters
    // get uLit too (the lamp pools, the lamp globes and the hot sign cores
    // at night, #196).
    weather: { lit: [materials.building, materials.surface, materials.props, ...[signs?.material, glbNames?.mesh.material, names?.material].filter((m) => m?.userData.uLit)], wet: [materials.surface], sun: [materials.building] },
    get meshCount() {
      return meshes.length + (propBatch ? 1 : 0);
    },
    props,
    treeCost,
    treeAtlas,
    kit: kitParts.counts,
    // The far terrain: the tile count, the far tiles now, and the distance
    // from the camera to the nearest far tile (Infinity with none).
    terrainLod,
    facadeDepth,
    facadeGlb,
    shopSigns: signs ? { count: signs.count, names: signs.names } : { count: 0, names: [] },
    addProps,
    // Shows each prop at one level of detail by its distance from the
    // camera, and hides the far props and depth tiles.
    update(cameraPosition, seconds = performance.now() / 1000) {
      propMaterial.time.value = seconds;
      TREE_UNIFORMS.uLodCamera.value.copy(cameraPosition);
      let farTiles = 0;
      let nearestFar = Infinity;
      for (const t of terrainLods) {
        const d = boundsDistance(t.bounds, cameraPosition.x, cameraPosition.z);
        const far = d > farTerrainDistance;
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
      if (glbView) {
        glbView.update(cameraPosition);
        Object.assign(facadeGlb, { near: glbView.info.near, lod1: glbView.info.lod1, shown: glbView.info.shown, drawCalls: glbView.info.drawCalls, triangles: glbView.info.triangles });
      }
      if (signs) signs.update(cameraPosition);
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
  const hemi = new THREE.HemisphereLight(L.hemisphereSky, L.hemisphereGround, L.hemisphere);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(L.sunColor ?? 0xfff1d6, L.sun);
  // The offset keeps about the old distance (62 m), so the shadow camera
  // (near 1, far 200) still holds the shadow box.
  const offset = new THREE.Vector3(...(L.sunOffset ?? [30, 50, 20])).setLength(62);
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
    hemi,
    sunDirection: offset.clone().normalize(),
    // The weather (src/render/weather-view.js) sets the sun on the solar
    // direction at a fixed distance, so the shadow box keeps its size.
    setSun(dir, color, intensity) {
      offset.set(dir[0], dir[1], dir[2]).normalize().multiplyScalar(90);
      if (color) sun.color.copy(color);
      if (intensity !== undefined) sun.intensity = intensity;
    },
    setHemi(skyColor, groundColor, intensity) {
      if (skyColor) hemi.color.copy(skyColor);
      if (groundColor) hemi.groundColor.copy(groundColor);
      if (intensity !== undefined) hemi.intensity = intensity;
    },
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
