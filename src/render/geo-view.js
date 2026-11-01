import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildGeoMeshes, buildPropMeshes } from "../level/geo/geo-mesh.js";
import { STYLES } from "../level/geo/styles.js";
import { createMuralAtlas } from "./murals.js";

const KIT_URL = new URL("../../assets/kit/street-kit.glb", import.meta.url).href;
// Prop tiles farther than this from the camera are hidden (m).
export const PROP_DRAW_DISTANCE = 170;

// Three.js view of a geodata level: one merged mesh per material per tile,
// with a toon (cel) material and vertex colors. The simulation never sees
// any of this.

// A 3-step ramp gives the cel look.
function toonRamp() {
  const data = new Uint8Array([110, 110, 110, 255, 180, 180, 180, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
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
  geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

// The facade shader: a toon material that draws windows, storefronts, and
// cornices from the facade attribute (see src/level/geo/extrude.js). The
// windows cost no geometry.
export function createFacadeMaterial(gradientMap) {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  const n = STYLES.length;
  const styleA = STYLES.map((s) => new THREE.Vector4(s.window[0], s.window[1], s.storefront ? 1 : 0, 0));
  const glass = STYLES.map((s) => new THREE.Vector3(...s.glass));
  const trim = STYLES.map((s) => new THREE.Vector3(...s.trim));
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStyleA = { value: styleA };
    shader.uniforms.uGlass = { value: glass };
    shader.uniforms.uTrim = { value: trim };
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
uniform vec3 uTrim[${n}];`,
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
    float inWin = step(d.x, win.x) * step(d.y, win.y);
    float frame = step(d.x, win.x + 0.07) * step(d.y, win.y + 0.07) - inWin;
    vec3 glass = uGlass[st] + vec3(0.18 * cell.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, uTrim[st], frame * 0.85);
    diffuseColor.rgb = mix(diffuseColor.rgb, glass, inWin);
  }
}`,
      );
  };
  mat.customProgramCacheKey = () => "facade-v1";
  return mat;
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
    const positions = new Float32Array(pos.count * 3);
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) {
      positions[i * 3] = pos.getX(i);
      positions[i * 3 + 1] = pos.getY(i);
      positions[i * 3 + 2] = pos.getZ(i);
      colors[i * 3] = col ? col.getX(i) : 1;
      colors[i * 3 + 1] = col ? col.getY(i) : 1;
      colors[i * 3 + 2] = col ? col.getZ(i) : 1;
    }
    const indices = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
    templates[o.name] = { positions, indices, colors };
  });
  return templates;
}

export function createGeoView(level, meshes = buildGeoMeshes(level)) {
  const root = new THREE.Group();
  root.name = level.name;
  const gradientMap = toonRamp();
  let muralMap = null;
  const materials = {
    surface: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }),
    building: createFacadeMaterial(gradientMap),
    props: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }),
    get mural() {
      if (!muralMap) muralMap = new THREE.MeshToonMaterial({ map: createMuralAtlas(), gradientMap });
      return muralMap;
    },
  };
  const byId = new Map();
  for (const { material, tile, mesh } of meshes) {
    addMesh(root, byId, `${material}-${tile}`, geoGeometry(mesh), materials[material], { castShadow: material === "building" });
  }

  // Kit props load after the level shows. Each prop tile is one merged mesh;
  // far tiles are hidden in update().
  const propTiles = [];
  const props = { count: 0, tiles: 0, loaded: false, error: null };
  function addProps(placements, templates) {
    for (const t of buildPropMeshes(placements, templates)) {
      const obj = addMesh(root, byId, `props-${t.tile}`, geoGeometry(t.mesh), materials.props, { castShadow: true });
      obj.userData.center = t.center;
      propTiles.push(obj);
    }
    props.count = placements.length;
    props.tiles = propTiles.length;
    props.loaded = true;
  }

  return {
    root,
    byId,
    get meshCount() {
      return meshes.length + propTiles.length;
    },
    props,
    addProps,
    // Hides the prop tiles that are far from the camera.
    update(cameraPosition) {
      for (const obj of propTiles) {
        const [cx, cz] = obj.userData.center;
        obj.visible = Math.hypot(cx - cameraPosition.x, cz - cameraPosition.z) < PROP_DRAW_DISTANCE + 90;
      }
    },
  };
}

// Daylight for a big level. The shadow box follows the skater, because one
// shadow map cannot cover 2 km at a useful resolution. The shell turns the
// shadow map off on a geodata level for speed; the light keeps the setup
// for a faster machine.
export function createGeoLights() {
  const group = new THREE.Group();
  group.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a6a48, 0.7));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.5);
  const offset = new THREE.Vector3(30, 50, 20);
  sun.position.copy(offset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const r = 45;
  sun.shadow.camera.left = -r;
  sun.shadow.camera.right = r;
  sun.shadow.camera.top = r;
  sun.shadow.camera.bottom = -r;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.0005;
  group.add(sun);
  group.add(sun.target);
  return {
    group,
    sun,
    // Snap to whole meters, so the shadow edges do not shimmer.
    follow(x, z) {
      const sx = Math.round(x);
      const sz = Math.round(z);
      sun.target.position.set(sx, 0, sz);
      sun.position.set(sx + offset.x, offset.y, sz + offset.z);
    },
  };
}
