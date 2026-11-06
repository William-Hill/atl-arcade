// NPCs on the BeltLine: roller skaters, joggers, cyclists, dog walkers,
// families, and walkers. Pure and seeded: the same level and seed give the
// same crowd, step for step. No Three.js here.
//
// Each NPC rides a center line from the level (the trail or a sidewalk) at
// an arc length `s` and a side offset. A positive offset is on the right of
// the +s direction. NPCs keep right, pass slower NPCs in the middle, and
// give way to Nia. A move that would overlap another NPC does not happen,
// so NPCs never overlap. Nia bumps them softly: they step aside and wobble,
// and they never fall. The crowd does not change Nia's motion.

import { chainStrips, projectOnLine } from "../../playtest/trail-script.js";
import { createPath, pathOffsetPoint, pathTangent } from "./path.js";

// radius: the circle that must not overlap (m). speed: the cruise speed
// (m/s). lane: the keep-right offset from the center line (m).
export const NPC_TYPES = {
  skater: { radius: 0.4, speed: 4.5 },
  jogger: { radius: 0.4, speed: 3.0 },
  cyclist: { radius: 0.6, speed: 5.5 },
  dogWalker: { radius: 0.6, speed: 1.4 },
  family: { radius: 0.8, speed: 1.1 },
  walker: { radius: 0.35, speed: 1.3 },
};

export const CROWD = {
  // Nia's contact radius (m), the same as the skater capsule.
  niaRadius: 0.35,
  // NPCs give way when Nia is closer than this (m).
  giveWayDistance: 9,
  // NPCs look this far ahead for a slower NPC (m).
  lookAhead: 12,
  accel: 2.5,
  lateralSpeed: 1.2,
  // The bump wobble time (s). The lean in the render stays under maxLean.
  bumpTime: 0.8,
  maxLean: 0.25,
  // An NPC that cannot move for this long turns around (s).
  stuckTime: 2,
};

// The default crowd for a geodata level. Trail NPCs: half near the spawn,
// so the player sees them, half along the full trail.
export const DEFAULT_MIX = {
  trail: { skater: 7, jogger: 6, cyclist: 5, dogWalker: 5, family: 5 },
  sidewalk: { lines: 4, perLine: 3, types: ["walker", "jogger"] },
};

// A small seeded random generator (mulberry32).
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// The lines NPCs use: the longest trail chain, and the sidewalk and park
// path chains nearest to the spawn (longer than 80 m).
export function crowdLines(level, { sidewalkLines = DEFAULT_MIX.sidewalk.lines, near = 200 } = {}) {
  const lines = [];
  const trailWidth = level.strips.find((s) => s.kind === "trail")?.width ?? 4.3;
  const [trail] = chainStrips(level.strips, "trail");
  if (trail) lines.push({ kind: "trail", path: createPath(trail), halfWidth: trailWidth / 2, lane: 1.1, passLane: 0, height: level.surfaces?.trail ?? 0 });
  const [sx, , sz] = level.spawn.position;
  const walks = [];
  for (const kind of ["sidewalk", "path"]) {
    // The narrowest strip of the kind sets the lane room.
    const width = Math.min(...level.strips.filter((s) => s.kind === kind).map((s) => s.width), 2);
    for (const points of chainStrips(level.strips, kind)) {
      const path = createPath(points);
      const d = projectOnLine(points, sx, sz).d;
      if (path.length > 80 && d < near) walks.push({ kind, path, d, width });
    }
  }
  walks.sort((a, b) => a.d - b.d);
  for (const l of walks.slice(0, sidewalkLines)) {
    lines.push({ kind: l.kind, path: l.path, halfWidth: l.width / 2, lane: 0.45, passLane: 0.45, height: level.surfaces?.[l.kind] ?? 0 });
  }
  return lines;
}

function place(npc, lines) {
  const line = lines[npc.line];
  const [x, z] = pathOffsetPoint(line.path, npc.s, npc.offset);
  const [tx, tz] = pathTangent(line.path, npc.s);
  return { ...npc, x, z, y: line.height, fx: tx * npc.dir, fz: tz * npc.dir };
}

// True when a step from (fx, fz) to (x, z) goes deeper into one of the
// `others` (the skaters): a crowd NPC does not walk into a skater who waits.
// A step that moves away from an overlap is allowed, so an NPC that a
// skater rolled into is never stuck.
function intoOthers(others, fx, fz, x, z, r) {
  for (const o of others) {
    const rr = r + o.radius;
    const d2 = (o.x - x) ** 2 + (o.z - z) ** 2;
    if (d2 < rr * rr && d2 < (o.x - fx) ** 2 + (o.z - fz) ** 2) return true;
  }
  return false;
}

function overlapsAny(list, i, x, z, r) {
  for (let j = 0; j < list.length; j += 1) {
    if (j === i) continue;
    const o = list[j];
    const rr = r + o.radius;
    const dx = o.x - x;
    const dz = o.z - z;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}

// Spawns a seeded crowd. Returns { lines, npcs, tick, bumps }.
export function createCrowd(level, { seed = 1, mix = DEFAULT_MIX } = {}) {
  const rand = seededRandom(seed);
  const lines = crowdLines(level, { sidewalkLines: mix.sidewalk?.lines ?? 0 });
  const npcs = [];
  const add = (type, lineIndex, sFor) => {
    const line = lines[lineIndex];
    const t = NPC_TYPES[type];
    for (let tries = 0; tries < 60; tries += 1) {
      const dir = rand() < 0.5 ? 1 : -1;
      const s = clamp(sFor(), 2, line.path.length - 2);
      const npc = place(
        {
          id: npcs.length,
          type,
          line: lineIndex,
          s,
          dir,
          offset: dir * line.lane,
          radius: t.radius,
          cruise: t.speed * (0.85 + 0.3 * rand()),
          speed: 0,
          vx: 0,
          vz: 0,
          bump: 0,
          stuck: 0,
          phase: rand() * Math.PI * 2,
        },
        lines,
      );
      npc.speed = npc.cruise;
      if (!overlapsAny(npcs, -1, npc.x, npc.z, npc.radius + 0.5)) {
        npcs.push(npc);
        return;
      }
    }
  };

  const trailIndex = lines.findIndex((l) => l.kind === "trail");
  if (trailIndex >= 0 && mix.trail) {
    const line = lines[trailIndex];
    const spawnS = projectOnLine(line.path.points, level.spawn.position[0], level.spawn.position[2]).s;
    let k = 0;
    for (const [type, count] of Object.entries(mix.trail)) {
      for (let i = 0; i < count; i += 1) {
        // Every second NPC goes within 200 m of the spawn.
        const nearSpawn = k % 2 === 0;
        k += 1;
        add(type, trailIndex, () => (nearSpawn ? spawnS + (rand() * 2 - 1) * 200 : rand() * line.path.length));
      }
    }
  }
  if (mix.sidewalk) {
    lines.forEach((line, li) => {
      if (line.kind === "trail") return;
      for (let i = 0; i < mix.sidewalk.perLine; i += 1) {
        const type = mix.sidewalk.types[Math.floor(rand() * mix.sidewalk.types.length)];
        add(type, li, () => rand() * line.path.length);
      }
    });
  }
  return { lines, npcs, tick: 0, bumps: 0 };
}

// Steps the crowd by dt. `nia` is Nia's position [x, y, z] (or null).
// The NPCs move in order and each move checks the NPCs that moved before
// it, so no two NPCs overlap after a step. `others` is an optional list of
// { x, z, radius, vx, vz }: the NPC skaters (#134). The crowd sees them in
// the look-ahead, so it slows down behind them and passes them. They are
// not in the overlap test, so a skater never freezes the crowd.
export function stepCrowd(crowd, dt, nia = null, others = []) {
  const { lines } = crowd;
  const list = crowd.npcs.map((n) => ({ ...n }));
  const seen = others.length ? list.concat(others) : list;
  let bumps = crowd.bumps;
  const nx = nia ? nia[0] : 0;
  const nz = nia ? nia[2] : 0;

  for (let i = 0; i < list.length; i += 1) {
    const n = list[i];
    const line = lines[n.line];
    const maxOff = line.halfWidth - n.radius;
    const rx = -n.fz;
    const rz = n.fx;
    let want = n.cruise;
    let target = n.dir * line.lane;

    // Slower NPCs ahead, and NPCs that come the other way in this lane.
    let blocked = false;
    let oncoming = false;
    for (let j = 0; j < seen.length; j += 1) {
      if (j === i) continue;
      const o = seen[j];
      const dx = o.x - n.x;
      const dz = o.z - n.z;
      const along = dx * n.fx + dz * n.fz;
      if (along <= 0 || along > CROWD.lookAhead) continue;
      const side = dx * rx + dz * rz;
      const clear = n.radius + o.radius + 0.3;
      if (Math.abs(side) >= clear) continue;
      const gap = along - n.radius - o.radius;
      const otherAlong = o.vx * n.fx + o.vz * n.fz;
      if (otherAlong < 0) oncoming = true;
      want = Math.min(want, Math.max(0, Math.max(0, otherAlong) + (gap - 1.5) * 0.8));
      if (otherAlong < n.cruise * 0.85) blocked = true;
    }
    // Pass in the middle lane, but not when an NPC comes the other way.
    if (blocked && !oncoming) target = n.dir * line.passLane;
    if (oncoming) target = n.dir * maxOff;

    // Give way to Nia: step to the side away from her and slow down.
    let niaOffset = null;
    if (nia) {
      const dx = nx - n.x;
      const dz = nz - n.z;
      const d = Math.hypot(dx, dz);
      if (d < CROWD.giveWayDistance) {
        niaOffset = n.offset + n.dir * (dx * rx + dz * rz);
        target = niaOffset >= n.offset ? -maxOff : maxOff;
        want = Math.min(want, n.cruise * 0.6);
      }
    }
    target = clamp(target, -maxOff, maxOff);

    const accel = CROWD.accel * dt;
    n.speed = clamp(want, n.speed - accel, n.speed + accel);
    const latStep = clamp(target - n.offset, -CROWD.lateralSpeed * dt, CROWD.lateralSpeed * dt);
    let s = n.s + n.dir * n.speed * dt;
    let dir = n.dir;
    if (s > line.path.length - 1 || s < 1) {
      s = clamp(s, 1, line.path.length - 1);
      dir = -dir;
    }

    // Try the full move, then the side step only, then the forward step only.
    const tries = [
      [s, n.offset + latStep],
      [n.s, n.offset + latStep],
      [s, n.offset],
    ];
    const ox = n.x;
    const oz = n.z;
    let moved = false;
    for (const [ts, toff] of tries) {
      const c = place({ ...n, s: ts, offset: toff, dir }, lines);
      if (!overlapsAny(list, i, c.x, c.z, n.radius) && !intoOthers(others, n.x, n.z, c.x, c.z, n.radius)) {
        Object.assign(n, c);
        moved = true;
        break;
      }
    }
    if (!moved) n.speed = 0;
    n.vx = (n.x - ox) / dt;
    n.vz = (n.z - oz) / dt;
    const progressed = Math.hypot(n.vx, n.vz) > 0.05;
    n.stuck = progressed ? 0 : n.stuck + dt;
    if (n.stuck > CROWD.stuckTime) {
      Object.assign(n, place({ ...n, dir: -n.dir }, lines));
      n.stuck = 0;
    }

    // A soft bump from Nia: the NPC slides aside (if there is room) and
    // wobbles. It never falls.
    n.bump = Math.max(0, n.bump - dt);
    if (nia) {
      const dx = n.x - nx;
      const dz = n.z - nz;
      const d = Math.hypot(dx, dz);
      const reach = n.radius + CROWD.niaRadius;
      if (d < reach) {
        if (n.bump === 0) bumps += 1;
        n.bump = CROWD.bumpTime;
        const away = n.dir * (dx * rx + dz * rz) >= 0 ? 1 : -1;
        const pushed = place({ ...n, offset: clamp(n.offset + away * (reach - d + 0.05), -maxOff, maxOff) }, lines);
        if (!overlapsAny(list, i, pushed.x, pushed.z, n.radius)) Object.assign(n, pushed);
      }
    }
    n.lean = (n.bump / CROWD.bumpTime) * CROWD.maxLean;
    n.phase += dt * (1 + n.speed * 2);
  }
  return { lines, npcs: list, tick: crowd.tick + 1, bumps };
}

// The smallest gap between two NPC circles (m). Negative means an overlap.
export function minGap(npcs) {
  let best = Infinity;
  for (let i = 0; i < npcs.length; i += 1) {
    for (let j = i + 1; j < npcs.length; j += 1) {
      const a = npcs[i];
      const b = npcs[j];
      best = Math.min(best, Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius);
    }
  }
  return best;
}
