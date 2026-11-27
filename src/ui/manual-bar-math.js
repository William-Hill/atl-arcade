// The manual balance bar (#330, docs/ux/trick-hud.md section 7). Pure:
// the marker place, the zones, the place of the bar beside the skater, the
// smoothing, and the pulse. src/ui/manual-bar.js draws it.

// The bar sizes in CSS px. `h` is the track height; `labelH` each end label.
export const MANUAL_BAR = Object.freeze({
  w: 16,
  h: { desktop: 180, compact: 160 },
  labelH: 16,
  gap: 56, // px from the skater hip to the bar center
  margin: 16, // px from each viewport edge (plus the safe-area inset)
  tau: 0.12, // s of the follow smoothing
  zones: [0.5, 0.8], // |m| at the zone edges
  pulseAt: 0.7, // |m| where the marker starts to pulse
  pulseHz: 2, // 3 Hz or less (WCAG 2.3.1)
  fixedDx: 120, // px right of the screen center with reduced motion
  showMs: 100,
  hideMs: 150,
  outMs: 300, // the marker stays at the end after a balance out
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The marker top in px from the track top: (m + 1) / 2 of the height. The
// input up makes m smaller, so it moves the marker up (to the top label).
export function markerTop(m, trackH) {
  const v = Number.isFinite(m) ? clamp(m, -1, 1) : 0;
  return ((v + 1) / 2) * trackH;
}

// The zone of a lean m: "safe" below 0.5, "warning" below 0.8, else "limit".
export function zoneOf(m, edges = MANUAL_BAR.zones) {
  const a = Math.abs(Number.isFinite(m) ? m : 0);
  if (a < edges[0]) return "safe";
  if (a < edges[1]) return "warning";
  return "limit";
}

// The whole height of the bar with its 2 end labels.
export const barHeight = (compact, k = MANUAL_BAR) => (compact ? k.h.compact : k.h.desktop) + 2 * k.labelH;

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// The rectangle of a bar of size (w, h) at the center (cx, cy).
export const rectAt = (cx, cy, w, h) => ({ x: cx - w / 2, y: cy - h / 2, w, h });

// The safe rectangle: the viewport less the margin and the insets.
export function safeRect(viewW, viewH, inset = { top: 0, right: 0, bottom: 0, left: 0 }, margin = MANUAL_BAR.margin) {
  return { x: margin + inset.left, y: margin + inset.top, w: viewW - 2 * margin - inset.left - inset.right, h: viewH - 2 * margin - inset.top - inset.bottom };
}

const inside = (r, safe) => r.x >= safe.x - 1e-6 && r.y >= safe.y - 1e-6 && r.x + r.w <= safe.x + safe.w + 1e-6 && r.y + r.h <= safe.y + safe.h + 1e-6;

// The side at the manual start: "right" if a bar at the right of the
// anchor fits in the safe rectangle, else "left". It does not change in one
// manual.
export function pickSide(anchor, { w, h }, safe, gap = MANUAL_BAR.gap) {
  const right = rectAt(anchor.x + gap, anchor.y, w, h);
  return right.x + right.w <= safe.x + safe.w ? "right" : "left";
}

// The target center of the bar: `gap` px to the `side` of the anchor, at
// the anchor height, inside the safe rectangle, off every blocker (the HUD
// column, the touch buttons, the stick base, the minimap). If the place at
// the anchor height hits a blocker, the bar moves up or down in 8 px steps;
// if no place is free, it stays at the clamped place.
export function barTarget(anchor, side, { w, h }, safe, blockers = [], gap = MANUAL_BAR.gap) {
  const cx0 = anchor.x + (side === "left" ? -gap : gap);
  const cx = clamp(cx0, safe.x + w / 2, safe.x + safe.w - w / 2);
  const cy0 = clamp(anchor.y, safe.y + h / 2, safe.y + safe.h - h / 2);
  const free = (cy) => {
    const r = rectAt(cx, cy, w, h);
    return inside(r, safe) && !blockers.some((b) => overlaps(r, b));
  };
  if (free(cy0)) return { x: cx, y: cy0 };
  for (let d = 8; d <= safe.h; d += 8) {
    if (free(cy0 - d)) return { x: cx, y: cy0 - d };
    if (free(cy0 + d)) return { x: cx, y: cy0 + d };
  }
  return { x: cx, y: cy0 };
}

// The follow smoothing: each axis moves 1 - exp(-dt / tau) of the distance.
export function smoothToward(cur, target, dt, tau = MANUAL_BAR.tau) {
  if (!cur) return { ...target };
  const a = 1 - Math.exp(-Math.max(0, dt) / tau);
  return { x: cur.x + (target.x - cur.x) * a, y: cur.y + (target.y - cur.y) * a };
}

// With reduced motion the bar does not follow the skater: it stays 120 px
// right of the screen center, at the center height, inside the safe rectangle.
export function fixedPlace(viewW, viewH, { w, h }, safe, k = MANUAL_BAR) {
  return { x: clamp(viewW / 2 + k.fixedDx, safe.x + w / 2, safe.x + safe.w - w / 2), y: clamp(viewH / 2, safe.y + h / 2, safe.y + safe.h - h / 2) };
}

// The marker look near the limit. At |m| >= 0.7 the opacity goes
// 1 -> 0.55 -> 1 at 2 Hz. With reduced motion: no pulse, an alert mark.
export function markerLook(m, tSec, reducedMotion = false, k = MANUAL_BAR) {
  const near = Math.abs(Number.isFinite(m) ? m : 0) >= k.pulseAt - 1e-9;
  if (!near) return { opacity: 1, alert: false, near: false };
  if (reducedMotion) return { opacity: 1, alert: true, near: true };
  const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * k.pulseHz * tSec);
  return { opacity: 1 - 0.45 * wave, alert: false, near: true };
}
