// NPC roller skaters (#134). Pure: no Three.js here. Each NPC skater rides
// the same pure skater controller as the player (src/sim/skate/skater.js).
// A pilot turns the NPC state into a controller input on each tick, so the
// NPC skates with the same rules as the player: pushes, carves, brakes,
// jumps, grinds, and dances.
//
// The pilot rides back and forth on a route: a window of a center line (the
// BeltLine trail on a geodata level, a street line on the greybox). It keeps
// right, turns around at the window ends, and does its tricks on a fixed
// timetable. With the same level, specs, and obstacles, the result is the
// same, tick for tick.
//
// The NPCs are not obstacles for the player: the player controller never
// sees them, so an NPC can never end the player's combo. The NPCs steer
// around the player, around each other, and around the crowd.

import { createPath, pathOffsetPoint, pathPoint, pathTangent } from "./path.js";
import { chainStrips, projectOnLine } from "../../playtest/trail-script.js";
import { createSkater, stepSkater } from "../skate/skater.js";
import { FLAT_GROUND, yawFromHeading } from "../skate/controller.js";
import { GRIND } from "../skate/constants.js";
import { farStride, stepsOnTick, viewerDistance } from "../far-step.js";

export const PILOT = {
  lookAhead: 6, // m ahead on the route for the steer target.
  gain: 2.2, // steer per radian of heading error.
  turnError: 0.6, // rad of heading error above which the NPC slows for a turn.
  turnSpeed: 2.4, // m/s for a turn-around.
  lateralSpeed: 2.5, // m/s the lane offset changes.
  uTurn: 2, // rad of heading error above which the NPC makes a U-turn to the left.
  avoidAhead: 22, // m ahead (on the route) that the NPC looks for an obstacle.
  avoidBehind: 1.5, // m behind that still counts (an obstacle at the side).
  passClearance: 0.6, // m kept at the side of a crowd NPC or another NPC skater.
  clearance: 1.3, // m kept at the side of an obstacle when the NPC passes it.
  stopGap: 2.2, // m kept in front of an obstacle that the NPC cannot pass.
  crawl: 1.2, // m/s while the NPC steps aside in front of an obstacle.
  contact: 1.1, // m ahead at which the NPC stops for an obstacle in its lane.
  giveUp: 1, // s held still in front of an obstacle before the NPC turns around.
  sideRoom: 0.4, // m past the route half width that the NPC may use to pass.
  trickClear: 10, // m of free route ahead needed to start a trick.
  endClear: 12, // m from a window end needed to start a trick.
  trickSpeed: 3, // m/s needed to start a jump or a dance.
  grindHold: 0.3, // s the grind button stays down after the grind window.
  // Far-step (#189): an NPC skater this far (m) from the camera and the
  // player steps every `stride` ticks (src/sim/far-step.js). Past the draw
  // distance of the high tier (NPC_DRAW in src/render/npc-skaters-view.js).
  far: [[90, 2]],
};

// The NPC skaters on the BeltLine (geodata levels). `from`, `to`, and
// `start` are arc lengths on the trail, relative to the arc length of the
// player spawn. `outfit` names an entry in src/render/npc-skaters-view.js.
// A trick list plays in a loop: `every` s after the previous trick.
export const BELTLINE_SKATERS = [
  { id: "kiana", model: "nia", outfit: "cobalt", from: -150, to: 130, start: 30, dir: 1, cruise: 5.5, tricks: [{ kind: "groove", every: 6 }, { kind: "jump", every: 5 }] },
  { id: "dre", model: "marcus", outfit: "sunset", from: -150, to: 130, start: -40, dir: -1, cruise: 6.5, tricks: [{ kind: "jump", every: 4 }, { kind: "spin", every: 5 }] },
  { id: "tasha", model: "nia", outfit: "plum", from: -150, to: 130, start: 90, dir: -1, cruise: 4.5, tricks: [{ kind: "spin", every: 7 }, { kind: "groove", every: 6 }] },
  { id: "jalen", model: "marcus", outfit: "lime", from: -150, to: 130, start: -110, dir: 1, cruise: 6, tricks: [{ kind: "groove", every: 5 }, { kind: "jump", every: 6 }] },
  { id: "rae", model: "marcus", outfit: "berry", from: -150, to: 130, start: 60, dir: 1, cruise: 7, tricks: [{ kind: "jump", every: 3.5 }] },
];

// The NPC skaters on the greybox. The routes are explicit street lines, and
// the first one runs over the straight rail, so that NPC grinds it.
export const GREYBOX_SKATERS = [
  {
    id: "dre",
    model: "marcus",
    outfit: "sunset",
    line: [
      [-29, -2],
      [-1, -2],
    ],
    halfWidth: 3,
    lane: 0,
    from: 2,
    to: 26,
    start: 4,
    dir: 1,
    cruise: 6,
    grind: [{ from: 7, to: 21 }],
    tricks: [],
  },
  {
    id: "kiana",
    model: "nia",
    outfit: "cobalt",
    line: [
      [-12, 4],
      [20, 4],
    ],
    halfWidth: 1.4,
    lane: 0,
    from: 2,
    to: 30,
    start: 16,
    dir: -1,
    cruise: 5,
    tricks: [{ kind: "spin", every: 3 }, { kind: "jump", every: 3 }],
  },
];

const TRICK_INPUT = {
  jump: { jump: true },
  groove: { style1: true },
  spin: { style2: true },
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// The arc length of the closest point on the path, searched only within
// `span` m of the arc length `near`. A long trail costs O(window) per call.
export function projectNear(path, x, z, near, span = 30) {
  const { points, cum } = path;
  let best = near;
  let bestD = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    if (cum[i + 1] < near - span) continue;
    if (cum[i] > near + span) break;
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 === 0) continue;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < bestD) {
      bestD = d;
      best = cum[i] + t * Math.sqrt(len2);
    }
  }
  return best;
}

// The route for one spec: { path, halfWidth, lane, from, to }.
export function routeFor(level, spec) {
  if (spec.line) {
    const path = createPath(spec.line);
    return { path, halfWidth: spec.halfWidth ?? 2, lane: spec.lane ?? 1, from: spec.from, to: spec.to, base: 0 };
  }
  const [trail] = chainStrips(level.strips ?? [], "trail");
  if (!trail) return null;
  const path = createPath(trail);
  const base = projectOnLine(trail, level.spawn.position[0], level.spawn.position[2]).s;
  const halfWidth = (level.strips.find((s) => s.kind === "trail")?.width ?? 4.3) / 2;
  const from = clamp(base + spec.from, 5, path.length - 5);
  const to = clamp(base + spec.to, 5, path.length - 5);
  return { path, halfWidth, lane: spec.lane ?? 0.9, from, to, base };
}

// The default specs for a level: the BeltLine set on a geodata level, the
// greybox set on the greybox.
export function defaultSkaterSpecs(level) {
  const geo = typeof level?.format === "string" && level.format.startsWith("geo-level/");
  return geo ? BELTLINE_SKATERS : GREYBOX_SKATERS;
}

// `avoid` is a list of { x, z, radius } (the crowd): the start moves ahead
// in 3 m steps until it is clear of them.
function createNpc(spec, route, avoid = []) {
  const dir = spec.dir ?? 1;
  const offset = dir * route.lane;
  let start = clamp(route.base + spec.start, route.from, route.to);
  const blocked = (s) => {
    const [px, pz] = pathOffsetPoint(route.path, s, offset);
    return avoid.some((a) => Math.hypot(a.x - px, a.z - pz) < (a.radius ?? 0.4) + 1.5);
  };
  for (let i = 0; i < 20 && blocked(start); i += 1) start = clamp(start + 3 * dir, route.from, route.to);
  const [x, z] = pathOffsetPoint(route.path, start, offset);
  const [tx, tz] = pathTangent(route.path, start);
  const skater = createSkater(null, { position: [x, 0, z], yaw: yawFromHeading(tx * dir, tz * dir) });
  return {
    id: spec.id,
    spec,
    route,
    s: start,
    dir,
    offset,
    time: 0,
    trick: 0,
    nextTrick: spec.tricks?.length ? spec.tricks[0].every : Infinity,
    grindLeft: 0,
    turning: false,
    pass: null,
    held: 0,
    escaping: false,
    turnSide: 1,
    skater,
    stats: { falls: 0, bonks: 0, slides: 0, turns: 0, jumps: 0, dances: 0, grinds: 0, respawns: 0, blocked: 0, distance: 0 },
  };
}

// Places each NPC on the ground at its start point. On a trail route the
// NPC goes onto the trail surface, not onto a bridge deck above it.
function settle(npc, env, trailIds) {
  const [x, , z] = npc.skater.position;
  let g = env.sampleGround(x, z);
  for (let i = 0; i < 8 && g && trailIds.size && !trailIds.has(g.id); i += 1) g = env.sampleGround(x, z, g.height - 3) ?? g;
  if (g) npc.skater = { ...npc.skater, position: [x, g.height, z], groundNormal: g.normal ?? [0, 1, 0], groundId: g.id ?? null };
  return npc;
}

// Creates the NPC skaters for a level. `specs` defaults to the level set.
// `avoid` is the crowd at the start (a list of { x, z, radius }).
export function createNpcSkaters(level, { specs = defaultSkaterSpecs(level), env = FLAT_GROUND, avoid = [] } = {}) {
  const npcs = [];
  const trailIds = new Set((level.strips ?? []).filter((s) => s.kind === "trail").map((s) => s.id));
  for (const spec of specs) {
    const route = routeFor(level, spec);
    if (!route || route.to - route.from < 20) continue;
    npcs.push(settle(createNpc(spec, route, avoid), env, spec.line ? new Set() : trailIds));
  }
  return { npcs, tick: 0, time: 0 };
}

// The signed offset of (x, z) from the path at arc length s (+ is right of +s).
function offsetAt(path, s, x, z) {
  const [tx, tz] = pathTangent(path, s);
  const [cx, cz] = pathPoint(path, s);
  return (x - cx) * -tz + (z - cz) * tx;
}

// The obstacles in the way, in the route frame. `obstacles` is a list of
// { x, z, r, player, yields }. The player gets a wider berth than the
// others. The NPC does not stop for an obstacle that yields. Each obstacle goes onto the route by its own projection, so
// a curve in the trail does not move it. Returns the NPC offset from the
// route center line (+ is right of +s) and a list of { along, offset, reach }.
function obstaclesAhead(npc, obstacles, k) {
  const { path } = npc.route;
  const [x, , z] = npc.skater.position;
  const here = offsetAt(path, npc.s, x, z);
  const list = [];
  for (const o of obstacles) {
    if (Math.hypot(o.x - x, o.z - z) > k.avoidAhead + 4) continue;
    const so = projectNear(path, o.x, o.z, npc.s, k.avoidAhead + 4);
    const along = (so - npc.s) * npc.dir;
    if (along < -k.avoidBehind || along > k.avoidAhead) continue;
    const offset = offsetAt(path, so, o.x, o.z);
    const reach = (o.r ?? 0.4) + (o.player ? k.clearance : k.passClearance);
    if (Math.abs(offset) > npc.route.halfWidth + k.sideRoom + reach) continue;
    list.push({ along, offset, reach, yields: Boolean(o.yields) });
  }
  return { here, list };
}

// The lane offset that keeps clear of every obstacle, nearest to the
// current offset (and then to the keep-right lane). null when none fits.
function clearLane(list, lane, current, maxOff, previous = null) {
  const candidates = [lane];
  for (const o of list) candidates.push(o.offset + o.reach, o.offset - o.reach);
  let best = null;
  let bestCost = Infinity;
  for (const c of candidates) {
    if (Math.abs(c) > maxOff) continue;
    if (list.some((o) => Math.abs(c - o.offset) < o.reach - 1e-6)) continue;
    // Keep the side chosen on the last tick, so the NPC does not swerve back and forth.
    const cost = Math.abs(c - current) + 0.3 * Math.abs(c - lane) + (previous === null ? 0 : 0.8 * Math.abs(c - previous));
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best;
}

// The input for one NPC on this tick. Pure. Returns { input, npc } where
// `npc` holds the updated pilot fields (not the skater).
export function pilotInput(npc, dt, { obstacles = [], beat = null, k = PILOT } = {}) {
  const sk = npc.skater;
  const route = npc.route;
  const { path } = route;
  const n = { ...npc, stats: { ...npc.stats } };
  n.s = projectNear(path, sk.position[0], sk.position[2], npc.s);
  let dir = n.dir;
  if (dir > 0 && n.s >= route.to) dir = -1;
  else if (dir < 0 && n.s <= route.from) dir = 1;
  if (dir !== n.dir) {
    n.stats.turns += 1;
    n.turning = true;
  }
  n.dir = dir;

  // On a rail: hold the grind and keep the balance. The steer that holds
  // the balance still cancels the lean push and the lean growth.
  if (sk.state === "grind" && sk.grind) {
    const b = sk.grind.balance;
    const hold = (GRIND.balanceDrift * sk.grind.lean + GRIND.balanceGravity * b) / GRIND.balanceCorrect + 2 * b;
    n.grindLeft = k.grindHold;
    return { input: { grind: true, steer: clamp(hold, -1, 1) }, npc: n };
  }

  // The lane: keep right, and pass the obstacles on a side with room.
  const maxOff = route.halfWidth + k.sideRoom - 0.4;
  const lane = dir * route.lane;
  let want = lane;
  let speedCap = Infinity;
  const { here, list } = obstaclesAhead(n, obstacles, k);
  const block = list.length ? list.reduce((a, b) => (b.along < a.along ? b : a)) : null;
  if (!list.length) n.pass = null;
  if (list.length) {
    const fit = clearLane(list, lane, here, maxOff, npc.pass ?? null);
    n.pass = fit;
    if (fit !== null) want = fit;
    else {
      // No room to pass: wait behind the nearest obstacle.
      want = clamp(block.offset >= 0 ? -maxOff : maxOff, -maxOff, maxOff);
      speedCap = Math.max(0, (block.along - k.stopGap) * 0.8);
      n.stats.blocked += 1;
    }
    // On a collision course: slow down, so the side step ends before the
    // obstacle. The NPC keeps a crawl, because a skater with no speed cannot
    // step aside. At contact range it stops.
    let held = null;
    for (const o of list) {
      if (o.along <= 0 || Math.abs(here - o.offset) >= o.reach) continue;
      const stop = o.along < k.contact && !o.yields;
      if (stop) held = o;
      speedCap = Math.min(speedCap, stop ? 0 : Math.max(k.crawl, (o.along - k.stopGap) * 0.8));
    }
    // Held still in front of an obstacle for too long: turn around, in
    // place, away from the obstacle side, and push off when it faces away.
    n.held = held && sk.speed < 0.3 ? (npc.held ?? 0) + dt : 0;
    if (n.held > k.giveUp) {
      n.dir = -dir;
      n.turning = true;
      n.escaping = true;
      // The obstacle is on the right of the travel when dir * (offset - here) > 0: turn left (+1).
      n.turnSide = dir * (held.offset - here) > 0 ? 1 : -1;
      n.held = 0;
      n.pass = null;
      n.stats.turns += 1;
      return { input: { steer: n.turnSide }, npc: n };
    }
  } else n.held = 0;
  const step = k.lateralSpeed * dt;
  n.offset = clamp(n.offset + clamp(want - n.offset, -step, step), -maxOff, maxOff);

  const [px, pz] = pathOffsetPoint(path, clamp(n.s + dir * k.lookAhead, 0, path.length), n.offset);
  const err = wrap(yawFromHeading(px - sk.position[0], pz - sk.position[2]) - sk.yaw);
  const input = {};
  if (sk.state === "rolling") {
    // A keep-right U-turn is always a left turn (+steer turns left).
    if (n.turning && Math.abs(err) < k.turnError) {
      n.turning = false;
      n.escaping = false;
      n.turnSide = 1;
    }
    input.steer = n.turning && Math.abs(err) > k.uTurn ? (n.turnSide ?? 1) : clamp(err * k.gain, -1, 1);
    let target = Math.min(Math.abs(err) > k.turnError ? k.turnSpeed : npc.spec.cruise, speedCap);
    // An escape turns in place until it faces away from the obstacle.
    if (n.escaping && Math.abs(err) > 1) target = 0;
    if (sk.speed < target - 0.2) input.push = true;
    else if (sk.speed > target + 0.6) input.brake = true;
  }

  // Grind windows: hold the grind button while the NPC rides the window.
  const inGrind = (npc.spec.grind ?? []).some((w) => n.s >= w.from && n.s <= w.to);
  if (inGrind && sk.state === "rolling") {
    input.grind = true;
    n.grindLeft = k.grindHold;
  } else if (n.grindLeft > 0) {
    n.grindLeft = Math.max(0, n.grindLeft - dt);
  }

  // Tricks on the timetable. A trick waits for a clear, straight route.
  n.time = npc.time + dt;
  const tricks = npc.spec.tricks ?? [];
  if (tricks.length && n.time >= n.nextTrick && sk.state === "rolling" && !sk.style && !inGrind) {
    const t = tricks[n.trick % tricks.length];
    const ends = Math.min(Math.abs(n.s - route.from), Math.abs(route.to - n.s));
    const clear = !block || block.along > k.trickClear;
    const ready = Math.abs(err) < 0.2 && sk.speed >= k.trickSpeed && ends > k.endClear && clear;
    // A dance waits for the next beat, so it starts on the beat.
    const onBeat = t.kind === "jump" || !beat || beatPhase(beat) < (dt * beat.bpm) / 60;
    if (ready && onBeat) {
      Object.assign(input, TRICK_INPUT[t.kind]);
      if (t.kind === "jump") n.stats.jumps += 1;
      else n.stats.dances += 1;
      n.trick += 1;
      n.nextTrick = n.time + tricks[n.trick % tricks.length].every;
    }
  }
  return { input, npc: n };
}

// The beat phase (0..1) at the beat clock time. `beat` is { time, bpm }.
export function beatPhase(beat) {
  const b = (beat.time * beat.bpm) / 60;
  return b - Math.floor(b);
}

// The NPC skaters as obstacles for the crowd (stepCrowd `others`).
export function skaterObstacles(state) {
  return state.npcs.map((n) => ({ x: n.skater.position[0], z: n.skater.position[2], radius: 0.4, vx: n.skater.velocity[0], vz: n.skater.velocity[2] }));
}

// Steps every NPC skater by one fixed tick. `player` is the player position
// [x, y, z] or null. `crowd` is a list of { x, z, radius } (the crowd NPCs).
// `beat` is { time, bpm } of the beat clock, or null. `focus` is the camera
// [x, z]: with it, an NPC far from the camera and the player steps less
// often (PILOT.far); without it, every NPC steps on every tick.
export function stepNpcSkaters(state, dt, env = FLAT_GROUND, skaterEnv = { grindables: [] }, { player = null, crowd = [], beat = null, focus = null } = {}) {
  const viewers = focus ? [focus] : [];
  if (focus && player) viewers.push([player[0], player[2]]);
  const base = [];
  if (player) base.push({ x: player[0], z: player[2], r: 0.45, player: true });
  // A skater held still by the crowd turns around after PILOT.giveUp s, so
  // the crowd and the skaters cannot block each other for good.
  for (const c of crowd) base.push({ x: c.x, z: c.z, r: c.radius ?? 0.4 });
  const npcs = state.npcs.map((npc, i) => {
    const stride = viewers.length ? farStride(viewerDistance(npc.skater.position[0], npc.skater.position[2], viewers), PILOT.far) : 1;
    if (!stepsOnTick(state.tick, i, stride)) return npc;
    const h = dt * stride;
    const obstacles = base.slice();
    state.npcs.forEach((o, j) => {
      // Two NPC skaters that meet head-on must not both stop: an NPC
      // stops only for an NPC before it in the list. It steps around the rest.
      if (j !== i) obstacles.push({ x: o.skater.position[0], z: o.skater.position[2], r: 0.4, yields: j > i });
    });
    const { input, npc: n } = pilotInput(npc, h, { obstacles, beat });
    const prev = npc.skater;
    const skater = stepSkater(prev, input, h, env, skaterEnv);
    if (skater.bonked) n.stats.bonks += 1;
    if (skater.wallSlide) n.stats.slides += 1;
    if (skater.justFell) n.stats.falls += 1;
    if (skater.respawned) n.stats.respawns += 1;
    if (skater.justSnapped) n.stats.grinds += 1;
    n.stats.distance += Math.hypot(skater.position[0] - prev.position[0], skater.position[2] - prev.position[2]);
    n.skater = skater;
    n.input = input;
    return n;
  });
  return { npcs, tick: state.tick + 1, time: state.time + dt };
}
