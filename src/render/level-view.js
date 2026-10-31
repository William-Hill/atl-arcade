import * as THREE from "three";
import { rampMesh } from "../level/ramp.js";
import { sampleSpline } from "../level/splines.js";

// Builds Three.js meshes from level data. Greybox look: flat colors, no
// textures. The simulation never sees any of this.

function material(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
}

function boxMesh(o) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.size[0], o.size[1], o.size[2]), material(o.color ?? 0x888888));
  mesh.position.set(o.position[0], o.position[1], o.position[2]);
  mesh.castShadow = o.kind !== "ground";
  mesh.receiveShadow = true;
  return mesh;
}

function railCurve(spline) {
  if (spline.points) {
    const path = new THREE.CurvePath();
    for (let i = 0; i < spline.points.length - 1; i += 1) {
      path.add(new THREE.LineCurve3(new THREE.Vector3(...spline.points[i]), new THREE.Vector3(...spline.points[i + 1])));
    }
    return path;
  }
  return new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(...spline.start),
    new THREE.Vector3(...spline.control),
    new THREE.Vector3(...spline.end),
  );
}

function railMesh(o) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: o.color ?? 0xffc857, roughness: 0.4, metalness: 0.3 });
  const radius = o.radius ?? 0.05;
  const curve = railCurve(o.spline);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 8, false), mat);
  tube.castShadow = true;
  group.add(tube);

  // Posts at the sampled points, down to the ground.
  for (const p of sampleSpline(o.spline, 4)) {
    const h = p[1];
    const post = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, h, 6), mat);
    post.position.set(p[0], h / 2, p[2]);
    post.castShadow = true;
    group.add(post);
  }
  return group;
}

function rampView(o) {
  const data = rampMesh(o, 16);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geom.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: o.color ?? 0x4f9dde, roughness: 0.9, side: THREE.DoubleSide }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createLevelView(level) {
  const root = new THREE.Group();
  root.name = level.name;
  const byId = new Map();
  for (const o of level.objects) {
    let obj;
    if (o.size) obj = boxMesh(o);
    else if (o.kind === "rail") obj = railMesh(o);
    else if (o.kind === "ramp") obj = rampView(o);
    else continue;
    obj.name = o.id;
    root.add(obj);
    byId.set(o.id, obj);
  }
  return { root, byId };
}

export function createLevelLights() {
  const group = new THREE.Group();
  const sky = new THREE.HemisphereLight(0x9fd0ff, 0x2a2a3a, 0.9);
  group.add(sky);
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
  sun.position.set(20, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  group.add(sun);
  return group;
}
