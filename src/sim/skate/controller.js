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
    airTime: 0,
    jumpHeld: false,
    justLanded: false,
    justJumped: false,
    bonked: false,
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
    respawned: false,
    tick: prev.tick + 1,
  };
  const steer = Math.max(-1, Math.min(1, input.steer ?? 0));
  const jumpEdge = Boolean(input.jump) && !prev.jumpHeld;
  s.jumpHeld = Boolean(input.jump);
  s.pushCooldown = Math.max(0, prev.pushCooldown - dt);

  if (s.state === "rolling") {
    stepRolling(s, { steer, push: Boolean(input.push), brake: Boolean(input.brake), jump: jumpEdge }, dt, env, k);
  } else {
    stepAir(s, { steer }, dt, env, k);
  }
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

  // Push: a burst, then a cooldown.
  if (input.push && s.pushCooldown <= 0) {
    s.speed = Math.min(s.speed + k.pushImpulse, k.maxSpeed);
    s.pushCooldown = k.pushCooldown;
  }

  // Brake: toward zero, never past it.
  if (input.brake) {
    const sign = Math.sign(s.speed);
    s.speed = sign * Math.max(0, Math.abs(s.speed) - k.brakeDecel * dt);
  }

  // Roll friction and drag.
  const drag = k.coastDecel + k.coastDrag * s.speed * s.speed;
  const sign = Math.sign(s.speed);
  s.speed = sign * Math.max(0, Math.abs(s.speed) - drag * dt);
  if (Math.abs(s.speed) < k.stopSpeed) s.speed = 0;

  // Slope: gravity along the surface tangent.
  const n = s.groundNormal;
  let t = surfaceTangent(s.yaw, n);
  s.speed -= k.gravity * t[1] * dt;
  if (s.speed < 0) {
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
    s.groundId = null;
    return;
  }

  // Move along the surface tangent in 3D, then snap to the ground under the
  // new column. A rise above maxStep is a wall; a drop beyond dropThreshold
  // is an edge, and the skater falls.
  const nx = s.position[0] + t[0] * s.speed * dt;
  const ny = s.position[1] + t[1] * s.speed * dt;
  const nz = s.position[2] + t[2] * s.speed * dt;
  const g = env.sampleGround(nx, nz);

  if (!g) {
    // Nothing under the feet: fall with the current velocity.
    s.velocity = [t[0] * s.speed, Math.min(t[1] * s.speed, 0), t[2] * s.speed];
    s.state = "air";
    s.airTime = 0;
    s.groundId = null;
    s.position = [nx, ny, nz];
    return;
  }

  const rise = g.height - ny;
  if (rise > k.maxStep) {
    // A wall. Stop where we are.
    s.speed *= k.bonkSpeedKeep;
    s.bonked = true;
    s.velocity = [0, 0, 0];
    return;
  }

  if (rise < -k.dropThreshold) {
    // The ground fell away: roll off the edge into the air.
    s.velocity = [t[0] * s.speed, Math.min(t[1] * s.speed, 0), t[2] * s.speed];
    s.state = "air";
    s.airTime = 0;
    s.groundId = null;
    s.position = [nx, ny, nz];
    return;
  }

  s.position = [nx, g.height, nz];
  s.groundNormal = [...g.normal];
  s.groundId = g.id;
  s.velocity = [t[0] * s.speed, t[1] * s.speed, t[2] * s.speed];
}

function stepAir(s, input, dt, env, k) {
  if (steerActive(input.steer)) s.yaw = wrapYaw(s.yaw + input.steer * k.airTurnRate * dt);

  const prevY = s.position[1];
  s.velocity[1] -= k.gravity * dt;
  let nx = s.position[0] + s.velocity[0] * dt;
  const ny = prevY + s.velocity[1] * dt;
  let nz = s.position[2] + s.velocity[2] * dt;
  let g = env.sampleGround(nx, nz);

  // The side of anything taller than a step is a wall in the air too: the
  // skater keeps its column, loses its horizontal speed, and falls.
  if (g && g.height > prevY + k.maxStep && ny < g.height) {
    nx = s.position[0];
    nz = s.position[2];
    s.velocity[0] = 0;
    s.velocity[2] = 0;
    s.bonked = true;
    g = env.sampleGround(nx, nz);
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
