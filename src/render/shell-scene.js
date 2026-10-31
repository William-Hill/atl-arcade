import * as THREE from "three";

export const SHELL_GROUND_SIZE = 60;

// The placeholder scene for the shell: a ground plane, sky and sun light, and
// a grid so motion is readable. The greybox block replaces this in M0-02.
export function createShellScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10101c);
  scene.fog = new THREE.Fog(0x10101c, 40, 110);

  const sky = new THREE.HemisphereLight(0x9fd0ff, 0x2a2a3a, 0.9);
  scene.add(sky);

  const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
  sun.position.set(14, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(SHELL_GROUND_SIZE, SHELL_GROUND_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x3b3b4d, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = "ground";
  scene.add(ground);

  const grid = new THREE.GridHelper(SHELL_GROUND_SIZE, SHELL_GROUND_SIZE, 0x5a5a72, 0x2c2c3c);
  grid.position.y = 0.01;
  scene.add(grid);

  // A marker block so the orbit camera has something with volume to circle.
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({ color: 0xff5fb2, roughness: 0.6 }),
  );
  marker.position.set(0, 1, 0);
  marker.castShadow = true;
  marker.name = "marker";
  scene.add(marker);

  return { scene, ground, marker, sun };
}

export function createShellCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(12, 9, 16);
  camera.lookAt(0, 1, 0);
  return camera;
}
