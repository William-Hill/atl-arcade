import * as THREE from "three";
import { extrudeOutline } from "../sim/level/extrude.js";
import { segmentFrames, stairBoxes } from "../sim/level/parts.js";
import { quarterPipeOutline } from "../sim/level/quarter-pipe.js";

const QUARTER_PIPE_SEGMENTS = 16;

const KIND_COLORS = {
  ground: 0x44444f,
  sidewalk: 0x5e5e72,
  curb: 0x6d6d82,
  rail: 0xffc14d,
  ledge: 0x8f8fa8,
  ramp: 0x59c2a6,
  stairs: 0x5c5c73,
};

// Colored boxes and capsules, one group per level object, named by object id
// so a debug session can find anything by name.
export function buildLevelMeshes(level) {
  const root = new THREE.Group();
  root.name = `level:${level.id}`;

  for (const object of level.objects) {
    const group = new THREE.Group();
    group.name = object.id;
    group.userData.kind = object.kind;
    const material = materialFor(object);

    for (const mesh of meshesFor(object, material)) group.add(mesh);
    root.add(group);
  }
  return root;
}

function materialFor(object) {
  const color = object.color ?? KIND_COLORS[object.kind] ?? 0x808080;
  return new THREE.MeshStandardMaterial({
    color,
    roughness: object.kind === "rail" ? 0.35 : 0.9,
    metalness: object.kind === "rail" ? 0.6 : 0.05,
  });
}

function meshesFor(object, material) {
  const shape = object.shape;
  switch (shape.type) {
    case "box":
      return [boxMesh(shape.position, shape.size, shape.yaw ?? 0, material)];

    case "stairs":
      return stairBoxes(shape).map((box) => boxMesh(box.position, box.size, box.yaw, material));

    case "segments":
      return segmentFrames(shape.points).map((frame) => {
        const mesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(shape.radius, frame.length, 4, 12),
          material,
        );
        mesh.position.set(frame.center.x, frame.center.y, frame.center.z);
        mesh.quaternion.set(frame.rotation.x, frame.rotation.y, frame.rotation.z, frame.rotation.w);
        mesh.castShadow = true;
        return mesh;
      });

    case "quarterPipe": {
      const solid = extrudeOutline(quarterPipeOutline(shape.radius, QUARTER_PIPE_SEGMENTS), shape.width);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(solid.vertices.slice(), 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(shape.position.x, shape.position.y, shape.position.z);
      mesh.rotation.y = shape.yaw ?? 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return [mesh];
    }

    default:
      throw new Error(`level-mesh: unhandled shape ${shape.type}`);
  }
}

function boxMesh(position, size, yaw, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.set(position.x, position.y, position.z);
  mesh.rotation.y = yaw;
  mesh.castShadow = size.y > 0.3;
  mesh.receiveShadow = true;
  return mesh;
}

// The lighting rig for the block. Separate from the level data: data says
// where things are, this says how they are lit.
export function buildLevelLighting(scene) {
  scene.background = new THREE.Color(0x161626);
  scene.fog = new THREE.Fog(0x161626, 70, 170);

  const sky = new THREE.HemisphereLight(0xa8d4ff, 0x3a3a48, 1.25);
  scene.add(sky);

  const sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
  sun.position.set(-20, 30, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const frame = sun.shadow.camera;
  frame.left = -45;
  frame.right = 45;
  frame.top = 45;
  frame.bottom = -45;
  frame.far = 120;
  scene.add(sun);
  return { sky, sun };
}
