// Grind system: rail snap, balance, exit launch. Pure: plain arrays.
//
// A grindable is { id, points, total } where `points` is the sampled
// polyline of a rail or ledge spline (see src/level/splines.js).
// `findSnap` decides whether the skater may snap, `startGrind` builds the
// grind state, `stepGrind` rides the spline one fixed tick, and the exit
// functions hand a free velocity back to the controller.

import { GRIND, SKATE } from "./constants.js";
import { heading, yawFromHeading } from "./controller.js";
import { nearestOnPolyline, pointAtDistance, sampleSpline, polylineLength } from "../../level/splines.js";

export function prepareGrindables(level, samples = 16) {
  return level.objects
    .filter((o) => o.spline)
    .map((o) => {
      const points = sampleSpline(o.spline, samples);
      return { id: o.id, kind: o.kind, points, total: polylineLength(points) };
    });
}

// Looks for a spline the skater may snap to. Returns
// { grindable, s, direction, distance } or null.
export function findSnap(grindables, skater, k = GRIND) {
  const p = skater.position;
  const h = heading(skater.yaw);
  let best = null;
  for (const g of grindables) {
    // A grindable with a ground box (a geodata ledge) is skipped at once
    // when the skater is far from it.
    if (g.box && (p[0] < g.box.minX - k.snapRadius || p[0] > g.box.maxX + k.snapRadius || p[2] < g.box.minZ - k.snapRadius || p[2] > g.box.maxZ + k.snapRadius)) continue;
    const near = nearestOnPolyline(g.points, [p[0], p[1], p[2]]);
    const dx = near.point[0] - p[0];
    const dz = near.point[2] - p[2];
    const horizontal = Math.hypot(dx, dz);
    if (horizontal > k.snapRadius) continue;
    const dy = near.point[1] - p[1];
    if (dy < -k.snapBelow || dy > k.snapAbove) continue;
    const along = h[0] * near.tangent[0] + h[1] * near.tangent[1] + h[2] * near.tangent[2];
    if (Math.abs(along) < k.minAlongDot) continue;
    const distance = Math.hypot(horizontal, dy);
    if (!best || distance < best.distance) {
      best = { grindable: g, s: near.s, direction: along >= 0 ? 1 : -1, distance };
    }
  }
  return best;
}

export function startGrind(skater, snap, lean = 1, k = GRIND) {
  const v = skater.velocity;
  const t = pointAtDistance(snap.grindable.points, snap.s).tangent;
  const projected = Math.abs(v[0] * t[0] + v[1] * t[1] + v[2] * t[2]);
  const speed = Math.max(projected, Math.abs(skater.speed), k.minSpeed);
  const at = pointAtDistance(snap.grindable.points, snap.s);
  const dirT = at.tangent.map((c) => c * snap.direction);
  return {
    ...skater,
    state: "grind",
    position: [...at.point],
    velocity: dirT.map((c) => c * speed),
    speed,
    yaw: yawFromHeading(dirT[0], dirT[2]),
    groundId: snap.grindable.id,
    groundNormal: [0, 1, 0],
    grind: { id: snap.grindable.id, s: snap.s, direction: snap.direction, balance: 0, lean: lean >= 0 ? 1 : -1, time: 0 },
    justSnapped: true,
    justFell: false,
    justExited: false,
  };
}

function exitWith(skater, velocity, reason) {
  return {
    ...skater,
    state: "air",
    velocity,
    speed: Math.hypot(velocity[0], velocity[1], velocity[2]),
    airTime: 0,
    airFrom: reason === "fall" ? "fall" : "grind",
    groundId: null,
    grind: null,
    grindCooldown: GRIND.resnapCooldown,
    justExited: reason !== "fall",
    justFell: reason === "fall",
    exitReason: reason,
  };
}

// One fixed tick on the rail. `input.steer` is the balance input and
// `input.jump` (edge) exits early. Returns the next skater state; when the
// grind ends the state is "air" with the exit velocity.
export function stepGrind(prev, input, dt, grindables, k = GRIND, skate = SKATE) {
  const g = grindables.find((x) => x.id === prev.grind.id);
  if (!g) throw new Error(`grind: unknown grindable ${prev.grind.id}`);
  // Reset every one-tick flag: stepSkate does not run on a rail, so a jump or
  // a landing on the snap tick would otherwise repeat on every grind tick.
  const s = { ...prev, grind: { ...prev.grind }, justSnapped: false, justFell: false, justExited: false, justJumped: false, justLanded: false, bonked: false, wallSlide: false, respawned: false };
  const steer = Math.max(-1, Math.min(1, input.steer ?? 0));

  // Balance: a constant lean push plus growth with the lean, minus the correction.
  const b = s.grind.balance;
  s.grind.balance = b + (k.balanceDrift * s.grind.lean + k.balanceGravity * b - steer * k.balanceCorrect) * dt;
  s.grind.time += dt;

  // Speed and position along the spline.
  s.speed = Math.max(s.speed - k.friction * dt, k.minSpeed);
  s.grind.s += s.grind.direction * s.speed * dt;
  const at = pointAtDistance(g.points, s.grind.s);
  const dirT = at.tangent.map((c) => c * s.grind.direction);
  s.position = [...at.point];
  s.velocity = dirT.map((c) => c * s.speed);
  s.yaw = yawFromHeading(dirT[0], dirT[2]);

  if (Math.abs(s.grind.balance) > k.balanceLimit) {
    // Fall: off the side the skater leans toward, slower.
    const side = Math.sign(s.grind.balance) || 1;
    const right = [-dirT[2], 0, dirT[0]]; // the skater's right (+z at yaw 0)
    const keep = s.speed * k.fallSpeedKeep;
    const velocity = [dirT[0] * keep + right[0] * side * k.fallSideSpeed, 0, dirT[2] * keep + right[2] * side * k.fallSideSpeed];
    return exitWith(s, velocity, "fall");
  }

  if (input.jump) {
    return exitWith(s, [s.velocity[0], s.velocity[1] + skate.jumpSpeed, s.velocity[2]], "jump");
  }

  const past = s.grind.direction > 0 ? s.grind.s >= g.total : s.grind.s <= 0;
  if (past) {
    return exitWith(s, [s.velocity[0], s.velocity[1] + k.endPop, s.velocity[2]], "end");
  }

  return s;
}
