// Builds a scripted input list that rides along a strip line (the BeltLine
// trail) with the pure controller. Pure. The script is open loop: the
// browser replays the same inputs, and the fixed step makes the result the
// same, so the test can compare the two runs.

import { createSkateState, stepSkate, yawFromHeading } from "../sim/skate/controller.js";
import { SKATE } from "../sim/skate/constants.js";

const near = (a, b) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;

// Joins the strips of one kind into polylines, end to end.
export function chainStrips(strips, kind) {
  const open = strips.filter((s) => s.kind === kind).map((s) => s.points.slice());
  const lines = [];
  while (open.length) {
    let line = open.shift();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < open.length; i += 1) {
        const p = open[i];
        if (near(line[line.length - 1], p[0])) line = line.concat(p.slice(1));
        else if (near(line[line.length - 1], p[p.length - 1])) line = line.concat(p.slice(0, -1).reverse());
        else if (near(line[0], p[p.length - 1])) line = p.slice(0, -1).concat(line);
        else if (near(line[0], p[0])) line = p.slice(1).reverse().concat(line);
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    lines.push(line);
  }
  return lines.sort((a, b) => b.length - a.length);
}

// The closest point on a polyline: { s (arc length), d (distance) }.
export function projectOnLine(line, x, z) {
  let best = { s: 0, d: Infinity };
  let acc = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len === 0) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (len * len)));
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best.d) best = { s: acc + t * len, d };
    acc += len;
  }
  return best;
}

export function pointAt(line, s) {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i += 1) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (acc + len >= s) {
      const t = len > 0 ? (s - acc) / len : 0;
      return [ax + t * (bx - ax), az + t * (bz - az)];
    }
    acc += len;
  }
  return line[line.length - 1];
}

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// Rides `frames` steps from the spawn along `line`, in the direction of the
// spawn yaw. Pushes to `cruise` m/s. Returns { script, state, offTrack }:
// offTrack is the largest distance from the line, in meters.
// k: the skate constants (SKATE, or a skater body's constants from body.js).
export function followLineScript(line, spawn, env, { frames = 900, dt = 1 / 60, lookAhead = 8, cruise = 8, gain = 2.5, k = SKATE } = {}) {
  let s = createSkateState({ position: spawn.position, yaw: spawn.yaw });
  const start = projectOnLine(line, s.position[0], s.position[2]).s;
  const probe = pointAt(line, start + 1);
  const fwd = [Math.cos(spawn.yaw), -Math.sin(spawn.yaw)];
  const sign = (probe[0] - s.position[0]) * fwd[0] + (probe[1] - s.position[2]) * fwd[1] >= 0 ? 1 : -1;
  const script = [];
  let offTrack = 0;
  for (let i = 0; i < frames; i += 1) {
    const here = projectOnLine(line, s.position[0], s.position[2]);
    offTrack = Math.max(offTrack, here.d);
    const target = pointAt(line, here.s + sign * lookAhead);
    const want = yawFromHeading(target[0] - s.position[0], target[1] - s.position[2]);
    const err = wrap(want - s.yaw);
    const steer = Math.round(Math.max(-1, Math.min(1, err * gain)) * 100) / 100;
    const input = { steer, push: s.speed < cruise };
    const last = script[script.length - 1];
    if (last && last.input.steer === input.steer && last.input.push === input.push) last.frames += 1;
    else script.push({ frames: 1, input });
    s = stepSkate(s, input, dt, env, k);
  }
  return { script, state: s, offTrack };
}
