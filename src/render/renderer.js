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
  camera.aspect = width / height;
  // A short landscape screen (a phone on its side) gets a narrower view, so
  // the skater is large enough to read (#73).
  camera.fov = fovFor(width, height);
  camera.updateProjectionMatrix();
}
