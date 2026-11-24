// The golden-hour rim of Found landmark buildings (#221). High tier only.
//
// A faint warm glow at the silhouette of each Found building, while the sun
// is low: an emissive overlay band just outside the walls, with a fresnel
// falloff (strong where a wall turns away from the camera, near 0 where it
// faces it). It never changes a building material or the grade
// (docs/art-direction-pbr.md section 11). One merged mesh, 1 draw call
// while it shows, 0 when it does not.
//
// The pure part (the walls, the golden-hour factor, which buildings) is
// src/landmarks/claim-fx.js.

import * as THREE from "three";
import { CLAIM_FX, linearColor, rimAlpha, rimWalls } from "../landmarks/claim-fx.js";
import { FX } from "./effects/fx.js";

const vertexShader = /* glsl */ `
  attribute float along;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vAlong;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vAlong = along;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vAlong;
  void main() {
    vec3 v = normalize(cameraPosition - vWorld);
    float f = 1.0 - abs(dot(normalize(vNormal), v));
    // The rim: the silhouette edges, a little stronger toward the roof line.
    float a = pow(f, 2.0) * mix(0.35, 1.0, vAlong) * uAlpha;
    if (a < 0.002) discard;
    // Additive: the color is already scaled by \`a\`, and the alpha is 1, so
    // the blend (src alpha, one) does not scale it a second time.
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// `level` has the buildings ({ id, outer, height }); `spots` are the
// spots of levels/<level>/landmarks.json (with `footprint`); `groundAt(x, z)` is the
// terrain height.
export function createLandmarkRim({ level, spots, groundAt = () => 0, k = CLAIM_FX }) {
  const byId = new Map((level.buildings ?? []).map((b) => [b.id, b]));
  const outlines = new Map();
  for (const s of spots) {
    const b = s.kind === "building" && typeof s.footprint?.building === "string" ? byId.get(s.footprint.building) : null;
    if (b) outlines.set(s.id, b);
  }

  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...linearColor(k.rim.color, FX.emissive.body)) }, uAlpha: { value: 0 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    // Both sides: the fresnel uses abs(N·V), so the winding does not matter.
    side: THREE.DoubleSide,
    fog: false,
    lights: false,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.name = "landmark-rim";
  mesh.frustumCulled = false;
  mesh.renderOrder = 999;
  mesh.visible = false;
  mesh.userData.overlay = true;
  let draws = 0;
  let lastDraws = 0;
  mesh.onAfterRender = () => {
    draws += 1;
  };

  let key = "";
  let shown = [];
  function build(ids) {
    const positions = [];
    const normals = [];
    const along = [];
    for (const id of ids) {
      const b = outlines.get(id);
      if (!b) continue;
      const base = Math.min(...b.outer.map(([x, z]) => groundAt(x, z)));
      const walls = rimWalls(b.outer, base, b.height ?? 10, k.rim.offset);
      positions.push(...walls.positions);
      normals.push(...walls.normals);
      for (let i = 1; i < walls.positions.length; i += 3) along.push((walls.positions[i] - base) / Math.max(1e-3, b.height ?? 10));
    }
    mesh.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute("along", new THREE.Float32BufferAttribute(along, 1));
    mesh.geometry = geo;
    shown = ids.filter((id) => outlines.has(id));
  }

  return {
    mesh,
    // Each frame: `ids` the Found buildings (rimBuildings()) and
    // `elevation` the sun elevation in degrees. The rim does not move, so a
    // pause needs nothing.
    update(ids, elevation) {
      lastDraws = draws;
      draws = 0;
      const next = ids.join(",");
      if (next !== key) {
        key = next;
        build(ids);
      }
      const alpha = rimAlpha(elevation, k);
      material.uniforms.uAlpha.value = alpha;
      mesh.visible = alpha > 0 && shown.length > 0;
    },
    get info() {
      return { visible: mesh.visible, alpha: material.uniforms.uAlpha.value, buildings: [...shown], draws: lastDraws, vertices: mesh.geometry.getAttribute("position")?.count ?? 0 };
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
