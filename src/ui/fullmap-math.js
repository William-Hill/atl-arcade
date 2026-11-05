// Pure math for the full map (src/ui/fullmap.js): the large map of the whole
// level that opens over the game, as in an open-world game. The player pans
// and zooms it. Vitest tests this module.
//
// World axes: +x east, +z south (meters). Screen axes: +x right, +y down
// (CSS pixels). North is up. A view is { x, z, zoom }: the world point at the
// center of the screen, and the screen pixels per world meter.

export const FULLMAP = {
  // The space (CSS px) around the level when the map fits the whole level.
  margin: 24,
  // The closest zoom, in screen pixels per meter: 2 screen pixels for each
  // base image pixel at most, so the map stays sharp.
  maxZoom: 4,
  // The zoom step of one key press or one button press.
  step: 1.4,
  // The pan step of one key press, as a fraction of the screen.
  pan: 0.15,
  // The base image pixels per meter. Higher than the minimap, so the map
  // stays sharp when the player zooms in.
  pxPerMeter: 2,
  maxTexture: 4096,
  // A street name shows when its street is at least this many times longer
  // on the screen than the name.
  labelRoom: 1.3,
  // The distance (m) between two names on one street, so a name is on the
  // screen at every zoom.
  labelEvery: 160,
  // A street piece shorter than this (m) gets no name.
  labelMin: 40,
};

// The view that shows the whole level in a screen of `w` by `h` pixels.
export function fitView(bounds, w, h, margin = FULLMAP.margin) {
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxZ - bounds.minZ;
  if (!(bw > 0) || !(bh > 0)) throw new Error("fitView: the bounds must have a positive size");
  const zoom = Math.min(Math.max(1, w - 2 * margin) / bw, Math.max(1, h - 2 * margin) / bh);
  return { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2, zoom };
}

// The view with the zoom between the fit zoom and FULLMAP.maxZoom, and the
// center inside the level, so the player cannot lose the level.
export function clampView(view, bounds, w, h) {
  const fit = fitView(bounds, w, h);
  const zoom = Math.min(Math.max(view.zoom, fit.zoom), Math.max(fit.zoom, FULLMAP.maxZoom));
  const x = Math.min(Math.max(view.x, bounds.minX), bounds.maxX);
  const z = Math.min(Math.max(view.z, bounds.minZ), bounds.maxZ);
  return { x, z, zoom };
}

export function worldToScreen(view, w, h, x, z) {
  return [w / 2 + (x - view.x) * view.zoom, h / 2 + (z - view.z) * view.zoom];
}

export function screenToWorld(view, w, h, sx, sy) {
  return [view.x + (sx - w / 2) / view.zoom, view.z + (sy - h / 2) / view.zoom];
}

// The view zoomed by `factor` with the world point under (sx, sy) kept under
// (sx, sy), as a mouse wheel or a pinch does.
export function zoomAt(view, w, h, sx, sy, factor) {
  const [wx, wz] = screenToWorld(view, w, h, sx, sy);
  const zoom = view.zoom * factor;
  return { x: wx - (sx - w / 2) / zoom, z: wz - (sy - h / 2) / zoom, zoom };
}

// The view moved by a drag of (dx, dy) screen pixels: the map follows the
// pointer.
export function panBy(view, dx, dy) {
  return { x: view.x - dx / view.zoom, z: view.z - dy / view.zoom, zoom: view.zoom };
}

// The 2D canvas transform [a, b, c, d, e, f] that draws a base image made
// with `frame` (minimap-math.js mapFrame()) in the view, for a canvas of
// `w` by `h` device pixels at `dpr` device pixels per CSS pixel.
export function baseTransform(frame, view, w, h, dpr = 1) {
  const k = (view.zoom * dpr) / frame.scale;
  const [ox, oy] = worldToScreen(view, w / dpr, h / dpr, frame.minX, frame.minZ);
  return [k, 0, 0, k, ox * dpr, oy * dpr];
}

function segLength(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

// The places for the street names. Each named street piece gets a name at
// its middle when it is short, or one name every `every` meters when it is
// long, with the angle of the segment there. The angle stays between -90
// and 90 degrees, so a name never reads upside down. `length` is the street
// length that the name can use. The longest spots come first, so the draw
// keeps them when two names overlap.
// Returns [{ name, x, z, angle, length }].
export function streetLabelSpots(strips, { every = FULLMAP.labelEvery, min = FULLMAP.labelMin } = {}) {
  const out = [];
  for (const s of strips ?? []) {
    if (s.kind !== "street" || !s.name || !(s.points?.length >= 2)) continue;
    const pts = s.points;
    let total = 0;
    for (let i = 1; i < pts.length; i += 1) total += segLength(pts[i - 1], pts[i]);
    if (total < min) continue;
    const count = Math.max(1, Math.floor(total / every));
    const room = total / count;
    for (let k = 0; k < count; k += 1) {
      let left = room * (k + 0.5);
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1];
        const b = pts[i];
        const l = segLength(a, b);
        if (left <= l || i === pts.length - 1) {
          const t = l > 0 ? Math.min(1, left / l) : 0;
          let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
          if (angle > Math.PI / 2) angle -= Math.PI;
          if (angle < -Math.PI / 2) angle += Math.PI;
          out.push({ name: s.name, x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, angle, length: room });
          break;
        }
        left -= l;
      }
    }
  }
  return out.sort((a, b) => b.length - a.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.x - b.x));
}

// True when a street name of `textWidth` CSS pixels fits on its street at
// this zoom.
export function labelFits(spot, zoom, textWidth, room = FULLMAP.labelRoom) {
  return spot.length * zoom >= textWidth * room;
}

// The icon nearest to the world point (x, z), inside `radius` meters, or
// null. For a click or a tap on the map.
export function nearestIcon(icons, x, z, radius) {
  let best = null;
  let bestD = radius;
  for (const icon of icons) {
    const d = Math.hypot(icon.x - x, icon.z - z);
    if (d <= bestD) {
      best = icon;
      bestD = d;
    }
  }
  return best;
}

// The isometric layer (src/level/geo/iso-map.js, scripts/bake-iso-map.mjs).
// Its map space is the image plane in meters: mx = a, mz = -b, so it uses
// the same views as the plan map. `info` is the iso.json of the bake.

// The bounds of the isometric image in map space.
export function isoBounds(info) {
  return { minX: info.a0, maxX: info.a0 + info.width * info.mpp, minZ: -info.b1, maxZ: -info.b1 + info.height * info.mpp };
}

// The pyramid level to draw at a zoom: the coarsest level that still has at
// least one image pixel for each screen pixel.
export function isoLevelFor(zoom, info) {
  const level = Math.floor(Math.log2(1 / (zoom * info.mpp)));
  return Math.min(Math.max(level, 0), info.levels - 1);
}

// The tiles of pyramid level `level` that the view shows, with the screen
// rectangle of each: [{ col, row, x, y, size }] in CSS pixels.
export function visibleTiles(view, w, h, info, level) {
  const tileMeters = info.tile * info.mpp * 2 ** level;
  const cols = Math.ceil(info.cols / 2 ** level);
  const rows = Math.ceil(info.rows / 2 ** level);
  const [x0, z0] = screenToWorld(view, w, h, 0, 0);
  const [x1, z1] = screenToWorld(view, w, h, w, h);
  const c0 = Math.max(0, Math.floor((x0 - info.a0) / tileMeters));
  const c1 = Math.min(cols - 1, Math.floor((x1 - info.a0) / tileMeters));
  const r0 = Math.max(0, Math.floor((z0 + info.b1) / tileMeters));
  const r1 = Math.min(rows - 1, Math.floor((z1 + info.b1) / tileMeters));
  const out = [];
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const [x, y] = worldToScreen(view, w, h, info.a0 + col * tileMeters, -info.b1 + row * tileMeters);
      out.push({ col, row, x, y, size: tileMeters * view.zoom });
    }
  }
  return out;
}
