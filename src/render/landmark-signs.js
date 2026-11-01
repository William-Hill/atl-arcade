import * as THREE from "three";

// Canvas textures for landmark signs: plain block letters on a flat color.
// This is plain type, not a logo or a trademark artwork.

export function createSignTexture(text, { color = "#f2c230", background = "#2b2e33", width = 2048, height = 256, weight = 900 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  g.fillStyle = background;
  g.fillRect(0, 0, width, height);
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = height * 0.82;
  g.font = `${weight} ${size}px "Arial Black", system-ui, sans-serif`;
  while (g.measureText(text).width > width * 0.96 && size > 10) {
    size -= 4;
    g.font = `${weight} ${size}px "Arial Black", system-ui, sans-serif`;
  }
  g.fillText(text, width / 2, height / 2 + size * 0.04);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
