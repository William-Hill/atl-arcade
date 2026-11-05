// Preview of the full PBR ground sets (#158, assets/textures/ground-pbr/) in
// the real game renderer (pbr look: the game's sun, sky, environment,
// shadows and post), without touching the shared game code. Open
// /scripts/assets/ground-pbr-preview.html?<the usual game params> and:
//   &groundpbr=0         the plain game (the BEFORE view)
//   &sets=kind:set,...   which set goes on which surface kind (default
//                        street:asphalt,sidewalk:sidewalk,path:sidewalk,trail:trail;
//                        at most 3 sets on one page, for the texture units)
//   &tier=high|phone     1024 or 512 px maps
//   &format=jpg|ktx2     the JPG maps or the KTX2 (UASTC) maps
//   &swatch=set&at=x,z&size=m  only a flat swatch of one set (a size x size
//                        m quad draped over the ground at x,z), in a plain
//                        MeshStandardMaterial with map/normalMap/aoMap/
//                        roughnessMap/metalnessMap: the contact sheet and the
//                        tiling check
//
// The surface override is the integration that docs/ground-textures-pbr.md
// describes for src/render/geo-view.js: the game's surface material, plus,
// on the mapped kinds, the albedo in place of the art color x scan detail,
// the normal map (u along world x, v along world z, as the ground detail of
// main), roughness and metalness from ORM G and B, and ORM R on the
// indirect light only.
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { SURFACE_COLORS } from "../../src/level/geo/geo-mesh.js";
import { ENV_LIGHT } from "../../src/render/look.js";
import { MAPS, TIERS, gpuBytes, mapFile, parseSets } from "./ground-pbr-sets.js";

const setInfo = import.meta.glob("../../assets/textures/ground-pbr/*/set.json", { eager: true, import: "default" });
const mapUrls = import.meta.glob("../../assets/textures/ground-pbr/*/*.{jpg,ktx2}", { eager: true, query: "?url", import: "default" });
const infoOf = (set) => setInfo[`../../assets/textures/ground-pbr/${set}/set.json`];
const urlOf = (set, map, tier, format) => mapUrls[`../../${mapFile(set, map, tier, format)}`];

const params = new URLSearchParams(location.search);
const on = params.get("groundpbr") !== "0";
const tier = params.get("tier") ?? "high";
const format = params.get("format") ?? "jpg";
const swatch = params.get("swatch");
const kinds = Object.keys(SURFACE_COLORS);
const sets = parseSets(params.get("sets"), kinds);
const setIds = swatch ? [swatch] : [...new Set(Object.values(sets))];
if (setIds.length > 3) throw new Error("ground-pbr preview: at most 3 sets on one page (texture units)");

// GLSL: tilt the view-space normal n by a normal map sample s (OpenGL
// convention). A copy of DETAIL_GLSL in src/render/look.js on main.
const DETAIL_GLSL = /* glsl */ `
vec3 pbrDetailNormal(vec3 n, vec3 tu, vec3 tv, vec3 s, float k) {
  vec3 m = s * 2.0 - 1.0;
  m.xy *= k;
  vec3 t = normalize(tu - n * dot(tu, n));
  vec3 b = normalize(tv - n * dot(tv, n) - t * dot(tv, t));
  return normalize(t * m.x + b * m.y + n * max(m.z, 0.05));
}`;

await import("../../src/main.js");
const info = { ready: false, on, tier, format, sets: swatch ? null : sets, swatch, maps: {}, swapped: 0 };
window.__groundPbr = info;

// The game's WebGL context, for the compressed formats it supports.
function ktx2Loader() {
  const gl = document.getElementById("stage").getContext("webgl2");
  const loader = new KTX2Loader().setTranscoderPath("/node_modules/three/examples/jsm/libs/basis/");
  return loader.detectSupport({ extensions: { has: (n) => !!gl.getExtension(n), get: (n) => gl.getExtension(n) } });
}

async function loadSet(set) {
  const loader = format === "ktx2" ? ktx2Loader() : new THREE.TextureLoader();
  const out = {};
  for (const map of MAPS) {
    const url = urlOf(set, map, tier, format);
    const t = await loader.loadAsync(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (format === "jpg") t.colorSpace = map === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    // KTX2: one byte a pixel for BC7 / ASTC, from the transcoded mip data.
    const gpu = t.isCompressedTexture ? t.mipmaps.reduce((s, m) => s + m.data.byteLength, 0) : gpuBytes(TIERS[tier], 4);
    const bytes = infoOf(set).files[url.split("/").pop().split("?")[0]];
    info.maps[`${set}/${map}`] = { url, bytes, gpu, format: t.format, colorSpace: t.colorSpace };
    out[map] = t;
  }
  return out;
}

const heightAt = (x, z) => {
  const s = window.__atl.level.sample(x, z);
  return typeof s === "number" ? s : (s?.height ?? 0);
};

// A size x size m quad on a 0.5 m grid, 4 cm over the ground, uv in world
// meters over the tile size (u along x, v along z).
function swatchMesh(set, maps, [cx, cz], size) {
  const tile = infoOf(set).tileMeters;
  const n = Math.ceil(size / 0.5);
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = cx - size / 2 + (size * i) / n;
      const z = cz - size / 2 + (size * j) / n;
      pos.push(x, heightAt(x, z) + 0.04, z);
      uv.push(x / tile, z / tile);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // The same albedo calibration as the surface material (color 0.72).
  const mat = new THREE.MeshStandardMaterial({
    map: maps.albedo,
    normalMap: maps.normal,
    aoMap: maps.orm,
    roughnessMap: maps.orm,
    metalnessMap: maps.orm,
    roughness: 1,
    metalness: 1,
    envMapIntensity: ENV_LIGHT.ground,
  });
  mat.color.setScalar(0.72);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `ground-pbr-swatch-${set}`;
  mesh.receiveShadow = true;
  return mesh;
}

// The game's surface material with the sets on the mapped kinds.
function surfaceMaterial(base, loaded) {
  const mat = base.clone();
  const mapped = kinds.filter((k) => sets[k]);
  const slot = (k) => setIds.indexOf(sets[k]);
  mat.onBeforeCompile = (shader, renderer) => {
    base.onBeforeCompile(shader, renderer);
    setIds.forEach((s, i) => {
      shader.uniforms[`uPbrAlb${i}`] = { value: loaded[s].albedo };
      shader.uniforms[`uPbrNor${i}`] = { value: loaded[s].normal };
      shader.uniforms[`uPbrOrm${i}`] = { value: loaded[s].orm };
      shader.uniforms[`uPbrTile${i}`] = { value: infoOf(s).tileMeters };
    });
    shader.uniforms.uPbrKindColor = { value: mapped.map((k) => new THREE.Vector3(...SURFACE_COLORS[k])) };
    shader.uniforms.uPbrKindSlot = { value: mapped.map(slot) };
    const pick = (v) => setIds.map((_, i) => `pbrSlot < ${i}.5 ? ${v}${i} :`).join(" ") + ` ${v}0`;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
${setIds.map((_, i) => `uniform sampler2D uPbrAlb${i};\nuniform sampler2D uPbrNor${i};\nuniform sampler2D uPbrOrm${i};\nuniform float uPbrTile${i};`).join("\n")}
uniform vec3 uPbrKindColor[${mapped.length}];
uniform float uPbrKindSlot[${mapped.length}];
float pbrSlot = -1.0;
float pbrK = 0.0;
vec3 pbrOrm = vec3(1.0);
${DETAIL_GLSL}`,
      )
      .replace(
        "#include <alphamap_fragment>",
        `#include <alphamap_fragment>
{
  for (int i = 0; i < ${mapped.length}; i++) {
    if (distance(vColor.rgb, uPbrKindColor[i]) < 0.01) pbrSlot = uPbrKindSlot[i];
  }
  // Only a face that points up (not a curb side: the maps are in world x, z).
  float up = dot(normalize(vNormal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
  pbrK = pbrSlot < -0.5 ? 0.0 : smoothstep(0.5, 0.85, up);
  // Sample every set at the top level, so the mipmap level is correct.
${setIds.map((_, i) => `  vec3 alb${i} = texture2D(uPbrAlb${i}, vGroundXZ / uPbrTile${i}).rgb;\n  vec3 orm${i} = texture2D(uPbrOrm${i}, vGroundXZ / uPbrTile${i}).rgb;`).join("\n")}
  vec3 alb = ${pick("alb")};
  pbrOrm = mix(vec3(1.0, roughness, metalness), ${pick("orm")}, pbrK);
  // The albedo replaces the art color x scan detail (same 0.72 calibration
  // and the same wet darkening).
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * alb * mix(1.0, 0.72, uWet), pbrK);
}`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, pbrOrm.g, pbrK);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, pbrOrm.b, pbrK);")
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
${setIds.map((_, i) => `  vec3 nor${i} = texture2D(uPbrNor${i}, vGroundXZ / uPbrTile${i}).rgb;`).join("\n")}
  vec3 tu = (viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
  vec3 tv = (viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
  if (pbrK > 0.0) normal = normalize(mix(normal, pbrDetailNormal(normal, tu, tv, ${pick("nor")}, 1.0), pbrK));
}`,
      )
      .replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= pbrOrm.r;
reflectedLight.indirectSpecular *= pbrOrm.r;`,
      );
  };
  mat.customProgramCacheKey = () => `${base.customProgramCacheKey()}-ground-pbr-${setIds.join("-")}-${mapped.join("-")}`;
  return mat;
}

if (on) {
  const scene = window.__atl.scene;
  const loaded = {};
  for (const s of setIds) loaded[s] = await loadSet(s);
  if (swatch) {
    const [x, z] = (params.get("at") ?? "311.5,-85.2").split(",").map(Number);
    scene.add(swatchMesh(swatch, loaded[swatch], [x, z], Number(params.get("size") ?? 16)));
  } else {
    let base = null;
    scene.traverse((o) => {
      if (!base && o.isMesh && o.name.startsWith("surface-")) base = o.material;
    });
    if (!base) throw new Error("ground-pbr preview: no surface mesh (needs a geo level)");
    const mat = surfaceMaterial(base, loaded);
    scene.traverse((o) => {
      if (o.isMesh && o.material === base) {
        o.material = mat;
        info.swapped += 1;
      }
    });
  }
  info.download = Object.values(info.maps).reduce((s, m) => s + m.bytes, 0);
  info.gpu = Object.values(info.maps).reduce((s, m) => s + m.gpu, 0);
}
info.ready = true;
