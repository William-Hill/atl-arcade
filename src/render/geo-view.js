import * as THREE from "three";
import { buildGeoMeshes } from "../level/geo/geo-mesh.js";

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
  geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

export function createGeoView(level, meshes = buildGeoMeshes(level)) {
  const root = new THREE.Group();
  root.name = level.name;
  const gradientMap = toonRamp();
  const materials = {
    surface: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }),
    building: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }),
  };
  const byId = new Map();
  for (const { material, tile, mesh } of meshes) {
    const obj = new THREE.Mesh(geoGeometry(mesh), materials[material]);
    obj.name = `${material}-${tile}`;
    obj.castShadow = material === "building";
    obj.receiveShadow = true;
    obj.matrixAutoUpdate = false;
    root.add(obj);
    byId.set(obj.name, obj);
  }
  return { root, byId, meshCount: meshes.length };
}

// Daylight for a big level. The shadow box follows the skater, because one
// shadow map cannot cover 2 km at a useful resolution.
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
