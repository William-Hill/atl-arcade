// The trick input prototype's hooks for the Autopilot browser bridge (#326).
// Pure helpers at the top, with Vitest tests (hooks.test.js). The prototype
// sim uses x and z on the ground, y up, and a heading of (cos yaw, sin yaw).
// Steer right (D) turns the yaw up.

import { DEFAULT_KEYS } from "../input.js";
import { DT, SKATE } from "../constants.js";

export const SKATER_HALF_HEIGHT = 0.9;
export const STEER_DEADBAND = 0.08;
export const MOVE_WALL_FACTOR = 10;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function playerFromSim(s, object = null) {
  const hx = Math.cos(s.yaw);
  const hz = Math.sin(s.yaw);
  const air = s.mode === "air";
  return {
    object,
    position: [s.x, s.y + SKATER_HALF_HEIGHT, s.z],
    velocity: [hx * s.speed, air ? s.vy ?? 0 : 0, hz * s.speed],
    forward: [hx, 0, hz],
    onGround: !air,
    halfHeight: SKATER_HALF_HEIGHT,
    state: s.mode,
  };
}

// "left", "right", or null: which steer key turns the skater toward `direction` (native [x, y, z]).
export function steerToward(yaw, direction) {
  if (Math.hypot(direction[0], direction[2]) < 1e-6) return null;
  const err = wrap(Math.atan2(direction[2], direction[0]) - yaw);
  if (err > STEER_DEADBAND) return "right";
  if (err < -STEER_DEADBAND) return "left";
  return null;
}

// The input actions with their key codes. The direction actions share the
// steer, push, and brake keys (R2).
export function controlsFromKeys(keys = DEFAULT_KEYS) {
  return Object.entries(keys).map(([name, codes]) => ({ name, keys: [...codes], digital: true }));
}

export function movementNumbers() {
  return {
    walkSpeed: SKATE.maxPushSpeed,
    jumpSpeed: SKATE.jumpSpeed,
    gravity: SKATE.gravity,
    halfHeight: SKATER_HALF_HEIGHT,
    extra: { turnRate: SKATE.turnRate, note: "the skater keeps its speed and steers: it does not strafe. A and D steer AND give left/right for tricks." },
  };
}

// ctx: { ti (window.__ti), intents (the page's intent API), skaterObject, render(), now() }.
export function createTrickHooks(ctx) {
  const { ti } = ctx;
  const now = ctx.now ?? (() => performance.now());
  return {
    player: () => playerFromSim(ti.sim, ctx.skaterObject ?? null),
    movement: movementNumbers,
    controls: () => controlsFromKeys(ti.inp.keys),
    restart: () => ti.reset({}),
    levels: () => ({ levels: ["trick-input greybox"], playing: "trick-input greybox" }),
    pause: (p) => {
      ti.pause(p);
      return ti.paused();
    },
    paused: () => ti.paused(),
    gameTime: () => ti.sim.t,
    classOf: (o) => o?.userData?.class ?? null,
    render: ctx.render,
    // The agent reads the state and calls the intent log by name:
    //   game.call("playtest", "intend", "l")   before a trick press
    //   game.call("playtest", "metrics")       the 3 metrics so far
    objects: { ti, playtest: ctx.intents },
    // Skate toward a direction: hold push (or brake) and steer until the heading matches.
    async move({ direction, seconds, scale, keys }) {
      const k = ti.inp.keys;
      const push = scale < 0 ? k.brake[0] : k.push[0];
      const left = k.steerLeft[0];
      const right = k.steerRight[0];
      const until = ti.sim.t + seconds - DT / 2;
      const wallUntil = now() + seconds * 1000 * MOVE_WALL_FACTOR;
      let steering = null;
      keys.hold(push);
      try {
        while (ti.sim.t < until && now() < wallUntil) {
          const want = steerToward(ti.sim.yaw, direction);
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
