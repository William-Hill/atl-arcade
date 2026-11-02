import * as THREE from "three";

// Canvas textures for landmark signs: plain block letters on a flat color,
// or on a transparent background (background "transparent"). This is plain
// type, not a logo or a trademark artwork.

export function createSignTexture(text, { color = "#f2c230", background = "#2b2e33", width = 2048, height = 256, weight = 900, condensed = false, outline = null } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (background !== "transparent") {
    g.fillStyle = background;
    g.fillRect(0, 0, width, height);
  }
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = condensed ? height * 0.95 : height * 0.82;
  const family = condensed ? '"DIN Condensed", "Arial Narrow", Impact, sans-serif' : '"Arial Black", system-ui, sans-serif';
  g.font = `${condensed ? 700 : weight} ${size}px ${family}`;
  // Condensed letters keep the full height and squeeze to the width below.
  while (!condensed && g.measureText(text).width > width * 0.96 && size > 10) {
    size -= 4;
    g.font = `${weight} ${size}px ${family}`;
  }
  if (condensed) {
    // Tall, narrow block letters: draw wide, then squeeze to fit.
    const w = g.measureText(text).width;
    const scale = Math.min(1, (width * 0.96) / w);
    g.save();
    g.translate(width / 2, height / 2 + size * 0.04);
    g.scale(scale, 1);
    // `outline`: a light edge around each letter, like the returns of
    // channel letters.
    if (outline) {
      g.strokeStyle = outline;
      g.lineWidth = Math.max(2, size * 0.05);
      g.lineJoin = "round";
      g.strokeText(text, 0, 0);
    }
    g.fillText(text, 0, 0);
    g.restore();
  } else {
    g.fillText(text, width / 2, height / 2 + size * 0.04);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
