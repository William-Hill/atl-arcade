// The canvas drawing of a landmark spot icon (#218). The shapes, the colors
// and the glyph strokes are in src/ui/landmark-icons.js (pure); this file
// only puts them on a 2D context. The minimap, the full map, the legend and
// the Guide tab all draw with drawSpotIcon(), so an icon looks the same in
// every place and in both looks (the maps are 2D, not part of the 3D scene).

import { CHECK, GLYPH, ICON_COLORS, ICON_STYLES, glyphStrokes } from "./landmark-icons.js";

function strokeLines(ctx, lines, scale) {
  ctx.beginPath();
  for (const line of lines) {
    line.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x * scale, y * scale);
      else ctx.lineTo(x * scale, y * scale);
    });
  }
  ctx.stroke();
}

// Draws the icon of `icon` ({ kind, look }) with its center at (x, y).
// `size` is the outer width of the shape in canvas pixels. `angle` is the
// clockwise screen angle of the edge arrow from "right". `pulse` is
// pulseAt() or null.
export function drawSpotIcon(ctx, icon, x, y, size, { angle = 0, pulse = null } = {}) {
  const style = ICON_STYLES[icon.look] ?? ICON_STYLES.unknown;
  ctx.save();
  ctx.translate(x, y);
  if (pulse) {
    ctx.save();
    ctx.globalAlpha = pulse.ring.alpha;
    ctx.strokeStyle = ICON_COLORS.gold;
    ctx.lineWidth = size * 0.1;
    ctx.beginPath();
    ctx.arc(0, 0, size * pulse.ring.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.scale(pulse.scale, pulse.scale);
  }
  const line = style.line * size;
  const r = size / 2 - line / 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  if (style.shape === "square") ctx.rect(-r, -r, r * 2, r * 2);
  else ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = style.fill;
  ctx.fill();
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = line;
  if (style.dashed) {
    // 8 dashes around the circle, with butt ends so the gaps stay open.
    const dash = (Math.PI * 2 * r) / 16;
    ctx.lineCap = "butt";
    ctx.setLineDash([dash, dash]);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = "round";

  if (style.mark === "?") {
    ctx.fillStyle = style.markColor;
    ctx.font = `800 ${Math.max(8, Math.round(size * 0.62))}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", 0, size * 0.04);
  } else {
    ctx.save();
    if (style.mark === "arrow") ctx.rotate(angle);
    ctx.strokeStyle = style.markColor;
    ctx.lineWidth = Math.max(1, GLYPH.line * size);
    strokeLines(ctx, glyphStrokes(style.mark === "arrow" ? "edge" : icon.kind), GLYPH.box * size);
    ctx.restore();
  }

  if (style.check) {
    ctx.translate(CHECK.at[0] * size, CHECK.at[1] * size);
    ctx.fillStyle = ICON_COLORS.ink;
    ctx.beginPath();
    ctx.arc(0, 0, CHECK.r * size, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ICON_COLORS.white;
    ctx.lineWidth = Math.max(1, CHECK.line * size);
    strokeLines(ctx, [CHECK.mark], size);
  }
  ctx.restore();
}

// A small canvas with one icon, for the legend and the Guide tab rows.
// `size` is in CSS pixels. The canvas is decoration (aria-hidden): the text
// beside it says the state.
export function iconCanvas(icon, size = 24) {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  // Room for the check mark, which goes past the circle.
  const box = Math.ceil(size * 1.25);
  const c = document.createElement("canvas");
  c.className = "spot-icon";
  c.width = Math.round(box * dpr);
  c.height = Math.round(box * dpr);
  c.style.width = `${box}px`;
  c.style.height = `${box}px`;
  c.setAttribute("aria-hidden", "true");
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  drawSpotIcon(ctx, icon, box / 2, box / 2, size);
  return c;
}
