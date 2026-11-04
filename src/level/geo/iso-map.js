// The isometric map of a level: one orthographic camera, 30 degrees down,
// that renders the whole level into one large image, cut into tiles. The
// full map (src/ui/fullmap.js) shows the tiles. The idea comes from
// Isometric Toronto (iso.sloptoronto.ca) and Isometric NYC: one fixed
// camera, so every place in the image is where it is in the city, and the
// tiles join with no seams. We render our own level (OpenStreetMap,
// Overture, Atlanta open data), not Google data. Pure.
//
// World axes: +x east, +y up, +z south (meters). The camera looks along
// `d`. `r` is the screen right and `u` the screen up. A world point has the
// plane coordinates a = p . r and b = p . u (meters). An image pixel is
// ((a - a0) / mpp, (b1 - b) / mpp).

export const ISO = {
  // The camera turn around the up axis (degrees). 45 looks to the north-west,
  // so the sun of src/render/look.js (from the south-east) lights the faces
  // that the camera sees.
  yaw: 45,
  // Degrees down from the horizon.
  pitch: 30,
  // Meters per image pixel at the full resolution.
  mpp: 0.5,
  // The tile side, in pixels.
  tile: 256,
  // The extra pixels on each side of a render, cut off after. The screen
  // space passes (AO, ink) need pixels past the tile edge, or the tiles do
  // not join.
  margin: 64,
  // The zoom levels of the tile pyramid. Level 0 is the full resolution;
  // each next level has half the pixels on each side.
  levels: 4,
};

// The camera basis for a yaw and a pitch in degrees: the view direction `d`
// (from the camera into the scene), the screen right `r`, and the screen up
// `u`. They are unit vectors at right angles.
export function isoBasis(yaw = ISO.yaw, pitch = ISO.pitch) {
  const y = (yaw * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  const d = [-Math.sin(y) * Math.cos(p), -Math.sin(p), -Math.cos(y) * Math.cos(p)];
  const r = [Math.cos(y), 0, -Math.sin(y)];
  // u = r x d
  const u = [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]];
  return { d, r, u };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The plane coordinates [a, b] (meters) of a world point.
export function isoProject(basis, x, y, z) {
  const p = [x, y, z];
  return [dot(p, basis.r), dot(p, basis.u)];
}

// The image of a level: the plane box of the level bounds from `minY` to
// `maxY` (the lowest ground and the highest roof), rounded out to whole
// tiles. Returns { a0, b1, mpp, tile, cols, rows, width, height }.
export function isoGrid(bounds, minY, maxY, { basis = isoBasis(), mpp = ISO.mpp, tile = ISO.tile } = {}) {
  let a0 = Infinity;
  let a1 = -Infinity;
  let b0 = Infinity;
  let b1 = -Infinity;
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const z of [bounds.minZ, bounds.maxZ]) {
      for (const y of [minY, maxY]) {
        const [a, b] = isoProject(basis, x, y, z);
        a0 = Math.min(a0, a);
        a1 = Math.max(a1, a);
        b0 = Math.min(b0, b);
        b1 = Math.max(b1, b);
      }
    }
  }
  const side = tile * mpp;
  const cols = Math.ceil((a1 - a0) / side);
  const rows = Math.ceil((b1 - b0) / side);
  // Whole pixels: the origin is on the pixel grid of the plane, so a bake at
  // another time gives the same pixels.
  a0 = Math.floor(a0 / mpp) * mpp;
  b1 = Math.ceil(b1 / mpp) * mpp;
  return { a0, b1, mpp, tile, cols, rows, width: cols * tile, height: rows * tile };
}

// The image pixel [px, py] of a world point.
export function isoPixel(grid, basis, x, y, z) {
  const [a, b] = isoProject(basis, x, y, z);
  return [(a - grid.a0) / grid.mpp, (grid.b1 - b) / grid.mpp];
}

// The plane coordinates of the center of tile (col, row).
export function tileCenter(grid, col, row) {
  const side = grid.tile * grid.mpp;
  return [grid.a0 + (col + 0.5) * side, grid.b1 - (row + 0.5) * side];
}

// The camera for one render: the camera stands on the view line through the
// plane point (a, b), where that line meets the height `groundY`, so the
// game draws the full detail around it (its detail depends on the camera
// position). An orthographic camera with a negative near plane still sees
// the roofs between the camera and the sky.
// Returns { position, target, up } as [x, y, z] arrays.
export function isoCameraPose(basis, a, b, groundY) {
  const { d, r, u } = basis;
  // The view line: p(s) = r * a + u * b + d * s. Find s where p.y = groundY.
  const s = (groundY - u[1] * b) / d[1];
  const position = [0, 1, 2].map((k) => r[k] * a + u[k] * b + d[k] * s);
  const target = position.map((v, k) => v + d[k]);
  return { position, target, up: u };
}

// The tiles of one pyramid level: level 0 is the grid; each next level has
// half the columns and rows, rounded up. Returns [{ level, cols, rows }].
export function pyramid(grid, levels = ISO.levels) {
  const out = [];
  let cols = grid.cols;
  let rows = grid.rows;
  for (let level = 0; level < levels; level += 1) {
    out.push({ level, cols, rows });
    cols = Math.ceil(cols / 2);
    rows = Math.ceil(rows / 2);
  }
  return out;
}

// The world point [x, y, z] under the plane point (a, b): where the view
// line meets the ground. `groundAt(x, z)` is the ground height. The view
// line crosses the ground at a slope, so a few steps find the point.
export function isoUnproject(basis, a, b, groundAt, steps = 6) {
  const { d, r, u } = basis;
  let y = groundAt(r[0] * a + u[0] * b, r[2] * a + u[2] * b);
  let p = null;
  for (let i = 0; i < steps; i += 1) {
    const s = (y - u[1] * b) / d[1];
    p = [0, 1, 2].map((k) => r[k] * a + u[k] * b + d[k] * s);
    y = groundAt(p[0], p[2]);
  }
  return [p[0], y, p[2]];
}
