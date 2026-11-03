import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GEO_TILE, SURFACE_COLORS, buildGeoMeshes, buildPropMeshes } from "../level/geo/geo-mesh.js";
import { STYLES } from "../level/geo/styles.js";
import { roadMarkings } from "../level/geo/markings.js";
import { facadeKit } from "../level/geo/facade-kit.js";
import { drapeMesh, terrainOf } from "../level/geo/terrain.js";
import { mergeMeshes } from "../level/geo/extrude.js";
import { treeTemplates, withProceduralTrees } from "../level/geo/trees.js";
import { createMuralAtlas } from "./murals.js";
import brickInfo from "../../assets/landmarks/textures/brick/set.json";
import asphaltInfo from "../../assets/ground/asphalt/set.json";
import concreteInfo from "../../assets/ground/concrete/set.json";
import trailInfo from "../../assets/ground/trail/set.json";
import grassInfo from "../../assets/ground/grass/set.json";

const KIT_URL = new URL("../../assets/kit/street-kit.glb", import.meta.url).href;
// The CC0 brick scan (scripts/landmark-textures.py), shared with the
// landmarks, so the buildings and the landmarks show the same brick.
const BRICK_URL = new URL("../../assets/landmarks/textures/brick/color.jpg", import.meta.url).href;
// Prop tile distances from the camera to the tile center (m). Under
// PROP_LOD0_DISTANCE a tile shows its detailed props, under
// PROP_DRAW_DISTANCE its simple props, and past that nothing.
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
export function createFacadeMaterial(gradientMap, { brickMap = null, interiors = false } = {}) {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  if (interiors) mat.defines = { INTERIOR: 1 };
  const n = STYLES.length;
  // styleA: window width and height (cell fractions), storefront, brick.
  const styleA = STYLES.map((s) => new THREE.Vector4(s.window[0], s.window[1], s.storefront ? 1 : 0, s.brick ? 1 : 0));
  // styleM: meters per bay and per floor, to tile the scan at its real size.
  const styleM = STYLES.map((s) => new THREE.Vector2(s.bay, s.floorHeight));
  // The scan's mean color (linear): its tint makes the mean the spec color.
  const brickMean = new THREE.Color(brickInfo.targetHex);
  const glass = STYLES.map((s) => new THREE.Vector3(...s.glass));
  const trim = STYLES.map((s) => new THREE.Vector3(...s.trim));
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStyleA = { value: styleA };
    shader.uniforms.uGlass = { value: glass };
    shader.uniforms.uTrim = { value: trim };
    shader.uniforms.uStyleM = { value: styleM };
    shader.uniforms.uBrick = { value: brickMap };
    shader.uniforms.uBrickMean = { value: new THREE.Vector3(brickMean.r, brickMean.g, brickMean.b) };
    shader.uniforms.uBrickTile = { value: brickInfo.tileMeters };
    shader.uniforms.uBrickOn = { value: brickMap ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 facade;\nvarying vec4 vFacade;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFacade = facade;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec4 vFacade;
uniform vec4 uStyleA[${n}];
uniform vec3 uGlass[${n}];
uniform vec3 uTrim[${n}];
uniform vec2 uStyleM[${n}];
uniform sampler2D uBrick;
uniform vec3 uBrickMean;
uniform float uBrickTile;
uniform float uBrickOn;
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
    vec2 win = shop ? vec2(0.84, 0.74) : a.xy;
    vec2 d = abs(cell - vec2(0.5, shop ? 0.42 : 0.55)) * 2.0;
    // Anti-aliased edges: blend over one screen pixel, not a hard step.
    vec2 aa = max(fwidth(vFacade.yz) * 2.0, vec2(1e-4));
    float inWin = (1.0 - smoothstep(win.x - aa.x, win.x + aa.x, d.x)) * (1.0 - smoothstep(win.y - aa.y, win.y + aa.y, d.y));
    vec2 fw = win + vec2(0.07, 0.07);
    float inFrame = (1.0 - smoothstep(fw.x - aa.x, fw.x + aa.x, d.x)) * (1.0 - smoothstep(fw.y - aa.y, fw.y + aa.y, d.y));
    float frame = clamp(inFrame - inWin, 0.0, 1.0);
    // A sill under each window, and a center mullion on wide windows.
    float sillY = (shop ? 0.42 : 0.55) - win.y * 0.5 - 0.05;
    float sill = (1.0 - smoothstep(fw.x - aa.x, fw.x + aa.x, d.x)) * (1.0 - smoothstep(0.03 - aa.y, 0.03 + aa.y, abs(cell.y - sillY)));
    float mull = win.x > 0.5 ? (1.0 - smoothstep(0.025 - aa.x, 0.025 + aa.x, abs(cell.x - 0.5))) * inWin : 0.0;
    vec3 glass = uGlass[st] + vec3(0.18 * cell.y) + vec3(0.12) * (1.0 - smoothstep(0.0, 0.25, abs(cell.x - cell.y * 0.6 - 0.2)));
    vec3 wallCol = diffuseColor.rgb;
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
      float cy = shop ? 0.42 : 0.55;
      vec2 o0 = vec2(0.5 - win.x * 0.5, cy - win.y * 0.5) * m;
      vec2 o1 = vec2(0.5 + win.x * 0.5, cy + win.y * 0.5) * m;
      vec3 q = p + r * (reveal / r.z);
      vec3 rid = vec3(floor(vFacade.yz), float(st) + dot(wallCol, vec3(7.0, 13.0, 3.0)) + dot(N, vec3(5.0, 0.0, 9.0)));
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
        if (!shop && cell.y > cy + win.y * 0.5 - win.y * blind) col = mix(uTrim[st], vec3(0.96, 0.93, 0.86), 0.5) * (0.82 + 0.1 * step(0.5, fract((cell.y) * 40.0)));
        roomGlow = lit ? col * (shop ? 0.24 : 0.2) : vec3(0.0);
        // The glass: a tint and a sky reflection that grows at a low angle.
        float fres = 0.1 + 0.55 * pow(1.0 - r.z, 3.0);
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
    vec3 col = mix(wallCol, uTrim[st], max(frame, sill) * 0.85);
    col = mix(col, glass, inWin);
    col = mix(col, uTrim[st], mull * 0.9);
    // Far away a window cell is under a few pixels: fade to the mean color,
    // so the grid does not shimmer.
    float far = far0;
    vec3 mean = mix(wallCol, uGlass[st] + vec3(0.09), win.x * win.y * 0.9);
    diffuseColor.rgb = mix(col, mean, far);
    #ifdef INTERIOR
    totalEmissiveRadiance += roomGlow * inWin * (1.0 - far);
    #endif
  }
}`,
      );
  };
  mat.customProgramCacheKey = () => `facade-v4${brickMap ? "-brick" : ""}${interiors ? "-interior" : ""}`;
  return mat;
}

// The ground scans (scripts/ground-textures.py, CC0). One static URL per
// file, so Vite bundles each map.
const GROUND = [
  { info: asphaltInfo, url: new URL("../../assets/ground/asphalt/color.jpg", import.meta.url).href },
  { info: concreteInfo, url: new URL("../../assets/ground/concrete/color.jpg", import.meta.url).href },
  { info: trailInfo, url: new URL("../../assets/ground/trail/color.jpg", import.meta.url).href },
  { info: grassInfo, url: new URL("../../assets/ground/grass/color.jpg", import.meta.url).href },
];
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
export function createSurfaceMaterial(gradientMap, { maps = null } = {}) {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
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
  diffuseColor.rgb *= mix(vec3(1.0), det, strength * fade);
}`,
      );
  };
  mat.customProgramCacheKey = () => "surface-v1-ground";
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

// The prop material: the soft toon ramp, and wind on the tree crowns. The
// vertex shader moves each vertex by its sway weight (0 for trunks and kit
// props), with a phase from the world position, so near trees do not move
// as one. The shadow map does not get the wind; the move is under 0.3 m.
function createPropMaterial({ wind = true } = {}) {
  const material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp({ soft: true }) });
  const time = { value: 0 };
  if (wind) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = time;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float sway;\nuniform float uWindTime;")
        .replace(
          "#include <begin_vertex>",
          [
            "#include <begin_vertex>",
            "float windPhase = uWindTime * 1.3 + position.x * 0.17 + position.z * 0.13;",
            "transformed.x += sway * (0.2 * sin(windPhase) + 0.05 * sin(windPhase * 2.7));",
            "transformed.z += sway * 0.12 * cos(windPhase * 0.8);",
          ].join("\n"),
        );
    };
    material.customProgramCacheKey = () => "geo-props-wind";
  }
  return { material, time };
}

// `groundDetail: false` keeps the flat art colors on the ground.
// `trees: false` keeps the two street kit trees (for an A/B check).
export function createGeoView(level, meshes = buildGeoMeshes(level), { lod0Distance = PROP_LOD0_DISTANCE, drawDistance = PROP_DRAW_DISTANCE, groundDetail = true, markings = true, kit = true, depth = true, depthDistance = DEPTH_DISTANCE, interiors = false, farTerrain = false, trees = true, wind = true } = {}) {
  const root = new THREE.Group();
  root.name = level.name;
  const gradientMap = toonRamp();
  let muralMap = null;
  const materials = {
    surface: createSurfaceMaterial(gradientMap, { maps: groundDetail ? loadGroundMaps() : null }),
    building: createFacadeMaterial(gradientMap, { brickMap: loadBrickMap(), interiors }),
    props: null,
    get mural() {
      if (!muralMap) muralMap = new THREE.MeshToonMaterial({ map: createMuralAtlas(), gradientMap });
      return muralMap;
    },
  };
  const propMaterial = createPropMaterial({ wind });
  materials.props = propMaterial.material;
  const byId = new Map();
  // Road markings join the render copy of their surface tile (no extra
  // draw call). The shared meshes, which the physics reads, stay as they are.
  // The markings follow the terrain like the streets (terrain.js).
  const terrain = terrainOf(level);
  const markingTiles = new Map(markings ? roadMarkings(level).map((t) => [t.tile, drapeMesh(t.mesh, terrain)]) : []);
  // The facade kit (cornices, copings, belt courses, house roofs) joins the
  // render copy of its building tile in the same way.
  const kitParts = kit ? facadeKit(level) : { tiles: [], depthTiles: [], counts: {} };
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
  const terrainLods = [];
  if (farTerrain && !terrain.flat) {
    for (const { tile, mesh } of buildGeoMeshes(level, { terrainStep: 2, surfacesOnly: true })) {
      const near = byId.get(`surface-${tile}`);
      if (!near) continue;
      const far = addMesh(root, byId, `surface-far-${tile}`, geoGeometry(mesh), materials.surface);
      far.visible = false;
      const [ix, iz] = tile.split(",").map(Number);
      terrainLods.push({ near, far, x0: ix * GEO_TILE, z0: iz * GEO_TILE });
    }
  }
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

  // Kit props load after the level shows. Each prop tile is one merged mesh;
  // far tiles are hidden in update().
  const propTiles = [];
  const props = { count: 0, tiles: 0, loaded: false, error: null };
  function addProps(placements, templates) {
    // The procedural trees take the place of the two kit trees.
    const all = trees ? { ...templates, ...treeTemplates() } : templates;
    const placed = trees ? withProceduralTrees(placements) : placements;
    for (const t of buildPropMeshes(placed, all)) {
      const obj = addMesh(root, byId, `props-${t.tile}-lod${t.lod}`, geoGeometry(t.mesh), materials.props, { castShadow: true });
      obj.userData.center = t.center;
      obj.userData.lod = t.lod;
      obj.visible = false;
      propTiles.push(obj);
    }
    props.count = placements.length;
    props.tiles = propTiles.length / 2;
    props.loaded = true;
  }

  return {
    root,
    byId,
    get meshCount() {
      return meshes.length + propTiles.length;
    },
    props,
    kit: kitParts.counts,
    terrainLods: terrainLods.length,
    facadeDepth,
    addProps,
    // Shows each prop tile at one level of detail by its distance from the
    // camera, and hides the far prop and depth tiles.
    update(cameraPosition, seconds = performance.now() / 1000) {
      propMaterial.time.value = seconds;
      for (const t of terrainLods) {
        const dx = Math.max(t.x0 - cameraPosition.x, 0, cameraPosition.x - (t.x0 + GEO_TILE));
        const dz = Math.max(t.z0 - cameraPosition.z, 0, cameraPosition.z - (t.z0 + GEO_TILE));
        const far = Math.hypot(dx, dz) > FAR_TERRAIN_DISTANCE;
        t.near.visible = !far;
        t.far.visible = far;
      }
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
      let lod0 = 0;
      for (const obj of propTiles) {
        const [cx, cz] = obj.userData.center;
        const d = Math.hypot(cx - cameraPosition.x, cz - cameraPosition.z);
        obj.visible = obj.userData.lod === 0 ? d < lod0Distance : d >= lod0Distance && d < drawDistance;
        if (obj.visible && obj.userData.lod === 0) lod0 += 1;
      }
      props.lod0Tiles = lod0;
    },
  };
}

// Daylight for a big level. The shadow box follows the skater, because one
// shadow map cannot cover 2 km at a useful resolution. The shell turns the
// shadow map off on a geodata level for speed; the light keeps the setup
// for a faster machine.
export function createGeoLights({ shadowRadius = 45, shadowMapSize = 2048 } = {}) {
  const group = new THREE.Group();
  group.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a6a48, 0.7));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.5);
  const offset = new THREE.Vector3(30, 50, 20);
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
