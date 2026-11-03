import * as THREE from "three";

// The toon look for the skater, on both tiers:
//
// - A toon material with a 3-step ramp, in place of the PBR material of the
//   GLB. The color, the maps, the opacity, the vertex colors and the
//   emissive light stay (KEPT).
// - A rim light: the edges that face away from the camera get a little
//   light, so the skater stands out from the city.
// - An ink outline from an inverted hull: for each skinned mesh, a second
//   skinned mesh on the same skeleton and geometry, drawn with its back faces and moved out along its
//   normals. Its width grows with the distance, so it stays about 2 px wide.
//
// The low tier has no post chain and no ink pass, so the hull is its only
// outline. On the high tier the ink pass also draws the silhouette.

export const TOON = {
  // The ramp levels (0..255). The darkest step is the shadow side.
  ramp: [96, 180, 255],
  rim: { color: [1, 0.93, 0.82], strength: 0.38, power: 3 },
  // The hull width: the larger of `min` meters and `perMeter` meters for
  // each meter from the camera.
  outline: { color: 0x1a1420, min: 0.008, perMeter: 0.0024 },
};

// Pure: the ramp texels for a list of levels.
export function rampData(levels = TOON.ramp) {
  const data = new Uint8Array(levels.length * 4);
  levels.forEach((v, i) => {
    data.set([v, v, v, 255], i * 4);
  });
  return data;
}

// Pure: the hull width (m) at a view distance (m). The vertex shader uses
// the same formula.
export function outlineWidth(distance, { min, perMeter } = TOON.outline) {
  return Math.max(min, distance * perMeter);
}

let ramp = null;
function toonRamp() {
  if (!ramp) {
    ramp = new THREE.DataTexture(rampData(), TOON.ramp.length, 1, THREE.RGBAFormat);
    ramp.minFilter = THREE.NearestFilter;
    ramp.magFilter = THREE.NearestFilter;
    ramp.generateMipmaps = false;
    ramp.needsUpdate = true;
  }
  return ramp;
}

// The glTF material properties that the toon material keeps, when the
// source material has them. MeshToonMaterial has each of these.
export const KEPT = [
  "map",
  "opacity",
  "transparent",
  "alphaTest",
  "side",
  "vertexColors",
  "emissive",
  "emissiveIntensity",
  "emissiveMap",
  "normalMap",
  "normalMapType",
  "normalScale",
];

// A toon material with a rim light, from a glTF material.
export function toonMaterial(source) {
  const mat = new THREE.MeshToonMaterial({
    name: `${source.name ?? "skater"}-toon`,
    color: source.color ? source.color.clone() : new THREE.Color(1, 1, 1),
    gradientMap: toonRamp(),
  });
  for (const key of KEPT) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    // Colors and vectors are copied, so that the two materials do not share them.
    if (value.isColor || value.isVector2) mat[key].copy(value);
    else mat[key] = value;
  }
  const rim = TOON.rim;
  mat.userData.rim = { color: new THREE.Color(...rim.color), strength: rim.strength, power: rim.power };
  // A hook on the source material (the face decal of attachFace()) stays:
  // it runs first, then the rim. The rim lights the decal color too.
  const sourceHook = source.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? source.onBeforeCompile : null;
  const sourceKey = sourceHook && source.customProgramCacheKey ? source.customProgramCacheKey() : null;
  mat.onBeforeCompile = (shader, renderer) => {
    if (sourceHook) sourceHook.call(mat, shader, renderer);
    shader.uniforms.uRimColor = { value: mat.userData.rim.color };
    shader.uniforms.uRim = { value: new THREE.Vector2(rim.strength, rim.power) };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uRimColor;\nuniform vec2 uRim;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  // vViewPosition points from the surface to the camera.
  float facing = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
  float rimBand = smoothstep(0.55, 0.75, pow(1.0 - facing, uRim.y) * 4.0);
  totalEmissiveRadiance += uRimColor * uRim.x * rimBand * diffuseColor.rgb;
}`,
      );
  };
  const key = sourceKey ? `${sourceKey}+skater-toon-rim` : "skater-toon-rim";
  mat.customProgramCacheKey = () => key;
  return mat;
}

// The hull material: back faces in the ink color, moved out in view space.
export function outlineMaterial() {
  const o = TOON.outline;
  const mat = new THREE.MeshBasicMaterial({ color: o.color, side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: new THREE.Vector2(o.min, o.perMeter) };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform vec2 uOutline;").replace(
      "#include <project_vertex>",
      `#include <project_vertex>
{
  // objectNormal is the skinned normal (the skinning chunks run for a
  // skinned mesh). Move the vertex out along the view-space normal.
  vec3 vn = normalize(normalMatrix * objectNormal);
  mvPosition.xyz += vn * max(uOutline.x, -mvPosition.z * uOutline.y);
  gl_Position = projectionMatrix * mvPosition;
}`,
    );
  };
  mat.customProgramCacheKey = () => "skater-outline";
  return mat;
}

// An outline hull for one skinned mesh, added next to it.
function outlineHull(src) {
  const hull = new THREE.SkinnedMesh(src.geometry, outlineMaterial());
  hull.name = src.name ? `${src.name}-outline` : "skater-outline";
  hull.userData.outlineOf = src;
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.frustumCulled = src.frustumCulled;
  hull.position.copy(src.position);
  hull.quaternion.copy(src.quaternion);
  hull.scale.copy(src.scale);
  hull.bind(src.skeleton, src.bindMatrix);
  src.parent.add(hull);
  return hull;
}

// Gives a loaded skater (loadSkaterModel()) the toon materials and an
// outline hull for each skinned mesh. Returns the hull meshes.
export function toonSkater(loaded) {
  const meshes = [];
  loaded.root.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });
  for (const m of meshes) {
    m.material = Array.isArray(m.material) ? m.material.map(toonMaterial) : toonMaterial(m.material);
  }
  return meshes.filter((m) => m.isSkinnedMesh).map(outlineHull);
}
