import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chainStrips, followLineScript, pointAt } from "../../playtest/trail-script.js";
import { createLevelEnv } from "../../level/ground.js";
import { createSkateState, stepSkate } from "../skate/controller.js";
import { createScriptPlayer } from "../../input/scripted.js";
import { CROWD, NPC_TYPES, createCrowd, minGap, seededRandom, stepCrowd } from "./crowd.js";
import { createPath, pathOffsetPoint, pathPoint } from "./path.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const DT = 1 / 60;

function onLine(crowd, n) {
  const line = crowd.lines[n.line];
  return Math.abs(n.offset) <= line.halfWidth - n.radius + 1e-9;
}

describe("path", () => {
  it("gives the same points as pointAt in trail-script.js", () => {
    const [trail] = chainStrips(LEVEL.strips, "trail");
    const path = createPath(trail);
    for (let s = 0; s < path.length; s += 37.3) {
      const a = pathPoint(path, s);
      const b = pointAt(trail, s);
      expect(a[0]).toBeCloseTo(b[0], 6);
      expect(a[1]).toBeCloseTo(b[1], 6);
    }
  });

  it("puts a positive offset on the right of the direction of travel", () => {
    // A line to the north (-z): the right side is east (+x).
    const path = createPath([
      [0, 0],
      [0, -10],
    ]);
    const [x, z] = pathOffsetPoint(path, 5, 1);
    expect(x).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(-5, 6);
  });
});

describe("crowd", () => {
  it("is the same for the same seed and different for another seed", () => {
    const a = createCrowd(LEVEL, { seed: 7 });
    const b = createCrowd(LEVEL, { seed: 7 });
    const c = createCrowd(LEVEL, { seed: 8 });
    expect(a.npcs.map((n) => [n.x, n.z])).toEqual(b.npcs.map((n) => [n.x, n.z]));
    expect(a.npcs.map((n) => [n.x, n.z])).not.toEqual(c.npcs.map((n) => [n.x, n.z]));
  });

  it("spawns at least 20 NPCs on the trail, of every type in the issue", () => {
    const crowd = createCrowd(LEVEL, { seed: 1 });
    const onTrail = crowd.npcs.filter((n) => crowd.lines[n.line].kind === "trail");
    expect(onTrail.length).toBeGreaterThanOrEqual(20);
    for (const type of ["skater", "jogger", "cyclist", "dogWalker", "family"]) {
      expect(onTrail.some((n) => n.type === type), type).toBe(true);
    }
    expect(crowd.lines.filter((l) => l.kind !== "trail").length).toBe(4);
    // 20 on the trail and 12 on the sidewalks (fewer since 2026-11-07).
    expect(crowd.npcs.length).toBeGreaterThanOrEqual(30);
  });

  // Acceptance (#41): at least 20 NPCs on the trail with no overlap over a
  // 60 s run.
  for (const seed of [1, 2, 3]) {
    it(`keeps every NPC apart and on its line for 60 s (seed ${seed})`, () => {
      let crowd = createCrowd(LEVEL, { seed });
      expect(minGap(crowd.npcs)).toBeGreaterThanOrEqual(0);
      const start = crowd.npcs.map((n) => [n.x, n.z]);
      let worst = Infinity;
      for (let t = 0; t < 60 * 60; t += 1) {
        crowd = stepCrowd(crowd, DT, null);
        worst = Math.min(worst, minGap(crowd.npcs));
        if (t % 60 === 0) for (const n of crowd.npcs) expect(onLine(crowd, n)).toBe(true);
      }
      expect(crowd.npcs.filter((n) => crowd.lines[n.line].kind === "trail").length).toBeGreaterThanOrEqual(20);
      expect(worst).toBeGreaterThanOrEqual(0);
      // They move: most NPCs are more than 20 m from where they started.
      const far = crowd.npcs.filter((n, i) => Math.hypot(n.x - start[i][0], n.z - start[i][1]) > 20).length;
      expect(far).toBeGreaterThan(crowd.npcs.length * 0.6);
    });
  }

  it("keeps NPCs apart and gives way while Nia rides the trail for 60 s", () => {
    const env = createLevelEnv(LEVEL);
    const [trail] = chainStrips(LEVEL.strips, "trail");
    const planned = followLineScript(trail, LEVEL.spawn, env, { frames: 3600 });
    const player = createScriptPlayer(planned.script);
    let s = createSkateState({ position: LEVEL.spawn.position, yaw: LEVEL.spawn.yaw });
    let crowd = createCrowd(LEVEL, { seed: 1 });
    let worst = Infinity;
    let maxLean = 0;
    let closest = Infinity;
    for (let t = 0; t < 3600; t += 1) {
      s = stepSkate(s, player.next() ?? {}, DT, env);
      crowd = stepCrowd(crowd, DT, s.position);
      worst = Math.min(worst, minGap(crowd.npcs));
      for (const n of crowd.npcs) {
        maxLean = Math.max(maxLean, n.lean);
        closest = Math.min(closest, Math.hypot(n.x - s.position[0], n.z - s.position[2]));
      }
    }
    expect(worst).toBeGreaterThanOrEqual(0);
    // Nia passed NPCs on the trail, and a bump never leans an NPC more than
    // the soft limit: nobody falls.
    expect(closest).toBeLessThan(CROWD.giveWayDistance);
    expect(maxLean).toBeLessThanOrEqual(CROWD.maxLean + 1e-9);
  });

  it("bumps an NPC softly when Nia runs into it: it slides aside and wobbles", () => {
    const crowd = createCrowd(LEVEL, { seed: 1 });
    const n = crowd.npcs[0];
    // Nia stands just next to the NPC, on its left.
    const leftX = n.x - n.fz * -1 * 0.3;
    const leftZ = n.z + n.fx * -1 * 0.3;
    const next = stepCrowd(crowd, DT, [leftX, 0, leftZ]);
    const m = next.npcs[0];
    expect(next.bumps).toBe(1);
    expect(m.bump).toBeGreaterThan(0);
    expect(m.lean).toBeGreaterThan(0);
    expect(m.lean).toBeLessThanOrEqual(CROWD.maxLean);
    expect(Math.hypot(m.x - leftX, m.z - leftZ)).toBeGreaterThan(Math.hypot(n.x - leftX, n.z - leftZ));
    // The wobble ends and the NPC rides on.
    let c = next;
    for (let t = 0; t < 120; t += 1) c = stepCrowd(c, DT, null);
    expect(c.npcs[0].lean).toBe(0);
    expect(c.npcs[0].speed).toBeGreaterThan(0);
  });

  it("never steps into a skater who waits in its way", () => {
    const crowd = createCrowd(LEVEL, { seed: 1 });
    const n = crowd.npcs[0];
    // A skater (radius 0.4) at rest 1.5 m ahead, a little to the right.
    const skater = { x: n.x + n.fx * 1.5 - n.fz * 0.3, z: n.z + n.fz * 1.5 + n.fx * 0.3, radius: 0.4, vx: 0, vz: 0 };
    let c = crowd;
    let closest = Infinity;
    for (let t = 0; t < 240; t += 1) {
      c = stepCrowd(c, DT, null, [skater]);
      const m = c.npcs[0];
      closest = Math.min(closest, Math.hypot(m.x - skater.x, m.z - skater.z) - m.radius - skater.radius);
    }
    expect(closest).toBeGreaterThanOrEqual(0);
  });

  it("gives way: an NPC steps to the side away from Nia", () => {
    const crowd = createCrowd(LEVEL, { seed: 1 });
    const n = crowd.npcs[0];
    const line = crowd.lines[n.line];
    // Nia 5 m ahead, on the NPC's own side of the line.
    const nia = [n.x + n.fx * 5, 0, n.z + n.fz * 5];
    let c = crowd;
    for (let t = 0; t < 30; t += 1) c = stepCrowd(c, DT, nia);
    const m = c.npcs[0];
    expect(Math.abs(m.offset - n.offset)).toBeGreaterThan(0.2);
    expect(Math.abs(m.offset)).toBeLessThanOrEqual(line.halfWidth - m.radius + 1e-9);
    expect(m.speed).toBeLessThan(n.cruise);
  });

  it("has a radius and a speed for every type", () => {
    for (const t of Object.values(NPC_TYPES)) {
      expect(t.radius).toBeGreaterThan(0);
      expect(t.speed).toBeGreaterThan(0);
    }
    const r = seededRandom(3);
    const v = r();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

describe("crowd far-step (#189)", () => {
  it("keeps the NPCs apart and on their lines with the camera far off", () => {
    let c = createCrowd(LEVEL, { seed: 1 });
    const start = c.npcs.map((n) => [n.x, n.z]);
    let worst = Infinity;
    for (let t = 0; t < 60 * 30; t += 1) {
      c = stepCrowd(c, DT, null, [], { focus: [1e5, 1e5] });
      worst = Math.min(worst, minGap(c.npcs));
      for (const n of c.npcs) expect(onLine(c, n)).toBe(true);
    }
    expect(worst).toBeGreaterThanOrEqual(0);
    // They still move: most of them by more than 20 m in 30 s.
    const moved = c.npcs.filter((n, i) => Math.hypot(n.x - start[i][0], n.z - start[i][1]) > 20);
    expect(moved.length).toBeGreaterThan(c.npcs.length / 2);
  });

  it("moves a far NPC only on its own ticks, and a near NPC on every tick", () => {
    let c = createCrowd(LEVEL, { seed: 1 });
    const near = c.npcs[0];
    const focus = [near.x, near.z];
    const far = c.npcs.find((n) => Math.hypot(n.x - focus[0], n.z - focus[1]) > CROWD.far[1][0] + 50);
    expect(far).toBeTruthy();
    let nearMoves = 0;
    for (let t = 0; t < 40; t += 1) {
      const before = c;
      c = stepCrowd(c, DT, null, [], { focus });
      const a = before.npcs[far.id];
      const b = c.npcs[far.id];
      if (a.x !== b.x || a.z !== b.z) expect((before.tick + far.id) % CROWD.far[1][1]).toBe(0);
      if (c.npcs[0].x !== before.npcs[0].x || c.npcs[0].z !== before.npcs[0].z) nearMoves += 1;
    }
    expect(nearMoves).toBeGreaterThan(35);
  });

  it("never steps into a skater who waits, with the far-step on", () => {
    const crowd = createCrowd(LEVEL, { seed: 1 });
    const n = crowd.npcs[0];
    const skater = { x: n.x + n.fx * 1.5 - n.fz * 0.3, z: n.z + n.fz * 1.5 + n.fx * 0.3, radius: 0.4, vx: 0, vz: 0 };
    let c = crowd;
    let closest = Infinity;
    for (let t = 0; t < 240; t += 1) {
      // The camera 100 m off: the NPC steps on the long step.
      c = stepCrowd(c, DT, null, [skater], { focus: [n.x + 100, n.z] });
      const m = c.npcs[0];
      closest = Math.min(closest, Math.hypot(m.x - skater.x, m.z - skater.z) - m.radius - skater.radius);
    }
    expect(closest).toBeGreaterThanOrEqual(0);
  });
});
