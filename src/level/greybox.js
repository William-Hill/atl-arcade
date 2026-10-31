// The greybox skate block, as data. Pure: no Three.js, no Rapier, no DOM.
//
// Axes: +x east along the street, +y up, +z south. Yaw 0 faces +x.
// Every object has a `kind`, a `position` (center) and, for boxes, a `size`.
// Rails and ledges expose a grind `spline` (start/end or points, with an
// optional control point for a curve). The ramp is a quarter pipe with a
// circular profile; `src/level/ramp.js` turns it into a mesh.
//
// Kinds: ground, ledge, rail, ramp, building, barrier.
// Only cones, crowds, and construction are obstacles (political rule), so the
// street ends are closed by construction barriers, not traffic.

export const COLORS = {
  street: 0x3b3b4d,
  sidewalk: 0x5c5c70,
  plaza: 0x6a6a84,
  ledge: 0x8d8da8,
  rail: 0xffc857,
  ramp: 0x4f9dde,
  building: 0x2a2a3a,
  barrier: 0xff7a1a,
};

const STEP_RISE = 0.17;
const stairs = [0, 1, 2, 3].map((i) => {
  const top = 1.0 - STEP_RISE * (i + 1);
  return {
    id: `stair-${i + 1}`,
    kind: "ground",
    position: [-22 + 0.2 + i * 0.4, top / 2, 10],
    size: [0.4, top, 8],
    color: COLORS.plaza,
  };
});

export const GREYBOX = {
  name: "greybox-block",
  spawn: { position: [-24, 0, 0], yaw: 0 },
  bounds: { minX: -32, maxX: 32, minZ: -18, maxZ: 22 },
  objects: [
    // Street and sidewalks. The sidewalk boxes are the curbs (0.15 m step).
    { id: "street", kind: "ground", position: [0, -0.5, 2], size: [64, 1, 44], color: COLORS.street },
    { id: "sidewalk-north", kind: "ground", position: [0, 0.075, -8], size: [64, 0.15, 4], color: COLORS.sidewalk },
    { id: "sidewalk-south", kind: "ground", position: [5, 0.075, 10], size: [54, 0.15, 8], color: COLORS.sidewalk },

    // Raised plaza at the west end of the south side, with a 4-step stair set.
    { id: "plaza", kind: "ground", position: [-27, 0.5, 10], size: [10, 1, 8], color: COLORS.plaza },
    ...stairs,

    // Two ledges on the sidewalks. The spline runs along the street-facing top edge.
    {
      id: "ledge-north",
      kind: "ledge",
      position: [-12, 0.35, -7],
      size: [8, 0.4, 0.6],
      color: COLORS.ledge,
      spline: { points: [[-16, 0.55, -6.7], [-8, 0.55, -6.7]] },
    },
    {
      id: "ledge-south",
      kind: "ledge",
      position: [12, 0.35, 7],
      size: [8, 0.4, 0.6],
      color: COLORS.ledge,
      spline: { points: [[8, 0.55, 6.7], [16, 0.55, 6.7]] },
    },

    // Three rails on the street: straight, kinked, curved.
    { id: "rail-straight", kind: "rail", radius: 0.05, color: COLORS.rail, spline: { points: [[-20, 0.6, -2], [-8, 0.6, -2]] } },
    { id: "rail-kinked", kind: "rail", radius: 0.05, color: COLORS.rail, spline: { points: [[-4, 0.6, 2.5], [3, 0.6, 2.5], [9, 0.6, 0]] } },
    { id: "rail-curved", kind: "rail", radius: 0.05, color: COLORS.rail, spline: { start: [14, 0.6, -1], control: [21, 0.6, -1], end: [21, 0.6, -5.5] } },

    // Quarter pipe at the east end. Flat at x = 26, vertical at x = 29, deck behind it.
    { id: "quarter-pipe", kind: "ramp", position: [26, 0, 0], radius: 3, width: 12, direction: 1, color: COLORS.ramp },
    { id: "deck", kind: "ground", position: [30.5, 1.5, 0], size: [3, 3, 12], color: COLORS.ramp },

    // Buildings close the block on the north and south.
    { id: "building-north", kind: "building", position: [0, 4, -14], size: [64, 8, 8], color: COLORS.building },
    { id: "building-south", kind: "building", position: [0, 4, 18], size: [64, 8, 8], color: COLORS.building },

    // Construction barriers close the street ends.
    { id: "barrier-west", kind: "barrier", position: [-31.5, 0.5, 0], size: [1, 1, 12], color: COLORS.barrier },
    { id: "barrier-east-north", kind: "barrier", position: [31, 0.5, -8], size: [2, 1, 4], color: COLORS.barrier },
    { id: "barrier-east-south", kind: "barrier", position: [31, 0.5, 8], size: [2, 1, 4], color: COLORS.barrier },
  ],
};

export function objectsOfKind(level, kind) {
  return level.objects.filter((o) => o.kind === kind);
}

export function grindables(level) {
  return level.objects.filter((o) => o.spline);
}
