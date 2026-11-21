// The low-poly toon car kit (issue #132): sedan, hatchback, pickup, van,
// taxi, box truck, and a city bus in the MARTA colors (white, blue, and orange; no logo, no
// text). Pure: plain arrays, no Three.js. Built in code, so there is no
// generated model and no provenance file.
//
// Each template faces +x, stands on y = 0, and has the size in CAR_SIZE
// (src/sim/traffic/traffic.js), the box that the skater collides with.
// Attributes: position, normal (flat), color, and paint. A vertex with
// paint 1 takes the instance body color; a vertex with paint 0 keeps its own
// color (glass, tires, lights). There is no police or emergency look: no
// light bar, and no black and white two-tone.

import { CAR_SIZE } from "../sim/traffic/traffic.js";

const GLASS = [0.2, 0.27, 0.36];
const TIRE = [0.11, 0.11, 0.12];
const TRIM = [0.3, 0.31, 0.33];
const HEAD = [1, 0.95, 0.77];
const TAIL = [0.86, 0.16, 0.2];
const SHADOW = [0.16, 0.17, 0.19];
const WHITE = [1, 1, 1];

function hex(h) {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}

function builder() {
  const positions = [];
  const normals = [];
  const colors = [];
  const paint = [];
  const indices = [];
  function quad(a, b, c, d, color, p) {
    // The flat normal of the face a-b-c-d (counterclockwise from outside).
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = d[0] - a[0];
    const vy = d[1] - a[1];
    const vz = d[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const base = positions.length / 3;
    for (const v of [a, b, c, d]) {
      positions.push(v[0], v[1], v[2]);
      normals.push(nx, ny, nz);
      colors.push(color[0], color[1], color[2]);
      paint.push(p);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // A six-face block from its bottom corners (x0..x1 at z ±w0) and its top
  // corners (tx0..tx1 at z ±w1). A taper of the top gives a windshield.
  function block({ x0, x1, y0, y1, w0, tx0 = x0, tx1 = x1, w1 = w0, z = 0 }, color, p = 0, { bottom = false } = {}) {
    const B = (x, s) => [x, y0, z + s * w0];
    const T = (x, s) => [x, y1, z + s * w1];
    quad(T(tx0, 1), T(tx1, 1), T(tx1, -1), T(tx0, -1), color, p); // top
    quad(B(x1, 1), B(x1, -1), T(tx1, -1), T(tx1, 1), color, p); // front (+x)
    quad(B(x0, -1), B(x0, 1), T(tx0, 1), T(tx0, -1), color, p); // back (-x)
    quad(B(x0, 1), B(x1, 1), T(tx1, 1), T(tx0, 1), color, p); // side +z
    quad(B(x1, -1), B(x0, -1), T(tx0, -1), T(tx1, -1), color, p); // side -z
    if (bottom) quad(B(x0, -1), B(x1, -1), B(x1, 1), B(x0, 1), color, p);
  }
  function shadow(length, width) {
    const l = length / 2 + 0.2;
    const w = width / 2 + 0.15;
    quad([-l, 0.02, w], [l, 0.02, w], [l, 0.02, -w], [-l, 0.02, -w], SHADOW, 0);
  }
  function wheels(xs, r, half, t = 0.26) {
    for (const x of xs) for (const s of [1, -1]) block({ x0: x - r, x1: x + r, y0: 0.03, y1: r * 2, w0: t / 2, z: s * (half - t / 2 + 0.04) }, TIRE);
  }
  function lights(front, back, y, half, h = 0.14) {
    for (const s of [1, -1]) {
      block({ x0: front - 0.04, x1: front + 0.03, y0: y, y1: y + h, w0: 0.15, z: s * (half - 0.28) }, HEAD);
      block({ x0: back - 0.03, x1: back + 0.04, y0: y, y1: y + h, w0: 0.13, z: s * (half - 0.25) }, TAIL);
    }
  }
  return {
    quad,
    block,
    shadow,
    wheels,
    lights,
    done() {
      return { positions, normals, colors, paint, indices };
    },
  };
}

function sedan() {
  const { length: L, width: W, height: H } = CAR_SIZE.sedan;
  const b = builder();
  const h = W / 2;
  b.shadow(L, W);
  b.block({ x0: -L / 2, x1: L / 2, y0: 0.3, y1: 0.82, w0: h }, WHITE, 1);
  b.block({ x0: -L / 2 + 0.05, x1: L / 2 - 0.05, y0: 0.25, y1: 0.42, w0: h + 0.02 }, TRIM);
  b.block({ x0: -1.25, x1: 0.95, y0: 0.82, y1: H - 0.05, w0: h - 0.08, tx0: -0.95, tx1: 0.45, w1: h - 0.2 }, GLASS);
  b.block({ x0: -0.97, x1: 0.47, y0: H - 0.06, y1: H, w0: h - 0.19 }, WHITE, 1);
  b.wheels([-1.4, 1.4], 0.32, h);
  b.lights(L / 2, -L / 2, 0.6, h);
  return b.done();
}

function hatchback() {
  const { length: L, width: W, height: H } = CAR_SIZE.hatchback;
  const b = builder();
  const h = W / 2;
  b.shadow(L, W);
  b.block({ x0: -L / 2, x1: L / 2, y0: 0.3, y1: 0.85, w0: h }, WHITE, 1);
  b.block({ x0: -L / 2 + 0.05, x1: L / 2 - 0.05, y0: 0.25, y1: 0.42, w0: h + 0.02 }, TRIM);
  b.block({ x0: -L / 2 + 0.1, x1: 0.85, y0: 0.85, y1: H - 0.05, w0: h - 0.08, tx0: -L / 2 + 0.25, tx1: 0.3, w1: h - 0.2 }, GLASS);
  b.block({ x0: -L / 2 + 0.23, x1: 0.32, y0: H - 0.06, y1: H, w0: h - 0.19 }, WHITE, 1);
  b.wheels([-1.25, 1.25], 0.31, h);
  b.lights(L / 2, -L / 2, 0.62, h);
  return b.done();
}

function pickup() {
  const { length: L, width: W, height: H } = CAR_SIZE.pickup;
  const b = builder();
  const h = W / 2;
  b.shadow(L, W);
  b.block({ x0: -L / 2, x1: L / 2, y0: 0.42, y1: 1.0, w0: h }, WHITE, 1);
  b.block({ x0: -L / 2 + 0.05, x1: L / 2 - 0.05, y0: 0.32, y1: 0.5, w0: h + 0.02 }, TRIM);
  // The cab, with a sloped windshield.
  b.block({ x0: -0.55, x1: 1.15, y0: 1.0, y1: H - 0.06, w0: h - 0.06, tx0: -0.5, tx1: 0.7, w1: h - 0.14 }, GLASS);
  b.block({ x0: -0.52, x1: 0.72, y0: H - 0.07, y1: H, w0: h - 0.13 }, WHITE, 1);
  // The open bed: two side walls and a tailgate.
  for (const s of [1, -1]) b.block({ x0: -L / 2, x1: -0.6, y0: 1.0, y1: 1.32, w0: 0.06, z: s * (h - 0.06) }, WHITE, 1);
  b.block({ x0: -L / 2, x1: -L / 2 + 0.1, y0: 1.0, y1: 1.32, w0: h - 0.06 }, WHITE, 1);
  b.wheels([-1.7, 1.55], 0.4, h, 0.3);
  b.lights(L / 2, -L / 2, 0.78, h);
  return b.done();
}

function van() {
  const { length: L, width: W, height: H } = CAR_SIZE.van;
  const b = builder();
  const h = W / 2;
  b.shadow(L, W);
  b.block({ x0: -L / 2, x1: L / 2, y0: 0.36, y1: 1.05, w0: h }, WHITE, 1);
  b.block({ x0: -L / 2 + 0.05, x1: L / 2 - 0.05, y0: 0.3, y1: 0.45, w0: h + 0.02 }, TRIM);
  b.block({ x0: -L / 2, x1: 1.35, y0: 1.05, y1: H, w0: h - 0.02 }, WHITE, 1);
  // The windshield slopes from the hood to the roof front.
  b.block({ x0: 1.35, x1: 1.95, y0: 1.05, y1: H - 0.1, w0: h - 0.05, tx0: 1.35, tx1: 1.42, w1: h - 0.08 }, GLASS);
  // A window band on each side.
  for (const s of [1, -1]) b.block({ x0: -1.9, x1: 1.25, y0: 1.38, y1: 1.8, w0: 0.02, z: s * (h - 0.005) }, GLASS);
  b.wheels([-1.65, 1.6], 0.36, h, 0.28);
  b.lights(L / 2, -L / 2, 0.72, h);
  return b.done();
}

// A plain yellow taxi with a teal stripe and a blank roof light, like
// assets/vehicles/taxi.glb. It keeps its own colors (no paint).
function taxi() {
  const { length: L, width: W, height: H } = CAR_SIZE.taxi;
  const b = builder();
  const h = W / 2;
  const yellow = hex(0xf5c518);
  b.shadow(L, W);
  b.block({ x0: -L / 2, x1: L / 2, y0: 0.3, y1: 0.84, w0: h }, yellow);
  b.block(
    { x0: -L / 2 + 0.05, x1: L / 2 - 0.05, y0: 0.25, y1: 0.42, w0: h + 0.02 },
    TRIM,
  );
  for (const s of [1, -1])
    b.block(
      { x0: -1.2, x1: 1.0, y0: 0.62, y1: 0.7, w0: 0.02, z: s * (h - 0.005) },
      hex(0x1aa59a),
    );
  b.block(
    {
      x0: -1.3,
      x1: 1.0,
      y0: 0.84,
      y1: 1.42,
      w0: h - 0.08,
      tx0: -1.0,
      tx1: 0.5,
      w1: h - 0.2,
    },
    GLASS,
  );
  b.block({ x0: -1.02, x1: 0.52, y0: 1.41, y1: 1.47, w0: h - 0.19 }, yellow);
  b.block({ x0: -0.45, x1: 0.15, y0: 1.47, y1: H, w0: 0.42 }, hex(0xf4f1ea));
  b.wheels([-1.45, 1.45], 0.32, h);
  b.lights(L / 2, -L / 2, 0.6, h);
  return b.done();
}

// A box truck: a painted cab and a white cargo box.
function boxTruck() {
  const { length: L, width: W, height: H } = CAR_SIZE.box_truck;
  const b = builder();
  const h = W / 2;
  const cab = L / 2 - 1.9;
  b.shadow(L, W);
  b.block({ x0: -L / 2, x1: L / 2, y0: 0.45, y1: 0.75, w0: h - 0.1 }, TRIM);
  b.block(
    { x0: -L / 2, x1: cab - 0.15, y0: 0.75, y1: H, w0: h },
    hex(0xf4f4f0),
  );
  b.block({ x0: cab, x1: L / 2, y0: 0.75, y1: 1.6, w0: h - 0.05 }, WHITE, 1);
  b.block(
    {
      x0: cab,
      x1: L / 2 - 0.25,
      y0: 1.6,
      y1: 2.6,
      w0: h - 0.08,
      tx1: L / 2 - 0.7,
      w1: h - 0.12,
    },
    GLASS,
  );
  b.block(
    { x0: cab, x1: L / 2 - 0.68, y0: 2.6, y1: 2.75, w0: h - 0.12 },
    WHITE,
    1,
  );
  b.wheels([-L / 2 + 1.6, L / 2 - 1.3], 0.48, h, 0.3);
  b.lights(L / 2, -L / 2, 0.85, h, 0.18);
  return b.done();
}

// A city bus in the MARTA colors: a white body, a blue band, and an orange
// line. It keeps its own colors (no paint).
function bus() {
  const { length: L, width: W, height: H } = CAR_SIZE.bus;
  const b = builder();
  const h = W / 2;
  const body = hex(0xf4f4f0);
  b.shadow(L, W);
  b.block({ x0: -L / 2, x1: L / 2, y0: 0.35, y1: H - 0.15, w0: h }, body);
  b.block({ x0: -L / 2 + 1, x1: L / 2 - 2, y0: H - 0.15, y1: H, w0: h - 0.35 }, hex(0xd9dbde));
  for (const s of [1, -1]) {
    b.block({ x0: -L / 2 + 0.6, x1: L / 2 - 1.1, y0: 1.55, y1: 2.55, w0: 0.02, z: s * (h - 0.005) }, GLASS);
    b.block({ x0: -L / 2 + 0.02, x1: L / 2 - 0.02, y0: 0.75, y1: 1.1, w0: 0.02, z: s * (h - 0.005) }, hex(0x1d4f9c));
    b.block({ x0: -L / 2 + 0.02, x1: L / 2 - 0.02, y0: 1.1, y1: 1.22, w0: 0.02, z: s * (h - 0.005) }, hex(0xf2892b));
  }
  b.block({ x0: L / 2 - 0.02, x1: L / 2 + 0.01, y0: 1.2, y1: 2.6, w0: h - 0.12 }, GLASS);
  b.block({ x0: -L / 2 - 0.01, x1: -L / 2 + 0.02, y0: 1.8, y1: 2.5, w0: h - 0.3 }, GLASS);
  b.wheels([-L / 2 + 2.6, L / 2 - 2.4], 0.5, h, 0.32);
  b.lights(L / 2, -L / 2, 0.75, h, 0.2);
  return b.done();
}

// The far shape: the lower body and the cabin as two blocks.
function farShape(kind) {
  const { length: L, width: W, height: H } = CAR_SIZE[kind];
  const b = builder();
  const h = W / 2;
  if (kind === "bus") {
    b.block({ x0: -L / 2, x1: L / 2, y0: 0.3, y1: H, w0: h }, hex(0xf4f4f0));
    return b.done();
  }
  if (kind === "box_truck") {
    b.block(
      { x0: -L / 2, x1: L / 2 - 2.05, y0: 0.45, y1: H, w0: h },
      hex(0xf4f4f0),
    );
    b.block(
      { x0: L / 2 - 1.9, x1: L / 2, y0: 0.45, y1: 2.75, w0: h - 0.05 },
      WHITE,
      1,
    );
    return b.done();
  }
  if (kind === "taxi") {
    b.block(
      { x0: -L / 2, x1: L / 2, y0: 0.25, y1: 0.84, w0: h },
      hex(0xf5c518),
    );
    b.block({ x0: -1.1, x1: 0.7, y0: 0.84, y1: H, w0: h - 0.15 }, GLASS);
    return b.done();
  }
  const split = kind === "van" ? 1.05 : kind === "pickup" ? 1.0 : 0.84;
  b.block({ x0: -L / 2, x1: L / 2, y0: 0.25, y1: split, w0: h }, WHITE, 1);
  if (kind === "van") b.block({ x0: -L / 2, x1: 1.6, y0: split, y1: H, w0: h - 0.02 }, WHITE, 1);
  else if (kind === "pickup") b.block({ x0: -0.55, x1: 1.0, y0: split, y1: H, w0: h - 0.1 }, GLASS);
  else b.block({ x0: kind === "hatchback" ? -L / 2 + 0.2 : -1.1, x1: 0.7, y0: split, y1: H, w0: h - 0.15 }, GLASS);
  return b.done();
}

const BUILD = { sedan, hatchback, pickup, van, taxi, box_truck: boxTruck, bus };

// { kind: template, `${kind}_lod1`: template } for every car kind.
export function carTemplates() {
  const out = {};
  for (const [kind, build] of Object.entries(BUILD)) {
    out[kind] = build();
    out[`${kind}_lod1`] = farShape(kind);
  }
  return out;
}

// The size of a template: { minX, maxX, minY, maxY, minZ, maxZ }.
export function templateBounds(t) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < t.positions.length; i += 3) {
    const [x, y, z] = [t.positions[i], t.positions[i + 1], t.positions[i + 2]];
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minY = Math.min(b.minY, y);
    b.maxY = Math.max(b.maxY, y);
    b.minZ = Math.min(b.minZ, z);
    b.maxZ = Math.max(b.maxZ, z);
  }
  return b;
}
