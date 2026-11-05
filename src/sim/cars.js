// The car-following model of the traffic (src/sim/traffic/traffic.js):
// the Intelligent Driver Model (IDM, Treiber, Hennecke and Helbing 2000),
// the lane centers of a street from its lane layout (src/level/geo/
// lanes.js), the brake light and turn signal states, and the crosswalk
// test for the skater. Pure: no Three.js, no state.

// IDM parameters. a and b match TRAFFIC.accel and TRAFFIC.brake; s0 is the
// bumper gap at a standstill (TRAFFIC.gap) and T the time gap (s) at speed.
export const IDM = {
  a: 1.5, // m/s^2, the largest acceleration
  b: 2.5, // m/s^2, the comfortable deceleration
  s0: 3, // m
  T: 1.4, // s
  delta: 4,
  maxBrake: 6, // m/s^2, the hard limit (TRAFFIC.hardBrake)
};

// The IDM acceleration (m/s^2) of a car at speed v (m/s) with desired speed
// v0, a free gap `gap` (m, bumper to bumper; Infinity on a free road) to a
// leader that is dv m/s slower (v - vLeader; a stop line or the skater is a
// leader at rest, dv = v). Clamped to [-p.maxBrake, p.a].
export function idmAccel(v, v0, gap = Infinity, dv = 0, p = IDM) {
  const free = 1 - Math.pow(Math.max(0, v) / Math.max(0.1, v0), p.delta);
  let inter = 0;
  if (Number.isFinite(gap)) {
    if (gap <= 0) return -p.maxBrake;
    const sStar =
      p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
    inter = (sStar / gap) ** 2;
  }
  return Math.max(-p.maxBrake, Math.min(p.a, p.a * (free - inter)));
}

// The acceleration toward a fixed point `dist` m ahead of the car front
// (a stop line, a crosswalk, the yield point before the skater): the IDM
// with a leader at rest whose rear is s0 - `rest` m past the point, so the
// car comes to rest `rest` m short of it.
export function idmStopAccel(v, v0, dist, rest = 0.3, p = IDM) {
  const d = dist - rest;
  let a = idmAccel(v, v0, d + p.s0, v, p);
  // The IDM reaches a stop point only asymptotically: slower than creep
  // the car rolls on at creep speed, and over the last half metre it
  // brakes to rest at the point.
  if (d > 0.5 && v < p.creep)
    a = Math.max(a, Math.min(p.a / 2, (p.creep - v) * 2));
  else if (d > 0 && d <= 0.5) a = Math.min(a, -(v * v) / (2 * d));
  else if (d <= 0) a = -p.maxBrake;
  return Math.max(-p.maxBrake, Math.min(p.a, a));
}

// The lane centers of a street strip (offsets to the right of the strip
// direction, as lanes.js and src/sim/npc/path.js): { forward, backward },
// each from the curb lane (k = 0) to the lane nearest the center or median.
// forward lanes run with the strip, backward lanes against it. `layout` is
// laneLayout(strip, oneway).
export function laneCenters(layout) {
  const { lane, forward, backward } = layout;
  const fwd = [];
  const back = [];
  if (layout.center === null || layout.center === undefined) {
    // One-way: the lanes fill the band between the edge lines.
    const base = (layout.edges[0] + layout.edges[1]) / 2 - (forward * lane) / 2;
    for (let k = forward - 1; k >= 0; k -= 1) fwd.push(base + (k + 0.5) * lane);
  } else {
    for (let k = forward - 1; k >= 0; k -= 1)
      fwd.push(layout.center + (k + 0.5) * lane);
    for (let k = backward - 1; k >= 0; k -= 1)
      back.push(layout.center - (k + 0.5) * lane);
  }
  return { forward: fwd, backward: back };
}

// The offsets of the lanes of one travel direction, in the frame of a run
// whose direction is `sign` (+1 with the strip, -1 against it): the curb
// lane first. On a one-way strip a run against the strip (a data quirk)
// mirrors the forward lanes.
export function runLaneOffsets(layout, sign) {
  const { forward, backward } = laneCenters(layout);
  if (sign >= 0) return forward;
  return (backward.length ? backward : forward)
    .map((o) => -o)
    .sort((x, y) => y - x);
}

// The turn signal for a heading change dyaw (rad, + is left) over the next
// stretch of the lane: 1 left, -1 right, 0 off. A signal stays on until the
// turn is under `off`, so it does not flicker at the threshold.
export function turnSignal(dyaw, current = 0, { on = 0.6, off = 0.3 } = {}) {
  if (dyaw > on) return 1;
  if (dyaw < -on) return -1;
  if (current !== 0 && Math.sign(dyaw) === current && Math.abs(dyaw) > off)
    return current;
  return 0;
}

// The brake light level (0 to 1) for an acceleration and a speed: a car
// at rest holds the brake, and a car that slows harder than `from` lights
// up toward full at the comfortable deceleration.
export function brakeLevel(
  accel,
  speed,
  { from = 0.3, full = IDM.b, hold = 0.8 } = {},
) {
  if (speed <= 0.05) return hold;
  if (accel >= -from) return 0;
  return Math.min(1, 0.4 + (0.6 * (-accel - from)) / (full - from));
}

// Is (x, z) on a crosswalk, or at its ends where a skater steps on it?
// cw: { x, z, dx, dz, depth, w } with (x, z) the center, (dx, dz) the unit
// direction along the crossed street, depth the size along the street, and
// w the street width.
export function onCrosswalk(cw, x, z, { margin = 0.8, curb = 1.5 } = {}) {
  const ux = x - cw.x;
  const uz = z - cw.z;
  const along = Math.abs(ux * cw.dx + uz * cw.dz);
  const across = Math.abs(-ux * cw.dz + uz * cw.dx);
  return along < cw.depth / 2 + margin && across < cw.w / 2 + curb;
}

// The heading change from a to b (rad) in (-PI, PI].
export function angleDelta(a, b) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}
