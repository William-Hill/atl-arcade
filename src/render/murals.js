import * as THREE from "three";
import { seededRandom } from "../level/geo/styles.js";

// The mural atlas: 16 original designs (4 x 4) drawn on a canvas from a
// seed. Murals, not graffiti: bold shapes, Atlanta motifs (peach, dogwood,
// the skyline, the BeltLine), and clean lettering. No third-party art.
//
// The pbr look loads a painted atlas instead (assets/murals, made by
// scripts/assets/mural-atlas.mjs): the same 16 cells and words, painted on
// brick or stucco with brush strokes and a dry-brush edge. The canvas atlas
// stays for the toon look and as the fallback (?murals=canvas, or when the
// image fails to load).

export const MURAL_ATLAS_URL = new URL("../../assets/murals/mural-atlas.jpg", import.meta.url).href;
// Roughness / 0.85 in gray (MeshStandardMaterial reads green), for a
// material with roughness ROUGHNESS.mural (look.js). See docs/murals.md.
export const MURAL_ROUGHNESS_URL = new URL("../../assets/murals/mural-roughness.jpg", import.meta.url).href;

const PALETTE = ["#ff6b35", "#ffd166", "#06d6a0", "#118ab2", "#ef476f", "#8338ec", "#f4a261", "#2a9d8f", "#fefae0", "#264653"];
// The words name no neighborhood (issue #80): a mural can stand on any wall
// of the level, so a neighborhood word can be wrong. "ATL" and "A-TOWN" name
// the city, and "BELTLINE" the trail: every mural is in the city and faces
// the trail (muralWalls() in geo-mesh.js).
export const MURAL_WORDS = ["ATL", "BELTLINE", "SKATE ATL", "DOGWOOD", "ROLL ON", "PEACH", "FLOW", "STRIDE", "GLIDE", "A-TOWN", "SUNSHINE", "GOOD VIBES", "SMOOTH", "SWAG SURF", "RINK", "SHINE"];

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

function peach(ctx, x, y, r, rand) {
  ctx.fillStyle = "#ffb07c";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff7b54";
  ctx.beginPath();
  ctx.arc(x + r * 0.25, y + r * 0.15, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4caf50";
  ctx.beginPath();
  ctx.ellipse(x + r * 0.3, y - r * 1.05, r * 0.45, r * 0.18, -0.6 + rand() * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

function dogwood(ctx, x, y, r) {
  ctx.fillStyle = "#fffaf0";
  for (let k = 0; k < 4; k += 1) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.32, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#9acd32";
  ctx.beginPath();
  ctx.arc(x, y, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

function skyline(ctx, s, rand, color) {
  ctx.fillStyle = color;
  let x = 0;
  while (x < s) {
    const w = s * (0.05 + rand() * 0.08);
    const h = s * (0.15 + rand() * 0.35);
    ctx.fillRect(x, s - h, w, h);
    x += w + s * 0.01;
  }
}

function drawCell(ctx, s, cell) {
  const rand = seededRandom(0x5eed + cell * 977);
  const c1 = pick(rand, PALETTE);
  const c2 = pick(rand, PALETTE);
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);

  const motif = cell % 4;
  if (motif === 0) {
    // Sun rays over a skyline.
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.arc(s / 2, s * 0.62, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fefae0";
    ctx.lineWidth = s * 0.02;
    for (let k = 0; k < 12; k += 1) {
      const a = Math.PI + (k / 11) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(s / 2 + Math.cos(a) * s * 0.28, s * 0.62 + Math.sin(a) * s * 0.28);
      ctx.lineTo(s / 2 + Math.cos(a) * s * 0.48, s * 0.62 + Math.sin(a) * s * 0.48);
      ctx.stroke();
    }
    skyline(ctx, s, rand, "#264653");
  } else if (motif === 1) {
    // Peaches and dogwood blossoms.
    for (let k = 0; k < 5; k += 1) peach(ctx, s * (0.15 + rand() * 0.7), s * (0.25 + rand() * 0.6), s * (0.08 + rand() * 0.06), rand);
    for (let k = 0; k < 6; k += 1) dogwood(ctx, s * rand(), s * rand(), s * (0.05 + rand() * 0.04));
  } else if (motif === 2) {
    // Bold chevrons, the trail as a ribbon.
    for (let k = 0; k < 6; k += 1) {
      ctx.fillStyle = pick(rand, PALETTE);
      const y = (k / 6) * s;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s / 2, y + s * 0.12);
      ctx.lineTo(s, y);
      ctx.lineTo(s, y + s * 0.08);
      ctx.lineTo(s / 2, y + s * 0.2);
      ctx.lineTo(0, y + s * 0.08);
      ctx.fill();
    }
  } else {
    // Big dots and waves.
    for (let k = 0; k < 14; k += 1) {
      ctx.fillStyle = pick(rand, PALETTE);
      ctx.beginPath();
      ctx.arc(s * rand(), s * rand(), s * (0.03 + rand() * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#fefae0";
    ctx.lineWidth = s * 0.025;
    for (let row = 0; row < 3; row += 1) {
      ctx.beginPath();
      for (let x = 0; x <= s; x += s / 40) ctx.lineTo(x, s * (0.3 + row * 0.2) + Math.sin((x / s) * Math.PI * 4 + row) * s * 0.04);
      ctx.stroke();
    }
  }

  // Lettering on a band.
  const word = MURAL_WORDS[cell % MURAL_WORDS.length];
  ctx.fillStyle = "rgba(38, 70, 83, 0.85)";
  ctx.fillRect(0, s * 0.06, s, s * 0.22);
  ctx.fillStyle = "#fefae0";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = s * 0.16;
  ctx.font = `900 ${size}px system-ui, sans-serif`;
  while (ctx.measureText(word).width > s * 0.9 && size > 8) {
    size -= 2;
    ctx.font = `900 ${size}px system-ui, sans-serif`;
  }
  ctx.fillText(word, s / 2, s * 0.17);
}

// Pure: "painted" (the assets/murals atlas) or "canvas" (drawn here).
// `murals` is ?murals=canvas|painted. With no `look`, the look comes from
// ?look and ?quality as in lookFor() (look.js); without them the GPU decides
// the tier, which this module cannot see, so it keeps the canvas atlas.
export function muralSource({ look = null, murals = null, lookParam = null, quality = null } = {}) {
  if (murals === "canvas" || murals === "painted") return murals;
  const l = look ?? (lookParam === "pbr" || lookParam === "toon" ? lookParam : quality === "high" ? "pbr" : "toon");
  return l === "pbr" ? "painted" : "canvas";
}

function urlParams() {
  const search = globalThis.location?.search ?? "";
  return new URLSearchParams(search);
}

// The painted atlas as a texture. If the image fails, the texture gets the
// canvas atlas.
function loadPaintedAtlas(size) {
  const tex = new THREE.TextureLoader().load(MURAL_ATLAS_URL, undefined, undefined, () => {
    tex.image = drawCanvasAtlas(size);
    tex.needsUpdate = true;
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.muralSource = "painted";
  return tex;
}

// The roughness atlas for the painted murals (a linear texture).
export function createMuralRoughness() {
  const tex = new THREE.TextureLoader().load(MURAL_ROUGHNESS_URL);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// `look` is the city look ("toon" or "pbr"); without it the URL decides
// (muralSource).
export function createMuralAtlas(size = 1024, { look = null } = {}) {
  const params = urlParams();
  const source = muralSource({ look, murals: params.get("murals"), lookParam: params.get("look"), quality: params.get("quality") });
  if (source === "painted") return loadPaintedAtlas(size);
  const tex = new THREE.CanvasTexture(drawCanvasAtlas(size));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.muralSource = "canvas";
  return tex;
}

function drawCanvasAtlas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const s = size / 4;
  for (let cell = 0; cell < 16; cell += 1) {
    ctx.save();
    ctx.translate((cell % 4) * s, Math.floor(cell / 4) * s);
    ctx.beginPath();
    ctx.rect(0, 0, s, s);
    ctx.clip();
    drawCell(ctx, s, cell);
    ctx.restore();
  }
  return canvas;
}
