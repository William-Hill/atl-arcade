import * as THREE from "three";
import { seededRandom } from "../level/geo/styles.js";

// The mural atlas: 16 original designs (4 x 4) drawn on a canvas from a
// seed. Murals, not graffiti: bold shapes, Atlanta motifs (peach, dogwood,
// the skyline, the BeltLine), and clean lettering. No third-party art.

const PALETTE = ["#ff6b35", "#ffd166", "#06d6a0", "#118ab2", "#ef476f", "#8338ec", "#f4a261", "#2a9d8f", "#fefae0", "#264653"];
const WORDS = ["ATL", "BELTLINE", "SKATE ATL", "O4W", "ROLL ON", "PEACH", "INMAN", "PONCE", "GLIDE", "A-TOWN", "SWEET AUBURN", "KROG", "OLD 4TH WARD", "SWAG SURF", "RINK", "SHINE"];

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
  const word = WORDS[cell % WORDS.length];
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

export function createMuralAtlas(size = 1024) {
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
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
