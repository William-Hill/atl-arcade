// Pure math for the minimap (#86). The DOM part (src/ui/minimap.js) draws
// the level once to a base image, then each frame draws that image with
// the transform from viewTransform(). Vitest tests this module.
//
// World axes: +x east, +z south (meters). Map axes: +x right, +y down
// (pixels of the base image). North is up on the base image.

import { LANDMARKS, interiorPoint } from "../level/geo/landmarks.js";

export const MINIMAP = {
  // Base image pixels per world meter, before the size limit.
  pxPerMeter: 1,
  // The largest side of the base image, in pixels.
  maxTexture: 2048,
  // The width of world that the map shows, in meters.
  viewMeters: 240,
};

// The frame of the base image: the world origin of pixel (0, 0), the scale,
// and the size in pixels. The scale gets smaller when the level is too big.
export function mapFrame(bounds, { pxPerMeter = MINIMAP.pxPerMeter, maxTexture = MINIMAP.maxTexture } = {}) {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxZ - bounds.minZ;
  if (!(w > 0) || !(h > 0)) throw new Error("mapFrame: the bounds must have a positive size");
  const scale = Math.min(pxPerMeter, maxTexture / w, maxTexture / h);
  return { minX: bounds.minX, minZ: bounds.minZ, scale, width: Math.ceil(w * scale), height: Math.ceil(h * scale) };
}

export function worldToMap(frame, x, z) {
  return [(x - frame.minX) * frame.scale, (z - frame.minZ) * frame.scale];
}

export function mapToWorld(frame, px, py) {
  return [px / frame.scale + frame.minX, py / frame.scale + frame.minZ];
}

// The skater forward direction is (cos yaw, -sin yaw) in (x, z)
// (src/sim/skate/controller.js). This is the clockwise screen angle from
// "up" to that direction on a north-up map.
export function headingAngle(yaw) {
  return Math.PI / 2 - yaw;
}

// The 2D canvas transform [a, b, c, d, e, f] that draws the base image with
// the skater at the center of a square view of `size` pixels.
// mode "north": north is up. mode "heading": the skater heading is up.
// `arrow` is the clockwise rotation of the skater arrow on the screen.
export function viewTransform(frame, skater, { mode = "north", size, viewMeters = MINIMAP.viewMeters }) {
  const [px, py] = worldToMap(frame, skater.x, skater.z);
  const k = size / (viewMeters * frame.scale);
  const rot = mode === "heading" ? -headingAngle(skater.yaw) : 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const a = k * cos;
  const b = k * sin;
  const c = -k * sin;
  const d = k * cos;
  const cx = size / 2;
  const cy = size / 2;
  return {
    matrix: [a, b, c, d, cx - (a * px + c * py), cy - (b * px + d * py)],
    arrow: mode === "heading" ? 0 : headingAngle(skater.yaw),
    // The clockwise screen angle of north (for the "N" mark on the ring).
    north: rot,
  };
}

// A world point on the view: [x, y] in view pixels.
export function projectToView(frame, view, x, z) {
  const [px, py] = worldToMap(frame, x, z);
  const [a, b, c, d, e, f] = view.matrix;
  return [a * px + c * py + e, b * px + d * py + f];
}

// The base image rectangle that covers a circle of radius r (map pixels)
// around (px, py), clipped to the image. Null when it is empty. The draw
// reads only this part of the base image.
export function cropRect(frame, px, py, r) {
  const x0 = Math.max(0, Math.floor(px - r));
  const y0 = Math.max(0, Math.floor(py - r));
  const x1 = Math.min(frame.width, Math.ceil(px + r));
  const y1 = Math.min(frame.height, Math.ceil(py + r));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// True when the view must draw again: the skater moved by `minPx` view
// pixels or more, the heading changed in heading mode, or the mode changed.
export function needsRedraw(prev, next, { minPx = 0.25, minAngle = 0.004, pxPerMeter = 1 } = {}) {
  if (!prev) return true;
  if (prev.mode !== next.mode) return true;
  const moved = Math.hypot(next.x - prev.x, next.z - prev.z) * pxPerMeter;
  if (moved >= minPx) return true;
  let turn = Math.abs(next.yaw - prev.yaw) % (Math.PI * 2);
  if (turn > Math.PI) turn = Math.PI * 2 - turn;
  return turn >= minAngle;
}

// The short label of a name: the first letter of each word, 3 letters or
// fewer. "Ponce City Market" -> "PCM".
export function initials(name) {
  return String(name ?? "")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0].toUpperCase())
    .join("")
    .slice(0, 3);
}

// The landmark icons: the landmark buildings (src/level/geo/landmarks.js)
// and the named parks. [{ id, kind: "landmark" | "park", name, label, x, z }].
export function mapLandmarks(level) {
  const out = [];
  for (const lm of LANDMARKS) {
    const b = (level.buildings ?? []).find((x) => x.name === lm.buildingName);
    const p = b ? interiorPoint(b) : null;
    if (p) out.push({ id: lm.id, kind: "landmark", name: lm.buildingName, label: initials(lm.buildingName), x: p[0], z: p[1] });
  }
  const seen = new Set();
  for (const a of level.areas ?? []) {
    if (a.kind !== "park" || !a.name || seen.has(a.name)) continue;
    const p = interiorPoint(a);
    if (!p) continue;
    seen.add(a.name);
    out.push({ id: a.id, kind: "park", name: a.name, label: initials(a.name), x: p[0], z: p[1] });
  }
  return out;
}

// The draw order and the line width (meters) of each strip kind. The trail
// is the widest line, so it shows by its width and not by its color only.
export const STRIP_STYLE = {
  street: { order: 1, width: 1 },
  sidewalk: { order: 0, width: 1 },
  path: { order: 2, width: 1 },
  trail: { order: 3, minWidth: 9 },
};

// The strips in draw order.
export function stripsInOrder(strips) {
  return [...(strips ?? [])].filter((s) => STRIP_STYLE[s.kind]).sort((a, b) => STRIP_STYLE[a.kind].order - STRIP_STYLE[b.kind].order);
}

// The line width of a strip on the base image, in pixels.
export function stripWidth(frame, strip) {
  const style = STRIP_STYLE[strip.kind];
  const meters = Math.max(strip.width ?? 4, style?.minWidth ?? 0);
  return Math.max(1, meters * frame.scale);
}
