// Skate ATL's hooks for the Autopilot browser bridge (src/autopilot/autopilot-bridge.js).
// Three.js has no standard player, movement, or UI. These hooks tell the
// bridge what the skater is, how it moves, which keys it uses, and how a run
// starts again. They read the simulation state that window.__atl exposes.
// The pure helpers at the top have Vitest tests (hooks.test.js).

import { heading, yawFromHeading } from "../sim/skate/controller.js";
import { SKATE } from "../sim/skate/constants.js";
import { FIXED_DT } from "../sim/fixed-step.js";

// Half the skater's height in meters: the bridge reports the body middle.
export const SKATER_HALF_HEIGHT = 0.9;
// Steer only when the heading error is more than this, in radians.
export const STEER_DEADBAND = 0.08;

// The skater as the bridge's player hook gives it. Native Three.js axes and
// meters. On the ground the velocity is the heading times the speed; in the
// air it is the simulation's own velocity.
export function playerFromSkater(skater, object = null) {
  const h = heading(skater.yaw);
  const air = skater.state === "air";
  const v = air && skater.velocity ? [...skater.velocity] : [h[0] * skater.speed, 0, h[2] * skater.speed];
  return {
    object,
    position: [...skater.position],
    velocity: v,
    forward: h,
    onGround: !air,
    halfHeight: SKATER_HALF_HEIGHT,
    state: skater.grind ? "grinding" : skater.state,
  };
}

// The game's input actions with their keyboard codes, from the bindings.
export function controlsFromBindings(bindings) {
  return Object.entries(bindings?.keyboard ?? {}).map(([name, keys]) => ({ name, keys: [...keys], digital: true }));
}

function wrapAngle(a) {
  let y = a;
  while (y > Math.PI) y -= 2 * Math.PI;
  while (y < -Math.PI) y += 2 * Math.PI;
  return y;
}

// Which way to steer so that the skater faces `direction` (native [x, y, z]):
// "left", "right", or null when the heading error is in the deadband.
// Positive yaw turns left, and the left key steers left.
export function steerToward(yaw, direction) {
  if (Math.hypot(direction[0], direction[2]) < 1e-6) return null;
  const err = wrapAngle(yawFromHeading(direction[0], direction[2]) - yaw);
  if (err > STEER_DEADBAND) return "left";
  if (err < -STEER_DEADBAND) return "right";
  return null;
}

// The movement numbers in meters and seconds. A skater has no walk speed:
// the bridge reports the speed cap after pushes.
export function movementNumbers() {
  return {
    walkSpeed: SKATE.maxSpeed,
    jumpSpeed: SKATE.jumpSpeed,
    gravity: SKATE.gravity,
    halfHeight: SKATER_HALF_HEIGHT,
    extra: { carveRate: SKATE.carveRate, airTurnRate: SKATE.airTurnRate, note: "the skater keeps its speed and steers: it does not strafe" },
  };
}

// The longest wall time of a move, in units of its game seconds.
export const MOVE_WALL_FACTOR = 10;

// The hook object for connectBridge. `ctx`: { atl (window.__atl), level,
// skaterObject, render(), now() }.
export function createSkateHooks(ctx) {
  const { atl, level } = ctx;
  const now = ctx.now ?? (() => performance.now());
  const kindById = new Map((level?.objects ?? []).map((o) => [o.id, o.kind]));
  const firstKey = (action) => atl.input.bindings.keyboard[action]?.[0];

  return {
    player: () => playerFromSkater(atl.skater, ctx.skaterObject ?? null),
    movement: movementNumbers,
    controls: () => controlsFromBindings(atl.input.bindings),
    restart: () => atl.resetSkater(),
    levels: () => ({ levels: [level?.name ?? ""], playing: level?.name ?? "" }),
    pause: (paused) => {
      atl.renderPaused = paused;
      return atl.renderPaused;
    },
    paused: () => atl.renderPaused,
    gameTime: () => atl.ticks * FIXED_DT,
    // A level object's class is its kind: rail, ledge, ramp, ground, building.
    classOf: (o) => kindById.get(o.name) ?? null,
    render: ctx.render,
    objects: { atl },
    // Skate toward a direction: push (or brake for a negative scale) and
    // steer each frame until the heading matches. `seconds` is game time
    // (the fixed ticks, as gameTime() gives), so a slow frame rate gives the
    // same move. A paused or stalled game stops the move after
    // MOVE_WALL_FACTOR times the seconds of wall time.
    async move({ direction, seconds, scale, keys }) {
      const push = scale < 0 ? firstKey("brake") : firstKey("push");
      const left = firstKey("left");
      const right = firstKey("right");
      const until = atl.ticks + Math.round(seconds / FIXED_DT);
      const wallUntil = now() + seconds * 1000 * MOVE_WALL_FACTOR;
      let steering = null;
      keys.hold(push);
      try {
        while (atl.ticks < until && now() < wallUntil) {
          const want = steerToward(atl.skater.yaw, direction);
          if (want !== steering) {
            if (steering) keys.release(steering === "left" ? left : right);
            if (want) keys.hold(want === "left" ? left : right);
            steering = want;
          }
          await keys.frame();
        }
      } finally {
        if (steering) keys.release(steering === "left" ? left : right);
        keys.release(push);
      }
    },
  };
}
