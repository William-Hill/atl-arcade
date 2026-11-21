import * as THREE from "three";

// Renders the meshes of one object as a white silhouette on black into a
// small target and returns the mask (1 byte per pixel). Other meshes under
// the root (outline hulls, skates) keep their own material. The camera sits in front of the
// object, in its local frame: the skater faces local +x.
export function createSilhouette(renderer, size = 96) {
  const target = new THREE.WebGLRenderTarget(size, size);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pixels = new Uint8Array(size * size * 4);
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const clear = new THREE.Color();

  return function render(root, meshes) {
    const list = Array.isArray(meshes) ? meshes : [meshes];
    root.updateMatrixWorld(true);
    // The renderer updates a skeleton once per frame. This render can come
    // after the main render in the same frame, so update the bones here.
    for (const mesh of list) if (mesh.skeleton) mesh.skeleton.update();
    eye.set(3.4, 0.9, 0).applyMatrix4(root.matrixWorld);
    look.set(0, 0.85, 0).applyMatrix4(root.matrixWorld);
    camera.position.copy(eye);
    camera.up.set(0, 1, 0).transformDirection(root.matrixWorld);
    camera.lookAt(look);
    camera.updateMatrixWorld(true);

    const materials = list.map((mesh) => mesh.material);
    renderer.getClearColor(clear);
    const alpha = renderer.getClearAlpha();
    const prevTarget = renderer.getRenderTarget();
    for (const mesh of list) mesh.material = white;
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(root, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(clear, alpha);
    list.forEach((mesh, i) => (mesh.material = materials[i]));

    const mask = new Uint8Array(size * size);
    for (let i = 0; i < mask.length; i += 1) mask[i] = pixels[i * 4] > 127 ? 1 : 0;
    return mask;
  };
}

// Intersection over union of two masks.
export function maskIoU(a, b) {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] && b[i]) inter += 1;
    if (a[i] || b[i]) union += 1;
  }
  return union === 0 ? 0 : inter / union;
}
