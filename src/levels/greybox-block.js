// The greybox skate block. One street, two sidewalks with curbs, three rails,
// two ledges, a stair set and a quarter-pipe. Colored boxes and capsules only.
//
// Axes: +X runs along the street (call it east), +Z crosses it (north), +Y up.
// The street surface is y = 0. Every grindable object carries a spline along
// the line the skater actually rides.

import { arcPoints } from "../sim/level/spline.js";
import { validateLevel } from "../sim/level/level.js";

const STREET_HALF_WIDTH = 6;
const SIDEWALK_HEIGHT = 0.18;
const SIDEWALK_CENTRE_Z = 8.5;
const CURB_HEIGHT = 0.22;
const RAIL_HEIGHT = 0.65;
const RAIL_RADIUS = 0.06;

const curvedRail = arcPoints({
  center: { x: 18, y: 0, z: 4 },
  radius: 6,
  startAngle: Math.PI,
  endAngle: Math.PI * 1.5,
  y: RAIL_HEIGHT,
  segments: 8,
});

export const GREYBOX_BLOCK = {
  id: "greybox-block",
  name: "Greybox block",
  spawn: { position: { x: -20, y: 0, z: 0 }, yaw: Math.PI / 2 },
  // Fixed camera poses for the Playwright screenshot tests, so a reference
  // image only moves when the level moves.
  fixedCameras: {
    wide: { position: { x: -30, y: 20, z: 30 }, target: { x: 0, y: 0.5, z: 0 } },
    ramp: { position: { x: 10, y: 3.2, z: 9 }, target: { x: 25, y: 1.6, z: 0 } },
  },
  objects: [
    {
      id: "street",
      kind: "ground",
      color: 0x44444f,
      shape: { type: "box", position: { x: 0, y: -0.5, z: 0 }, size: { x: 64, y: 1, z: 40 } },
    },

    {
      id: "sidewalk-north",
      kind: "sidewalk",
      color: 0x5e5e72,
      shape: {
        type: "box",
        position: { x: 0, y: SIDEWALK_HEIGHT / 2, z: SIDEWALK_CENTRE_Z },
        size: { x: 48, y: SIDEWALK_HEIGHT, z: 5 },
      },
    },
    {
      id: "sidewalk-south",
      kind: "sidewalk",
      color: 0x5e5e72,
      shape: {
        type: "box",
        position: { x: 0, y: SIDEWALK_HEIGHT / 2, z: -SIDEWALK_CENTRE_Z },
        size: { x: 48, y: SIDEWALK_HEIGHT, z: 5 },
      },
    },
    {
      id: "curb-north",
      kind: "curb",
      color: 0x6d6d82,
      shape: {
        type: "box",
        position: { x: 0, y: CURB_HEIGHT / 2, z: STREET_HALF_WIDTH + 0.18 },
        size: { x: 48, y: CURB_HEIGHT, z: 0.36 },
      },
    },
    {
      id: "curb-south",
      kind: "curb",
      color: 0x6d6d82,
      shape: {
        type: "box",
        position: { x: 0, y: CURB_HEIGHT / 2, z: -STREET_HALF_WIDTH - 0.18 },
        size: { x: 48, y: CURB_HEIGHT, z: 0.36 },
      },
    },

    {
      id: "rail-straight",
      kind: "rail",
      color: 0xffc14d,
      shape: {
        type: "segments",
        radius: RAIL_RADIUS,
        points: [
          { x: -14, y: RAIL_HEIGHT, z: -3 },
          { x: -4, y: RAIL_HEIGHT, z: -3 },
        ],
      },
      spline: [
        { x: -14, y: RAIL_HEIGHT, z: -3 },
        { x: -4, y: RAIL_HEIGHT, z: -3 },
      ],
    },
    {
      id: "rail-kinked",
      kind: "rail",
      color: 0xffc14d,
      shape: {
        type: "segments",
        radius: RAIL_RADIUS,
        points: [
          { x: 2, y: RAIL_HEIGHT, z: -3 },
          { x: 8, y: RAIL_HEIGHT, z: -3 },
          { x: 12, y: RAIL_HEIGHT, z: -5.6 },
        ],
      },
      spline: [
        { x: 2, y: RAIL_HEIGHT, z: -3 },
        { x: 8, y: RAIL_HEIGHT, z: -3 },
        { x: 12, y: RAIL_HEIGHT, z: -5.6 },
      ],
    },
    {
      id: "rail-curved",
      kind: "rail",
      color: 0xffc14d,
      shape: { type: "segments", radius: RAIL_RADIUS, points: curvedRail },
      spline: curvedRail,
    },

    {
      id: "ledge-west",
      kind: "ledge",
      color: 0x8f8fa8,
      shape: {
        type: "box",
        position: { x: -13.5, y: SIDEWALK_HEIGHT + 0.25, z: SIDEWALK_CENTRE_Z },
        size: { x: 9, y: 0.5, z: 1.4 },
      },
      spline: [
        { x: -18, y: SIDEWALK_HEIGHT + 0.5, z: SIDEWALK_CENTRE_Z },
        { x: -9, y: SIDEWALK_HEIGHT + 0.5, z: SIDEWALK_CENTRE_Z },
      ],
    },
    {
      id: "ledge-east",
      kind: "ledge",
      color: 0x8f8fa8,
      shape: {
        type: "box",
        position: { x: 14, y: SIDEWALK_HEIGHT + 0.3, z: -SIDEWALK_CENTRE_Z },
        size: { x: 7, y: 0.6, z: 1.2 },
      },
      spline: [
        { x: 10.5, y: SIDEWALK_HEIGHT + 0.6, z: -SIDEWALK_CENTRE_Z },
        { x: 17.5, y: SIDEWALK_HEIGHT + 0.6, z: -SIDEWALK_CENTRE_Z },
      ],
    },

    {
      id: "stairs-west",
      kind: "stairs",
      color: 0x5c5c73,
      shape: {
        type: "stairs",
        position: { x: -24, y: 0, z: SIDEWALK_CENTRE_Z },
        steps: 5,
        rise: 0.2,
        run: 0.5,
        width: 5,
        yaw: 0,
      },
    },

    {
      id: "ramp-east",
      kind: "ramp",
      color: 0x59c2a6,
      shape: {
        type: "quarterPipe",
        position: { x: 24, y: 0, z: 0 },
        radius: 2.6,
        width: 10,
        yaw: 0,
      },
    },
  ],
};

validateLevel(GREYBOX_BLOCK);

export default GREYBOX_BLOCK;
