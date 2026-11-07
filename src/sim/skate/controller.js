// Kinematic roller skate controller. Pure: no Three.js, no Rapier, no DOM.
//
// The skater has a scalar `speed` along a horizontal heading `yaw` while
// rolling, and a free 3D `velocity` while airborne. Ground comes from an
// `env.sampleGround(x, z)` function (see src/level/ground.js) that returns
// { height, normal, id } or null. The step is a fixed timestep, so the same
// input script always produces the same state.
//
// Input shape (all optional, missing means off):
//   steer: -1..1 (negative right, positive left)
//   push: boolean (held; one burst per cooldown)
//   brake: boolean
//   jump: boolean (edge: the first tick it is true)
//
// Axes: +x east, +y up, +z south. Yaw 0 faces +x, positive yaw turns left,
// so the heading vector is (cos yaw, 0, -sin yaw), which matches
// Three.js `rotation.y = yaw` on a mesh whose nose points +x.

import { SKATE } from "./constants.js";

export const FLAT_GROUND = { sampleGround: () => ({ height: 0, normal: [0, 1, 0], id: "flat" }) };

export function createSkateState({ position = [0, 0, 0], yaw = 0 } = {}) {
  return {
    position: [position[0], position[1], position[2]],
    velocity: [0, 0, 0],
    yaw,
    speed: 0,
    state: "rolling", // "rolling" | "air"
    groundId: null,
    groundNormal: [0, 1, 0],
    pushCooldown: 0,
    pushing: false, // true while the push button is held on the ground
    braking: false, // true while the brake button is held on the ground
    airTime: 0,
    jumpHeld: false,
    jumpBuffer: 0, // s left on a buffered jump press
    justLanded: false,
    justJumped: false,
    bonked: false,
    wallSlide: false, // true on a tick where the skater slid along a wall
    airFrom: null, // "jump" | "ramp" | "edge" | "grind" | "fall"
    tick: 0,
  };
}

export function heading(yaw) {
  return [Math.cos(yaw), 0, -Math.sin(yaw)];
}

export function yawFromHeading(x, z) {
  return Math.atan2(-z, x);
}

function wrapYaw(yaw) {
  let y = yaw;
  while (y > Math.PI) y -= 2 * Math.PI;
  while (y < -Math.PI) y += 2 * Math.PI;
  return y;
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Unit tangent of the heading on the surface with normal n.
function surfaceTangent(yaw, n) {
  const h = heading(yaw);
  const d = dot3(h, n);
  const t = [h[0] - d * n[0], h[1] - d * n[1], h[2] - d * n[2]];
  const len = Math.hypot(t[0], t[1], t[2]);
  return len > 1e-6 ? [t[0] / len, t[1] / len, t[2] / len] : h;
}

export function carveRate(speed, k = SKATE) {
  const f = Math.min(Math.abs(speed) / k.carveFullSpeed, 1);
  return k.carveRate * (k.carveMinFactor + (1 - k.carveMinFactor) * f);
}

export function stepSkate(prev, input = {}, dt, env = FLAT_GROUND, k = SKATE) {
  const s = {
    ...prev,
    position: [...prev.position],
    velocity: [...prev.velocity],
    groundNormal: [...prev.groundNormal],
    justLanded: false,
    justJumped: false,
    bonked: false,
    wallSlide: false,
    respawned: false,
    tick: prev.tick + 1,
  };
  const steer = Math.max(-1, Math.min(1, input.steer ?? 0));
  // Input buffer: a jump press stays live for jumpBuffer s, so a press just
  // before a landing jumps on the first frame on the ground.
  const jumpEdge = Boolean(input.jump) && !prev.jumpHeld;
  s.jumpHeld = Boolean(input.jump);
  s.jumpBuffer = jumpEdge ? k.jumpBuffer : Math.max(0, (prev.jumpBuffer ?? 0) - dt);
  const wantsJump = s.jumpBuffer > 0;
  s.pushCooldown = Math.max(0, prev.pushCooldown - dt);

  if (s.state === "rolling") {
    stepRolling(s, { steer, push: Boolean(input.push), brake: Boolean(input.brake), jump: wantsJump }, dt, env, k);
  } else {
    stepAir(s, { steer, jump: wantsJump }, dt, env, k);
  }
  // The renderer reads this flag. pushCooldown counts down after a release,
  // so it does not tell if the player still pushes.
  s.pushing = s.state === "rolling" && Boolean(input.push);
  s.braking = s.state === "rolling" && Boolean(input.brake);
  if (s.justJumped) s.jumpBuffer = 0;
  if (env.bounds && env.spawn && isLost(s, env.bounds, k)) respawn(s, env.spawn);
  return s;
}

// A skater below the level or past its bounds can never get back, so it
// goes back to the spawn point. The level barriers make this a backstop.
export function isLost(s, bounds, k = SKATE) {
  const [x, y, z] = s.position;
  const m = k.boundsMargin;
  return y < k.fallFloor || x < bounds.minX - m || x > bounds.maxX + m || z < bounds.minZ - m || z > bounds.maxZ + m;
}

function respawn(s, spawn) {
  s.position = [...spawn.position];
  s.velocity = [0, 0, 0];
  s.yaw = spawn.yaw;
  s.speed = 0;
  s.state = "rolling";
  s.airTime = 0;
  s.groundNormal = [0, 1, 0];
  s.groundId = null;
  s.respawned = true;
}

function stepRolling(s, input, dt, env, k) {
  // Carve: rotate the heading; speed is preserved (momentum is king).
  if (steerActive(input.steer) && Math.abs(s.speed) > k.stopSpeed) {
    s.yaw = wrapYaw(s.yaw + input.steer * carveRate(s.speed, k) * dt);
  } else if (steerActive(input.steer)) {
    // At a standstill the skater can still turn in place, slowly.
    s.yaw = wrapYaw(s.yaw + input.steer * k.carveRate * k.carveMinFactor * dt);
  }

  // At rest with the push held, the start of a stroke has little thrust
  // (the half sine starts at 0), and the stopSpeed snap sets the first
  // small speeds to 0. Without a hold, any uphill rolls her back and turns
  // her around before the stroke moves her.
  const pushFromRest = input.push && s.speed === 0;

  // Push: a held button gives strokes of pushCooldown s. The thrust of a
  // stroke rises and falls (a half sine wave), and its mean is pushAccel.
  // A release stops the thrust at once; the roll friction then slows her.
  if (input.push && s.pushCooldown <= 0) s.pushCooldown = k.pushCooldown;
  if (input.push && s.pushCooldown > 0 && Math.abs(s.speed) < k.maxSpeed) {
    const phase = 1 - s.pushCooldown / k.pushCooldown;
    const thrust = k.pushAccel * (Math.PI / 2) * Math.sin(Math.PI * phase);
    const dir = s.speed < 0 ? -1 : 1;
    s.speed = dir * Math.min(Math.abs(s.speed) + thrust * dt, k.maxSpeed);
  }

  // Brake: toward zero, never past it.
  if (input.brake) {
    const sign = Math.sign(s.speed);
    s.speed = sign * Math.max(0, Math.abs(s.speed) - k.brakeDecel * dt);
  }

  // Roll friction and drag. On a ramp the skater pumps, so the friction is less.
  const onRamp = s.groundNormal && s.groundNormal[1] < k.rampNormalY;
  const drag = (k.coastDecel + k.coastDrag * s.speed * s.speed) * (onRamp ? k.rampFriction : 1);
  const sign = Math.sign(s.speed);
  s.speed = sign * Math.max(0, Math.abs(s.speed) - drag * dt);
  if (Math.abs(s.speed) < k.stopSpeed) s.speed = 0;

  // Slope: gravity along the surface tangent.
  const n = s.groundNormal;
  let t = surfaceTangent(s.yaw, n);
  s.speed -= k.gravity * t[1] * dt;
  if (s.speed < 0 && pushFromRest && k.gravity * t[1] < k.pushAccel) {
    // A push from rest up a grade that the mean push can climb: she stands
    // on this tick, and the stroke moves her forward on the next ticks. On
    // a grade steeper than that, or after she moved (a real stall), she
    // rolls back below.
    s.speed = 0;
  } else if (s.speed < 0) {
    // Rolled back: face the other way and keep rolling.
    s.speed = -s.speed;
    s.yaw = wrapYaw(s.yaw + Math.PI);
    t = surfaceTangent(s.yaw, n);
  }

  // Jump: leave the ground with the surface velocity plus the jump.
  if (input.jump) {
    s.velocity = [t[0] * s.speed, t[1] * s.speed + k.jumpSpeed, t[2] * s.speed];
    s.state = "air";
    s.airTime = 0;
    s.justJumped = true;
    s.airFrom = "jump";
    s.groundId = null;
    s.position[1] += 1e-3;
    return;
  }

  // Launch off a near-vertical lip (quarter pipe): straight up, so the
  // skater comes back down onto the transition. Drift along the lip stays.
  if (n[1] < k.launchNormalY && s.speed > 0 && t[1] > 0) {
    const hl = Math.hypot(n[0], n[2]);
    const nh = hl > 1e-6 ? [n[0] / hl, 0, n[2] / hl] : [0, 0, 0];
    const v = [t[0] * s.speed, t[1] * s.speed, t[2] * s.speed];
    const along = v[0] * nh[0] + v[2] * nh[2];
    s.velocity = [v[0] - along * nh[0], v[1], v[2] - along * nh[2]];
    s.state = "air";
    s.airTime = 0;
    s.airFrom = "ramp";
    s.groundId = null;
    return;
  }

  // Move along the surface tangent in 3D, then snap to the ground under the
  // new column. A rise above maxStep is a wall; a drop beyond dropThreshold
  // is an edge, and the skater falls.
  const nx = s.position[0] + t[0] * s.speed * dt;
  const ny = s.position[1] + t[1] * s.speed * dt;
  const nz = s.position[2] + t[2] * s.speed * dt;
  const g = env.sampleGround(nx, nz, ny);

  if (!g) {
    // Nothing under the feet: fall with the current velocity.
    s.velocity = [t[0] * s.speed, Math.min(t[1] * s.speed, 0), t[2] * s.speed];
    s.state = "air";
    s.airTime = 0;
    s.airFrom = "edge";
    s.groundId = null;
    s.position = [nx, ny, nz];
    return;
  }

  const rise = g.height - ny;
  // The probe measures a rise from the height the skater stands on at the
  // next position (one step up, when it climbs one), so two walkable treads
  // in a row are not a wall.
  const ref = Math.max(ny, g.height);
  if (rise > k.maxStep || wallNear(s, env, nx, ref, nz, k)) {
    // A wall. Slide along it, or stop where we are on a head-on hit.
    if (!slideRolling(s, env, t, ref, dt, k)) {
      s.speed *= k.bonkSpeedKeep;
      s.bonked = true;
      s.velocity = [0, 0, 0];
    }
    return;
  }

  if (rise < -k.dropThreshold) {
    // The ground fell away: roll off the edge into the air.
    s.velocity = [t[0] * s.speed, Math.min(t[1] * s.speed, 0), t[2] * s.speed];
    s.state = "air";
    s.airTime = 0;
    s.airFrom = "edge";
    s.groundId = null;
    s.position = [nx, ny, nz];
    return;
  }

  s.position = [nx, g.height, nz];
  s.groundNormal = [...g.normal];
  s.groundId = g.id;
  s.velocity = [t[0] * s.speed, t[1] * s.speed, t[2] * s.speed];
}

// The skater is a point for the ground, but the body has a radius. A ring
// of probes one body radius around the next position looks for the side of
// a wall, so the body never goes into it. On a ramp (a steep ground normal)
// the ring is off, because the ramp ahead rises fast but it is not a wall.
const RING_SIZE = 16;
const RING = Array.from({ length: RING_SIZE }, (_, i) => {
  const a = (i * 2 * Math.PI) / RING_SIZE;
  return [Math.cos(a), Math.sin(a)];
});
// The ring is a polygon of RING_SIZE points. Its radius is bodyRadius /
// cos(pi / RING_SIZE), so the polygon sides stay outside the body circle and a
// wall cannot go between two probes into the body.
const RING_SCALE = 1 / Math.cos(Math.PI / RING_SIZE);
const CLEAR_MARGIN = 1e-3; // m kept past the ring radius after a slide, so the ring does not touch the wall.
const EDGE_STEPS = 10; // bisection steps that find the wall edge along a ray.
// The rays that find a wall reach this many body radii (plus the step). The
// rays 33.75 degrees off the normal need 1 / cos(33.75) = 1.2 radii to hit a
// straight wall one radius away, so the line fit also works at a crawl.
const WALL_REACH = 1.3;

// `y` is the skater height, for a level with bridges (geo-ground.js).
function ringHits(env, x, z, radius, isWall, y = Infinity) {
  if (!(radius > 0)) return false;
  for (const [cx, cz] of RING) {
    const p = env.sampleGround(x + cx * radius, z + cz * radius, y);
    if (p && isWall(p)) return true;
  }
  return false;
}

function rollWall(ref, k) {
  return (p) => p.height - ref > k.maxStep && p.normal[1] > 0.9;
}

function airWall(prevY, ny, k) {
  return (p) => p.height > prevY + k.maxStep && ny < p.height && p.normal[1] > 0.9;
}

function wallNear(s, env, nx, ny, nz, k) {
  if (!s.groundNormal || s.groundNormal[1] < 0.9) return false;
  return ringHits(env, nx, nz, k.bodyRadius * RING_SCALE, rollWall(ny, k), ny);
}

function wallNearInAir(env, nx, ny, nz, prevY, k) {
  return ringHits(env, nx, nz, k.bodyRadius * RING_SCALE, airWall(prevY, ny, k), prevY);
}

// The distance along the ray (dx, dz) from (x, z) to the first wall point,
// or null when the ray stays clear for `reach`. Returns the last clear
// distance, so the true edge is at or past the result.
function edgeDistance(env, x, z, dx, dz, reach, isWall, y) {
  const p = env.sampleGround(x + dx * reach, z + dz * reach, y);
  if (!p || !isWall(p)) return null;
  let lo = 0;
  let hi = reach;
  for (let i = 0; i < EDGE_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    const q = env.sampleGround(x + dx * mid, z + dz * mid, y);
    if (q && isWall(q)) hi = mid;
    else lo = mid;
  }
  return lo;
}

// The wall near (x, z): a point on its edge and its horizontal normal (unit,
// from the wall toward the skater), or null when no ray finds a wall.
// The nearest edge point gives the direction. When both rays next to it hit
// too, the line through their edge points gives the normal, which is exact
// for a straight wall. At a corner the nearest point gives the normal.
function findWall(env, x, z, reach, isWall, y) {
  const d = RING.map(([cx, cz]) => edgeDistance(env, x, z, cx, cz, reach, isWall, y));
  let best = -1;
  for (let i = 0; i < RING_SIZE; i += 1) if (d[i] !== null && (best < 0 || d[i] < d[best])) best = i;
  if (best < 0) return null;
  const point = (i) => [x + RING[i][0] * d[i], z + RING[i][1] * d[i]];
  let n = [-RING[best][0], -RING[best][1]];
  const a = (best + 1) % RING_SIZE;
  const b = (best + RING_SIZE - 1) % RING_SIZE;
  if (d[a] !== null && d[b] !== null) {
    const pa = point(a);
    const pb = point(b);
    const tx = pa[0] - pb[0];
    const tz = pa[1] - pb[1];
    const len = Math.hypot(tx, tz);
    if (len > 1e-6) {
      let m = [-tz / len, tx / len];
      if (m[0] * n[0] + m[1] * n[1] < 0) m = [-m[0], -m[1]];
      n = m;
    }
  }
  // The edge line passes through the nearest edge point along the normal.
  const off = Math.min(...[best, a, b].filter((i) => d[i] !== null).map((i) => {
    const p = point(i);
    return (p[0] - x) * -n[0] + (p[1] - z) * -n[1];
  }));
  return { normal: n, point: [x - n[0] * off, z - n[1] * off] };
}

// The slide response for a horizontal velocity (vx, vz) at a wall with
// normal n. Returns the new velocity, or null for a head-on hit (a bonk).
// The approach angle is the angle between the velocity and the wall face.
// The skater keeps the part along the wall, and the scrub takes a share of
// it that grows with the approach angle, up to (1 - wallSlideKeep) just
// under wallBonkAngle.
function slideVelocity(vx, vz, n, k) {
  const sp = Math.hypot(vx, vz);
  if (sp < 1e-9) return null;
  const into = -(vx * n[0] + vz * n[1]) / sp;
  if (into <= 0) return [vx, vz]; // The skater already goes away from the wall.
  const angle = Math.asin(Math.min(1, into));
  if (angle > k.wallBonkAngle) return null;
  const ax = vx + into * sp * n[0];
  const az = vz + into * sp * n[1];
  const scrub = 1 - (1 - k.wallSlideKeep) * (into / Math.sin(k.wallBonkAngle));
  return [ax * scrub, az * scrub];
}

// Move (x, z) by (vx, vz) dt, then push it out to the ring radius (plus a
// margin) from the wall edge line.
function slideTo(x, z, v, dt, wall, k) {
  let px = x + v[0] * dt;
  let pz = z + v[1] * dt;
  const n = wall.normal;
  const dist = (px - wall.point[0]) * n[0] + (pz - wall.point[1]) * n[1];
  const want = k.bodyRadius * RING_SCALE + CLEAR_MARGIN;
  if (dist < want) {
    px += (want - dist) * n[0];
    pz += (want - dist) * n[1];
  }
  return [px, pz];
}

// A rolling slide. Returns false for a bonk; the caller then stops the skater.
// The slide is horizontal; the speed keeps its ratio to the horizontal
// velocity, so a slide on a slope does not lose the slope part of the speed.
// A slide off an edge goes into the air, as a roll off an edge does.
function slideRolling(s, env, t, ref, dt, k) {
  const [x, y, z] = s.position;
  const isWall = rollWall(ref, k);
  const wall = findWall(env, x, z, k.bodyRadius * WALL_REACH + Math.abs(s.speed) * dt + 0.05, isWall, ref);
  if (!wall) return false;
  const hx = t[0] * s.speed;
  const hz = t[2] * s.speed;
  const v = slideVelocity(hx, hz, wall.normal, k);
  if (!v) return false;
  const [px, pz] = slideTo(x, z, v, dt, wall, k);
  const g = env.sampleGround(px, pz, ref);
  const rise = g ? g.height - y : -Infinity;
  if (rise > k.maxStep) return false;
  const top = g ? Math.max(y, g.height) : y;
  if (ringHits(env, px, pz, k.bodyRadius * RING_SCALE, rollWall(top, k), top)) return false;
  const h = Math.hypot(hx, hz);
  const sp = Math.hypot(v[0], v[1]);
  const speed = h > 1e-9 ? s.speed * (sp / h) : 0;
  if (sp > 1e-6) s.yaw = yawFromHeading(v[0], v[1]);
  s.wallSlide = true;
  if (rise < -k.dropThreshold) {
    // The ground falls away: leave the edge with the slide velocity.
    s.speed = speed;
    s.velocity = [v[0], 0, v[1]];
    s.state = "air";
    s.airTime = 0;
    s.airFrom = "edge";
    s.groundId = null;
    s.position = [px, y, pz];
    return true;
  }
  s.speed = speed < k.stopSpeed ? 0 : speed;
  s.position = [px, g.height, pz];
  s.groundNormal = [...g.normal];
  s.groundId = g.id;
  const tt = surfaceTangent(s.yaw, g.normal);
  s.velocity = [tt[0] * s.speed, tt[1] * s.speed, tt[2] * s.speed];
  return true;
}

// An airborne slide. Returns the new column and ground sample, or null for a bonk.
function slideAir(s, env, ny, prevY, dt, k) {
  const [x, , z] = s.position;
  const isWall = airWall(prevY, ny, k);
  const reach = k.bodyRadius * WALL_REACH + Math.hypot(s.velocity[0], s.velocity[2]) * dt + 0.05;
  const wall = findWall(env, x, z, reach, isWall, prevY);
  if (!wall) return null;
  const v = slideVelocity(s.velocity[0], s.velocity[2], wall.normal, k);
  if (!v) return null;
  const [px, pz] = slideTo(x, z, v, dt, wall, k);
  const g = env.sampleGround(px, pz, prevY);
  if (g && isWall(g)) return null;
  if (ringHits(env, px, pz, k.bodyRadius * RING_SCALE, isWall, prevY)) return null;
  s.velocity[0] = v[0];
  s.velocity[2] = v[1];
  return { nx: px, nz: pz, g };
}

function stepAir(s, input, dt, env, k) {
  if (steerActive(input.steer)) s.yaw = wrapYaw(s.yaw + input.steer * k.airTurnRate * dt);

  // Coyote time: a jump press just after the skater rolls off an edge still
  // jumps. The window is only for a roll-off, so it never gives a second jump.
  if (input.jump && s.airFrom === "edge" && s.airTime < k.coyoteTime) {
    s.velocity[1] = Math.max(s.velocity[1], 0) + k.jumpSpeed;
    s.airTime = 0;
    s.justJumped = true;
    s.airFrom = "jump";
  }

  const prevY = s.position[1];
  s.velocity[1] -= k.gravity * dt;
  let nx = s.position[0] + s.velocity[0] * dt;
  const ny = prevY + s.velocity[1] * dt;
  let nz = s.position[2] + s.velocity[2] * dt;
  let g = env.sampleGround(nx, nz, prevY);

  // The side of anything taller than a step is a wall in the air too. On a
  // shallow approach the skater slides along it; on a head-on hit the
  // skater keeps its column, loses its horizontal speed, and falls. The ring
  // one body radius around the skater keeps the body out of the wall.
  if ((g && g.height > prevY + k.maxStep && ny < g.height) || wallNearInAir(env, nx, ny, nz, prevY, k)) {
    const slid = slideAir(s, env, ny, prevY, dt, k);
    if (slid) {
      nx = slid.nx;
      nz = slid.nz;
      g = slid.g;
      s.wallSlide = true;
    } else {
      nx = s.position[0];
      nz = s.position[2];
      s.velocity[0] = 0;
      s.velocity[2] = 0;
      s.bonked = true;
      g = env.sampleGround(nx, nz, prevY);
    }
  }

  s.position = [nx, ny, nz];
  s.airTime += dt;

  // Land only on a surface the skater came down onto from above (or onto a
  // step it could roll up), never on a roof it never reached.
  if (g && ny <= g.height && s.velocity[1] <= 0 && prevY >= g.height - k.maxStep) {
    // Land: project the velocity onto the surface.
    const n = g.normal;
    const v = s.velocity;
    const d = dot3(v, n);
    const vt = [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]];
    const horiz = Math.hypot(vt[0], vt[2]);
    s.speed = Math.hypot(vt[0], vt[1], vt[2]);
    if (horiz > 0.05) s.yaw = yawFromHeading(vt[0], vt[2]);
    s.position[1] = g.height;
    s.groundNormal = [...n];
    s.groundId = g.id;
    s.state = "rolling";
    s.justLanded = true;
    s.velocity = vt;
  }
}

function steerActive(steer) {
  return Math.abs(steer) > 1e-3;
}

// Replay an input script through the controller. A script is a list of
// { frames, input } entries. Returns the final state and the list of states
// per tick when `trace` is true.
export function runScript(initial, script, { dt = 1 / 60, env = FLAT_GROUND, trace = false, k = SKATE } = {}) {
  let s = initial;
  const states = [];
  for (const entry of script) {
    for (let i = 0; i < entry.frames; i += 1) {
      s = stepSkate(s, entry.input ?? {}, dt, env, k);
      if (trace) states.push(s);
    }
  }
  return trace ? { state: s, states } : { state: s };
}
