import * as THREE from "three";
import { fovFor } from "../ui/layout.js";

// Renderer plus the resize wiring. Rendering lives here; the simulation never
// imports this file.
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

export function fitToWindow(renderer, camera) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  if (camera.isOrthographicCamera) {
    // The isometric bake: a fixed size in meters for each CSS pixel.
    const mpp = camera.userData.mpp ?? 1;
    camera.left = (-width * mpp) / 2;
    camera.right = (width * mpp) / 2;
    camera.top = (height * mpp) / 2;
    camera.bottom = (-height * mpp) / 2;
    camera.updateProjectionMatrix();
    return;
  }
  camera.aspect = width / height;
  // A short landscape screen (a phone on its side) gets a narrower view, so
  // the skater is large enough to read (#73).
  camera.fov = fovFor(width, height);
  camera.updateProjectionMatrix();
}
