import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createLevelEnv } from "../../level/ground.js";
import { GREYBOX } from "../../level/greybox.js";
import { createSkaterEnv } from "../skate/skater.js";
import { createSkateState, stepSkate } from "../skate/controller.js";
import { BEAT } from "../skate/constants.js";
import { chainStrips, followLineScript, pointAt } from "../../playtest/trail-script.js";
import { BELTLINE_SKATERS, GREYBOX_SKATERS, PILOT, beatPhase, createNpcSkaters, projectNear, skaterObstacles, stepNpcSkaters } from "./skaters.js";
import { createPath } from "./path.js";
import { createCrowd, stepCrowd } from "./crowd.js";

const BELTLINE = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const DT = 1 / 60;
const MINUTE = 60 * 60;

const worlds = {
  beltline: { level: BELTLINE, env: createLevelEnv(BELTLINE), skaterEnv: createSkaterEnv(BELTLINE) },
  greybox: { level: GREYBOX, env: createLevelEnv(GREYBOX), skaterEnv: createSkaterEnv(GREYBOX) },
};

// Runs the NPCs for `ticks`. `player(tick)` gives the player position or
// null. Returns the end state and the closest NPC distance to the player.
function ride(world, specs, ticks, { player = () => null, beat = null } = {}) {
  let st = createNpcSkaters(world.level, { specs, env: world.env });
  let closest = Infinity;
  const danceStarts = [];
  for (let i = 0; i < ticks; i += 1) {
    const p = player(i);
    const b = beat ? { time: i * DT, bpm: beat } : null;
    st = stepNpcSkaters(st, DT, world.env, world.skaterEnv, { player: p, beat: b });
    for (const n of st.npcs) {
      if (n.input.style1 || n.input.style2) danceStarts.push(b ? beatPhase(b) : 0);
      if (p) closest = Math.min(closest, Math.hypot(n.skater.position[0] - p[0], n.skater.position[2] - p[2]));
    }
  }
  return { st, closest, danceStarts };
}

function expectClean(npc) {
  expect(npc.stats.falls, `${npc.id} falls`).toBe(0);
  expect(npc.stats.respawns, `${npc.id} respawns`).toBe(0);
  expect(npc.stats.bonks, `${npc.id} wall bonks`).toBe(0);
}

describe("NPC skaters", () => {
  it("puts at least 4 NPC skaters on the BeltLine block, on the trail", () => {
    const st = createNpcSkaters(BELTLINE, { env: worlds.beltline.env });
    expect(st.npcs.length).toBeGreaterThanOrEqual(4);
    const trailIds = new Set(BELTLINE.strips.filter((s) => s.kind === "trail").map((s) => s.id));
    for (const n of st.npcs) expect(trailIds.has(n.skater.groundId), `${n.id} on ${n.skater.groundId}`).toBe(true);
  });

  for (const spec of BELTLINE_SKATERS) {
    it(`BeltLine: ${spec.id} rides 60 s with no fall and no wall bonk`, () => {
      const { st } = ride(worlds.beltline, [spec], MINUTE);
      const [npc] = st.npcs;
      expectClean(npc);
      // It moves, it turns at the window ends, and it does its tricks.
      expect(npc.stats.turns).toBeGreaterThanOrEqual(1);
      expect(npc.stats.jumps + npc.stats.dances).toBeGreaterThanOrEqual(4);
      // It stays within its window (plus the turn-around room).
      expect(npc.s).toBeGreaterThan(npc.route.from - 15);
      expect(npc.s).toBeLessThan(npc.route.to + 15);
    });
  }

  for (const spec of GREYBOX_SKATERS) {
    it(`greybox: ${spec.id} rides 60 s with no fall and no wall bonk`, () => {
      const { st } = ride(worlds.greybox, [spec], MINUTE);
      const [npc] = st.npcs;
      expectClean(npc);
      expect(npc.stats.turns).toBeGreaterThanOrEqual(2);
      if (spec.grind) expect(npc.stats.grinds, `${npc.id} grinds`).toBeGreaterThanOrEqual(4);
      else expect(npc.stats.jumps + npc.stats.dances).toBeGreaterThanOrEqual(4);
    });
  }

  it("rides the full BeltLine set together for 60 s, with no fall, no bonk, and no NPC contact", () => {
    let st = createNpcSkaters(BELTLINE, { env: worlds.beltline.env });
    let minGap = Infinity;
    for (let i = 0; i < MINUTE; i += 1) {
      st = stepNpcSkaters(st, DT, worlds.beltline.env, worlds.beltline.skaterEnv);
      for (let a = 0; a < st.npcs.length; a += 1) {
        for (let b = a + 1; b < st.npcs.length; b += 1) {
          const pa = st.npcs[a].skater.position;
          const pb = st.npcs[b].skater.position;
          minGap = Math.min(minGap, Math.hypot(pa[0] - pb[0], pa[2] - pb[2]));
        }
      }
    }
    st.npcs.forEach(expectClean);
    // Two skater bodies are 0.3 m in radius: 0.6 m is a contact.
    expect(minGap).toBeGreaterThan(0.8);
  });

  it("rides 60 s through the seeded BeltLine crowd, with no fall, no bonk, and no contact", () => {
    let crowd = createCrowd(BELTLINE, { seed: 1 });
    let st = createNpcSkaters(BELTLINE, { env: worlds.beltline.env, avoid: crowd.npcs });
    let closest = Infinity;
    for (let i = 0; i < MINUTE; i += 1) {
      crowd = stepCrowd(crowd, DT, BELTLINE.spawn.position, skaterObstacles(st));
      st = stepNpcSkaters(st, DT, worlds.beltline.env, worlds.beltline.skaterEnv, { player: BELTLINE.spawn.position, crowd: crowd.npcs });
      for (const n of st.npcs) {
        for (const c of crowd.npcs) closest = Math.min(closest, Math.hypot(n.skater.position[0] - c.x, n.skater.position[2] - c.z) - c.radius);
      }
    }
    st.npcs.forEach(expectClean);
    // A skater body is 0.3 m in radius. No skater runs into the crowd, and
    // a crowd NPC does not step into a skater who waits (crowd.js).
    expect(closest).toBeGreaterThan(0.1);
    // They still ride: at least 150 m each in the minute.
    for (const n of st.npcs) expect(n.stats.distance, `${n.id} distance`).toBeGreaterThan(150);
  });

  it("is deterministic: two runs give the same states", () => {
    const a = ride(worlds.beltline, BELTLINE_SKATERS, 1200).st;
    const b = ride(worlds.beltline, BELTLINE_SKATERS, 1200).st;
    expect(a.npcs.map((n) => n.skater.position)).toEqual(b.npcs.map((n) => n.skater.position));
    expect(a.npcs.map((n) => n.stats)).toEqual(b.npcs.map((n) => n.stats));
  });

  it("steers around a player who stands on the trail, with no fall and no bonk", () => {
    const [trail] = chainStrips(BELTLINE.strips, "trail");
    const path = createPath(trail);
    const st0 = createNpcSkaters(BELTLINE, { env: worlds.beltline.env });
    const { base } = st0.npcs[0].route;
    for (const [ds, side] of [
      [0, 0],
      [-60, 1],
      [70, -1.2],
    ]) {
      const [x, z] = pointAt(trail, base + ds);
      const g = worlds.beltline.env.sampleGround(x, z, 30);
      // A small side offset: the right of the +s direction.
      const s = projectNear(path, x, z, base + ds);
      const a = pointAt(trail, s - 1);
      const b = pointAt(trail, s + 1);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const p = [x - ((b[1] - a[1]) / len) * side, g.height, z + ((b[0] - a[0]) / len) * side];
      const { st, closest } = ride(worlds.beltline, BELTLINE_SKATERS, MINUTE, { player: () => p });
      st.npcs.forEach(expectClean);
      // The player body (0.35 m) and an NPC body (0.3 m) touch at 0.65 m.
      expect(closest, `closest NPC to a player at ${ds} m`).toBeGreaterThan(0.8);
    }
  });

  it("steers around a player who rides the trail, with no fall and no bonk", () => {
    const [trail] = chainStrips(BELTLINE.strips, "trail");
    const { script } = followLineScript(trail, BELTLINE.spawn, worlds.beltline.env, { frames: MINUTE, cruise: 6 });
    // Replay the player ride and record the positions.
    const positions = [];
    let s = createSkateState({ position: BELTLINE.spawn.position, yaw: BELTLINE.spawn.yaw });
    for (const e of script) {
      for (let i = 0; i < e.frames; i += 1) {
        s = stepSkate(s, e.input, DT, worlds.beltline.env);
        positions.push(s.position);
      }
    }
    const { st, closest } = ride(worlds.beltline, BELTLINE_SKATERS, MINUTE, { player: (i) => positions[i] });
    st.npcs.forEach(expectClean);
    expect(closest).toBeGreaterThan(0.8);
  });

  it("starts each dance on the beat when a beat clock runs", () => {
    const { st, danceStarts } = ride(worlds.beltline, BELTLINE_SKATERS, MINUTE, { beat: BEAT.bpm });
    st.npcs.forEach(expectClean);
    expect(danceStarts.length).toBeGreaterThanOrEqual(10);
    // The phase after the start tick is under one tick of beat (100 BPM: 1/36 of a beat).
    for (const phase of danceStarts) expect(phase).toBeLessThan((DT * BEAT.bpm) / 60 + 1e-9);
  });

  it("never changes the player: the NPC step takes the player position only", () => {
    const player = [BELTLINE.spawn.position[0], BELTLINE.spawn.position[1], BELTLINE.spawn.position[2]];
    const copy = [...player];
    ride(worlds.beltline, BELTLINE_SKATERS, 120, { player: () => player });
    expect(player).toEqual(copy);
  });
});

describe("NPC skaters far-step (#189)", () => {
  it("rides 60 s far from the camera on the long step, with no fall, no bonk, and no NPC contact", () => {
    // The camera far off: every NPC steps every PILOT.far stride ticks.
    const focus = [1e5, 1e5];
    let st = createNpcSkaters(BELTLINE, { env: worlds.beltline.env });
    let minGap = Infinity;
    let skipped = 0;
    for (let i = 0; i < MINUTE; i += 1) {
      const before = st.npcs;
      st = stepNpcSkaters(st, DT, worlds.beltline.env, worlds.beltline.skaterEnv, { focus });
      skipped += st.npcs.filter((n, k) => n === before[k]).length;
      for (let a = 0; a < st.npcs.length; a += 1) {
        for (let b = a + 1; b < st.npcs.length; b += 1) {
          const pa = st.npcs[a].skater.position;
          const pb = st.npcs[b].skater.position;
          minGap = Math.min(minGap, Math.hypot(pa[0] - pb[0], pa[2] - pb[2]));
        }
      }
    }
    const stride = PILOT.far[PILOT.far.length - 1][1];
    expect(skipped).toBe(st.npcs.length * MINUTE * (1 - 1 / stride));
    st.npcs.forEach(expectClean);
    expect(minGap).toBeGreaterThan(0.8);
    for (const n of st.npcs) {
      expect(n.stats.distance, `${n.id} distance`).toBeGreaterThan(150);
      expect(n.stats.jumps + n.stats.dances).toBeGreaterThanOrEqual(4);
    }
  });

  it("steps an NPC near the camera on every tick", () => {
    let st = createNpcSkaters(BELTLINE, { env: worlds.beltline.env });
    const [x, , z] = st.npcs[0].skater.position;
    for (let i = 0; i < 30; i += 1) {
      const before = st.npcs[0];
      st = stepNpcSkaters(st, DT, worlds.beltline.env, worlds.beltline.skaterEnv, { focus: [st.npcs[0].skater.position[0], st.npcs[0].skater.position[2]] });
      expect(st.npcs[0]).not.toBe(before);
    }
    expect(Math.hypot(st.npcs[0].skater.position[0] - x, st.npcs[0].skater.position[2] - z)).toBeGreaterThan(0);
  });
});


describe("the body of an NPC skater", () => {
  it("is SKATE, not the player's body from skaterEnv", async () => {
    const { bodyFor, skateFor } = await import("../skate/body.js");
    const world = worlds.greybox;
    const run = (skaterEnv) => {
      let st = createNpcSkaters(world.level, { specs: GREYBOX_SKATERS, env: world.env });
      for (let i = 0; i < 600; i += 1) st = stepNpcSkaters(st, DT, world.env, skaterEnv);
      return st.npcs.map((n) => [...n.skater.position, n.skater.speed]);
    };
    // The player is Marcus: his body and his dances must not reach the NPCs.
    const asMarcus = { ...world.skaterEnv, skater: "marcus", skate: skateFor(bodyFor("marcus")) };
    const asNia = { ...world.skaterEnv, skater: "nia", skate: skateFor(bodyFor("nia")) };
    expect(run(asMarcus)).toEqual(run(asNia));
    expect(bodyFor("constructor")).toBeNull();
  });
});
