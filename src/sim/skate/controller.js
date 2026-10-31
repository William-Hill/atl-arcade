// The kinematic roller skate controller. Pure: no Three.js, no Rapier, no
// DOM, no clock of its own. Feed it a state, an input and a fixed dt and it
// hands back the next state, the same way every time.
//
// Feel, in one line: momentum is king. Speed only comes from a push, carving
// tightens as you slow, and nothing here can end a run (pillar 1).

import { clamp, flatLength, fromYaw } from "../math/vec3.js";
import { createSurfaceProbe } from "../level/probe.js";
import { carveRateAt, SKATE } from "./constants.js";

export const SKATE_STATES = ["coast", "push", "brake", "air", "land"];

export const NO_INPUT = Object.freeze({ steer: 0, push: false, brake: false, jump: false });

export function createSkater(level, tuning = SKATE) {
  const spawn = level.spawn;
  return {
    position: { ...spawn.position },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: spawn.yaw,
    speed: 0,
    grounded: true,
    state: "coast",
    surface: "ground",
    pushTimer: 0,
    landTimer: 0,
    airTime: 0,
    // Counters the playtest harness reads. Nothing here ends a run.
    jumps: 0,
    respawns: 0,
  };
}

// A world is whatever the controller needs to know about the level: where the
// floor is, and where to put the skater if they roll off the block.
export function createWorld(level, tuning = SKATE) {
  return { probe: createSurfaceProbe(level), spawn: level.spawn, tuning };
}

export function step(state, rawInput, dt, world) {
  if (!(dt > 0)) throw new Error("controller: dt must be positive");
  const tuning = world.tuning ?? SKATE;
  const input = normalizeInput(rawInput);
  const next = { ...state, position: { ...state.position }, velocity: { ...state.velocity } };

  next.pushTimer = Math.max(0, next.pushTimer - dt);
  next.landTimer = Math.max(0, next.landTimer - dt);

  if (next.grounded) stepGrounded(next, input, dt, tuning);
  else stepAirborne(next, input, dt, tuning);

  next.position.x += next.velocity.x * dt;
  next.position.y += next.velocity.y * dt;
  next.position.z += next.velocity.z * dt;

  resolveSurface(next, world, tuning);
  return next;
}

function stepGrounded(next, input, dt, tuning) {
  next.yaw += input.steer * carveRateAt(next.speed, tuning) * dt;

  if (input.brake) {
    next.speed = Math.max(0, next.speed - tuning.brakeDecel * dt);
    next.state = "brake";
  } else if (input.push && next.pushTimer <= 0) {
    next.speed = Math.min(tuning.maxSpeed, next.speed + tuning.pushImpulse);
    next.pushTimer = tuning.pushCooldown;
    next.state = "push";
  } else {
    next.speed = Math.max(0, next.speed - tuning.coastDecay * dt);
    next.state = next.landTimer > 0 ? "land" : "coast";
  }

  if (next.speed < tuning.stopSpeed && !input.push) next.speed = 0;

  // Roller skates grip: the skater travels where they face.
  const along = fromYaw(next.yaw, next.speed);
  next.velocity.x = along.x;
  next.velocity.z = along.z;
  next.velocity.y = 0;

  if (input.jump) {
    next.velocity.y = tuning.jumpSpeed;
    next.grounded = false;
    next.state = "air";
    next.airTime = 0;
    next.landTimer = 0;
    next.jumps += 1;
  }
}

function stepAirborne(next, input, dt, tuning) {
  next.airTime += dt;
  next.yaw += input.steer * carveRateAt(next.speed, tuning) * tuning.airSteerScale * dt;
  next.velocity.y -= tuning.gravity * dt;

  // Keep the horizontal velocity pointing where the skater has turned to, so
  // a spin in the air lands going the new way. Speed itself is untouched.
  const along = fromYaw(next.yaw, next.speed);
  next.velocity.x = along.x;
  next.velocity.z = along.z;
  next.state = "air";
}

function resolveSurface(next, world, tuning) {
  const hit = world.probe(next.position.x, next.position.z);
  next.surface = hit.kind;

  if (!Number.isFinite(hit.height)) {
    // Out over open air. Keep falling until the safety net catches us.
    if (next.grounded) {
      next.grounded = false;
      next.state = "air";
      next.airTime = 0;
    }
    if (next.position.y < tuning.respawnBelowY) respawn(next, world);
    return;
  }

  if (next.grounded) {
    // Stick to the surface while it is within reach: curbs, stair treads and
    // the ramp transition are all handled by this one snap.
    const drop = next.position.y - hit.height;
    if (drop <= tuning.groundSnap) {
      next.position.y = hit.height;
      next.velocity.y = 0;
    } else {
      next.grounded = false;
      next.state = "air";
      next.airTime = 0;
    }
    return;
  }

  if (next.velocity.y <= 0 && next.position.y <= hit.height) {
    land(next, hit.height, tuning);
  } else if (next.position.y < tuning.respawnBelowY) {
    respawn(next, world);
  }
}

function land(next, height, tuning) {
  next.position.y = height;
  next.velocity.y = 0;
  next.grounded = true;
  // The horizontal speed carried through the air becomes rolling speed again.
  next.speed = Math.min(tuning.maxSpeed, flatLength(next.velocity) * tuning.landingSpeedKeep);
  if (next.speed < tuning.stopSpeed) next.speed = 0;
  next.landTimer = tuning.landingTime;
  next.airTime = 0;
  next.state = "land";
}

function respawn(next, world) {
  next.position = { ...world.spawn.position };
  next.velocity = { x: 0, y: 0, z: 0 };
  next.yaw = world.spawn.yaw;
  next.speed = 0;
  next.grounded = true;
  next.state = "coast";
  next.airTime = 0;
  next.landTimer = 0;
  next.respawns += 1;
}

function normalizeInput(input) {
  if (!input) return NO_INPUT;
  return {
    steer: clamp(Number(input.steer) || 0, -1, 1),
    push: Boolean(input.push),
    brake: Boolean(input.brake),
    jump: Boolean(input.jump),
  };
}

// Run a whole input script at a fixed timestep. Both Vitest and the Playwright
// harness call this, so the browser is checked against the same numbers.
export function runScript(state, inputs, dt, world) {
  let current = state;
  for (const input of inputs) current = step(current, input, dt, world);
  return current;
}
