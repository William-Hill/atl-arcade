import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ACT, POSE, bigCombo, busStops, cheerIds, groupSize, groupSlot, nearestFreePlace, passes, pickRole, placePassed, stayTime, stepToward, takesGoal, walkableAt } from "./ped-activity.js";
import { PEDS, createPeds, pedActivities, pedMinGap, pedRoutes, roomAt, stepPeds } from "./peds.js";
import { createLevelEnv } from "../level/ground.js";
import { createGeoGroundSampler, geoShapes } from "../level/geo/geo-ground.js";
import { terrainOf } from "../level/geo/terrain.js";
import { streetHeightSampler } from "./traffic/traffic.js";
import { pathOffsetPoint, pathTangent } from "./npc/path.js";

const level = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const env = createLevelEnv(level);
const built = pedRoutes(level);
const spawnAt = [level.spawn.position[0], level.spawn.position[2]];
const centroid = (name) => {
  const o = level.buildings.find((b) => b.name === name).outer;
  return [o.reduce((a, p) => a + p[0], 0) / o.length, o.reduce((a, p) => a + p[1], 0) / o.length];
};

function run(state, seconds, opts = {}, each = null) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    stepPeds(state, 1 / 30, opts);
    if (each) each(state);
  }
  return state;
}

describe("the walker roles", () => {
  it("picks a jog, a group, a talk or a walk from one random number", () => {
    const count = (kind, hub) => {
      const out = { jog: 0, group: 0, chat: 0, walk: 0 };
      for (let i = 0; i < 1000; i += 1) out[pickRole((i + 0.5) / 1000, kind, hub)] += 1;
      return out;
    };
    const trail = count("trail", 0);
    expect(trail.jog).toBe(Math.round(ACT.role.trail.jog * 1000));
    expect(trail.group).toBe(Math.round(ACT.role.trail.group * 1000));
    expect(trail.walk).toBeGreaterThan(500);
    // A hub makes a talk more likely.
    expect(count("sidewalk", 1).chat).toBeGreaterThan(count("sidewalk", 0).chat);
    // No talk on the street edge walk.
    expect(count("edge", 1).chat).toBe(0);
  });

  it("makes groups of 2 or 3", () => {
    expect(groupSize(0)).toBe(2);
    expect(groupSize(0.99)).toBe(3);
  });

  it("puts a group member beside the leader, or behind when there is no room", () => {
    const lead = { s: 50, offset: 0.5, dir: 1 };
    expect(groupSlot(lead, 1, -1, 0.75)).toEqual({ s: 50, offset: 0.5 - ACT.groupGap });
    // The second member walks behind, between the two.
    const k2 = groupSlot(lead, 2, -1, 0.75);
    expect(k2.s).toBe(50 - ACT.groupBack);
    expect(k2.offset).toBeCloseTo(0.5 - ACT.groupGap / 2);
    // No room on the asked side: the other side.
    expect(groupSlot({ s: 50, offset: -0.5, dir: 1 }, 1, -1, 0.75).offset).toBeCloseTo(-0.5 + ACT.groupGap);
    // No room at all: in a line behind (the way the leader walks).
    expect(groupSlot({ s: 50, offset: 0, dir: -1 }, 1, 1, 0.3)).toEqual({ s: 50 + ACT.groupBack, offset: 0 });
    expect(groupSlot({ s: 50, offset: 0, dir: -1 }, 2, 1, 0.3)).toEqual({ s: 50 + 2 * ACT.groupBack, offset: 0 });
    // Every slot keeps two walker circles apart.
    for (const k of [1, 2]) {
      const sl = groupSlot(lead, k, -1, 0.75);
      expect(Math.hypot(sl.s - lead.s, sl.offset - lead.offset)).toBeGreaterThan(2 * PEDS.radius);
    }
  });
});

describe("the goal choice", () => {
  it("sees a place when the walker passes its anchor, either way", () => {
    expect(passes(9.8, 10.1, 10)).toBe(true);
    expect(passes(10.1, 9.8, 10)).toBe(true);
    expect(passes(10.1, 10.4, 10)).toBe(false);
    expect(passes(10, 10, 10)).toBe(false);
    const a = { s: 10, user: -1 };
    const b = { s: 20, user: -1 };
    const byRoute = new Map([[3, [a, b]]]);
    expect(placePassed(byRoute, 3, 9.5, 10.2)).toBe(a);
    expect(placePassed(byRoute, 3, 20.5, 19.9)).toBe(b);
    expect(placePassed(byRoute, 3, 12, 13)).toBe(null);
    expect(placePassed(byRoute, 4, 9.5, 10.2)).toBe(null);
    // A place in use is not free.
    a.user = 7;
    expect(placePassed(byRoute, 3, 9.5, 10.2)).toBe(null);
  });

  it("takes a place by its chance and stays for its time", () => {
    for (const kind of ["shop", "bench", "bus"]) {
      expect(takesGoal(0, kind)).toBe(true);
      expect(takesGoal(0.99, kind)).toBe(false);
      expect(stayTime(0, kind)).toBe(ACT.stay[kind][0]);
      expect(stayTime(1, kind)).toBe(ACT.stay[kind][1]);
    }
    expect(takesGoal(0, "street")).toBe(false);
  });

  it("walks to a point in steps and arrives", () => {
    let at = [0, 0, false];
    let n = 0;
    while (!at[2] && n < 100) {
      at = stepToward(at[0], at[1], 3, 4, 1, 0.5);
      n += 1;
    }
    expect(at).toEqual([3, 4, true]);
    expect(n).toBeGreaterThanOrEqual(10);
    expect(n).toBeLessThanOrEqual(11);
  });
});

describe("the places", () => {
  const state = createPeds(level, { seed: 1, count: 2, props: env.props });
  const { list } = state.places;
  const kindOf = new Map(geoShapes(level).map((g) => [g.id, g.kind]));
  const walkable = walkableAt(createGeoGroundSampler(level), kindOf);

  it("has bench seats, bus stop slots and shop door slots", () => {
    const kinds = new Set(list.map((p) => p.kind));
    expect([...kinds].sort()).toEqual(["bench", "bus", "shop"]);
    for (const p of list) expect(p.user).toBe(-1);
    // Two seats per bench at most.
    const benches = env.props.filter((p) => p.kind === "bench" || p.kind === "bench_painted").length;
    expect(list.filter((p) => p.kind === "bench").length).toBeLessThanOrEqual(2 * benches);
    expect(list.filter((p) => p.kind === "bench").length).toBeGreaterThan(benches / 2);
  });

  it("is never on a street, and the way from the route to it crosses no street or building", () => {
    for (const p of list) {
      const r = built.routes[p.route];
      for (const off of [-r.room, 0, r.room]) {
        const [ax, az] = pathOffsetPoint(r.path, p.s, off);
        const d = Math.hypot(p.x - ax, p.z - az);
        // The last 1 m is the bench itself.
        const skip = p.kind === "bench" ? 1 : 0;
        for (let t = 0; t * d <= d - skip; t += 0.05) expect(walkable(ax + (p.x - ax) * t, az + (p.z - az) * t), `${p.kind} ${p.id}`).toBe(true);
      }
    }
  });

  it("puts the bus stops at the curb of a main street, facing the street", () => {
    const highway = new Map(level.strips.filter((s) => s.kind === "street").map((s) => [s.id, s.highway]));
    const streets = createGeoGroundSampler({ ...level, buildings: [], areas: [], strips: level.strips.filter((s) => s.kind === "street") });
    const streetAt = (x, z) => highway.get(streets(x, z)?.id) ?? null;
    const stops = busStops(built, streetAt);
    expect(stops.length).toBeGreaterThan(5);
    for (const st of stops) {
      expect(built.routes[st.route].kind).toBe("sidewalk");
      // A main street 1 to 7 m ahead of the people at the stop.
      let found = false;
      for (let d = 1; d <= 7 && !found; d += 0.5) found = ["trunk", "primary", "secondary", "tertiary"].includes(streetAt(st.x + st.fx * d, st.z + st.fz * d));
      expect(found).toBe(true);
      // The people face across the sidewalk, not along it.
      const [tx, tz] = pathTangent(built.routes[st.route].path, st.s);
      expect(Math.abs(st.fx * tx + st.fz * tz)).toBeLessThan(0.05);
    }
  });

  it("finds the nearest free place", () => {
    const pl = list[0];
    expect(nearestFreePlace(state.places, pl.x + 0.1, pl.z, 5)).toBe(pl);
    pl.user = 1;
    expect(nearestFreePlace(state.places, pl.x + 0.1, pl.z, 5)).not.toBe(pl);
    pl.user = -1;
    expect(nearestFreePlace(state.places, pl.x, pl.z, 5, (q) => q !== pl)).not.toBe(pl);
    expect(nearestFreePlace(state.places, 1e5, 1e5, 30)).toBe(null);
  });

  it("puts more people at the bus stops and in Historic Fourth Ward Park", () => {
    expect(built.hubs.filter((h) => h.kind === "bus").length).toBe(built.stops.length);
    expect(built.hubs.filter((h) => h.kind === "park").length).toBeGreaterThan(5);
  });
});

describe("the activities in the walker pool", () => {
  it("is seeded: the same seed gives the same activities, step for step", () => {
    const a = run(createPeds(level, { seed: 5, count: 40, props: env.props }), 20, { focus: spawnAt });
    const b = run(createPeds(level, { seed: 5, count: 40, props: env.props }), 20, { focus: spawnAt });
    const pick = (s) => s.peds.map((p) => [p.x, p.z, p.pose, p.role, p.goal?.id ?? -1, p.lead, p.talk]);
    expect(pick(a)).toEqual(pick(b));
    const c = run(createPeds(level, { seed: 6, count: 40, props: env.props }), 20, { focus: spawnAt });
    expect(pick(c)).not.toEqual(pick(a));
  });

  it("shows at least 3 kinds of activity besides a walk at the markets, the trail and a bus stop", () => {
    const seen = new Set();
    // The bus stop with the most sidewalk near it.
    const near = (pl) => built.candidates.points.filter((c) => built.routes[c.route].kind === "sidewalk" && Math.hypot(c.x - pl.x, c.z - pl.z) < 80).length;
    const stops = createPeds(level, { seed: 1, count: 2, props: env.props }).places.list.filter((p) => p.kind === "bus");
    const bus = stops.reduce((a, b) => (near(b) > near(a) ? b : a), stops[0]);
    for (const focus of [spawnAt, centroid("Krog Street Market"), centroid("Ponce City Market"), [bus.x, bus.z]]) {
      const state = createPeds(level, { seed: 1, count: 60, radius: 150, props: env.props, focus });
      run(state, 60, { focus }, (s) => {
        if (s.tick % 30) return;
        for (const [k, v] of Object.entries(pedActivities(s))) if (v > 0) seen.add(k);
      });
      expect(pedMinGap(state)).toBeGreaterThanOrEqual(0);
    }
    for (const k of ["jog", "group", "talk", "sit", "shop", "bus"]) expect(seen, k).toContain(k);
  }, 60000);

  it("walks a group together: each member stays near its leader", () => {
    const state = createPeds(level, { seed: 3, count: 60, radius: 150, props: env.props });
    let checked = 0;
    run(state, 30, { focus: spawnAt }, (s) => {
      for (const p of s.peds) {
        if (!p.live || p.lead < 0 || p.talk > 0) continue;
        const lead = s.peds[p.lead];
        if (!lead.live || lead.spawns !== p.leadSpawns || lead.goal) continue;
        expect(Math.hypot(p.x - lead.x, p.z - lead.z)).toBeLessThan(ACT.groupLeave + 1);
        checked += 1;
      }
    });
    expect(checked).toBeGreaterThan(100);
  });

  it("talks in pairs: two people stand and face each other", () => {
    const focus = centroid("Krog Street Market");
    const state = createPeds(level, { seed: 1, count: 60, radius: 150, props: env.props, focus });
    let pairs = 0;
    run(state, 30, { focus }, (s) => {
      for (const p of s.peds) {
        if (!p.live || !(p.talk > 0) || p.pose !== POSE.talk) continue;
        const o = s.peds[p.with];
        expect(p.speed).toBe(0);
        // Facing the partner.
        const d = Math.hypot(o.x - p.x, o.z - p.z);
        expect(((o.x - p.x) * p.fx + (o.z - p.z) * p.fz) / d).toBeGreaterThan(0.99);
        pairs += 1;
      }
    });
    expect(pairs).toBeGreaterThan(30);
  });

  it("jogs faster than a walk, with a longer stride", () => {
    const state = run(createPeds(level, { seed: 2, count: 60, radius: 150, props: env.props }), 10, { focus: spawnAt });
    const jog = state.peds.filter((p) => p.live && p.role === "jog");
    expect(jog.length).toBeGreaterThan(0);
    for (const p of jog) {
      expect(p.cruise).toBeGreaterThanOrEqual(ACT.jogSpeed[0]);
      expect(p.strideLen).toBe(ACT.jogStride);
    }
  });

  it("goes to a bench, sits, then walks back to its route and on", () => {
    const first = createPeds(level, { seed: 1, count: 1, props: env.props });
    const seat0 = first.places.list.find((p) => p.kind === "bench" && built.routes[p.route].kind === "trail");
    const focus = [seat0.x, seat0.z];
    const state = createPeds(level, { seed: 1, count: 1, radius: 150, props: env.props, focus });
    const seat = state.places.list[seat0.id];
    // The goal check says yes (0.3 < the bench chance); the walker is 2 m
    // before the anchor of a free bench seat and walks to it.
    state.rand = () => 0.3;
    const r = built.routes[seat.route];
    const p = state.peds[0];
    Object.assign(p, { route: seat.route, s: seat.s - 2, dir: 1, offset: r.lane, role: "walk", pause: 0, talk: 0, lead: -1, members: 0, want: 0, cheer: 0, speed: 1.2, cruise: 1.2, strideLen: PEDS.stride });
    p.x = pathOffsetPoint(r.path, p.s, p.offset)[0];
    p.z = pathOffsetPoint(r.path, p.s, p.offset)[1];
    const legs = [];
    let sat = 0;
    let taken = null;
    let after = null;
    run(state, 45, { focus }, () => {
      if (after) return;
      if (legs[legs.length - 1] !== p.leg) legs.push(p.leg);
      taken ??= p.goal;
      // The first goal is done: the walker is back on its route.
      if (legs.length === 5) after = { goal: p.goal, user: taken.user, s: p.s, offset: p.offset };
      if (p.leg === "stay") {
        sat += 1;
        expect(p.pose).toBe(POSE.sit);
        expect(Math.hypot(p.x - taken.x, p.z - taken.z)).toBeLessThan(0.01);
        // Facing the bench front.
        expect(p.fx * taken.fx + p.fz * taken.fz).toBeGreaterThan(0.99);
        expect(taken.user).toBe(p.id);
      }
    });
    // One of the two seats of the bench.
    expect(taken.kind).toBe("bench");
    expect(Math.hypot(taken.x - seat.x, taken.z - seat.z)).toBeLessThan(1);
    expect(legs.slice(0, 4)).toEqual([null, "to", "stay", "back"]);
    expect(legs[4]).toBe(null);
    expect(sat / 30).toBeGreaterThanOrEqual(ACT.stay.bench[0] - 0.1);
    // Back on the route, with the seat free again.
    expect(after.user).toBe(-1);
    expect(after.goal).toBe(null);
    expect(roomAt(r, after.s)).toBeGreaterThanOrEqual(Math.abs(after.offset));
  });

  it("keeps the group members off the street props", () => {
    // The Codex repro: seed 3, 90 walkers at Krog Street Market. Member 66
    // walked into the tree at (-0.09, 837.89) before the fix.
    const focus = centroid("Krog Street Market");
    const state = createPeds(level, { seed: 3, count: 90, props: env.props, focus });
    let worst = Infinity;
    let members = 0;
    run(state, 60, { focus }, (st) => {
      for (const p of st.peds) {
        if (!p.live || p.lead < 0) continue;
        members += 1;
        const ix = Math.floor(p.x / 8);
        const iz = Math.floor(p.z / 8);
        for (let a = ix - 1; a <= ix + 1; a += 1) {
          for (let b = iz - 1; b <= iz + 1; b += 1) {
            for (const o of st.props.get(`${a},${b}`) ?? []) worst = Math.min(worst, Math.hypot(p.x - o.x, p.z - o.z) - o.r - PEDS.radius);
          }
        }
      }
    });
    expect(members).toBeGreaterThan(0);
    expect(worst).toBeGreaterThanOrEqual(0);
  });

  it("starts some walkers at a place, in their stay", () => {
    const state = createPeds(level, { seed: 1, count: 90, radius: 200, props: env.props });
    const at = state.peds.filter((p) => p.live && p.leg === "stay");
    expect(at.length).toBeGreaterThan(0);
    for (const p of at) {
      expect(p.goal.user).toBe(p.id);
      expect(Math.hypot(p.x - p.goal.x, p.z - p.goal.z)).toBeLessThan(1e-9);
      expect(p.stay).toBeLessThanOrEqual(ACT.stay[p.goal.kind][1]);
      expect(p.speed).toBe(0);
      expect(p.pose).toBe(p.goal.kind === "bench" ? POSE.sit : POSE.walk);
    }
    expect(pedMinGap(state)).toBeGreaterThanOrEqual(0);
  });

  it("holds each place for one walker at a time", () => {
    const focus = centroid("Ponce City Market");
    const state = createPeds(level, { seed: 4, count: 60, radius: 150, props: env.props, focus });
    let used = 0;
    run(state, 40, { focus }, (s) => {
      const users = new Map();
      for (const p of s.peds) {
        if (!p.live || !p.goal) continue;
        expect(users.has(p.goal.id)).toBe(false);
        users.set(p.goal.id, p.id);
        expect(p.goal.user).toBe(p.id);
      }
      used = Math.max(used, users.size);
    });
    expect(used).toBeGreaterThan(0);
  });

  it("never walks on a street except at a crosswalk: the walkers stay on walks, the trail and open ground", () => {
    // Within 3 m of a mapped crossing (level.crossings) is at the crosswalk.
    const segD = (x, z, a, b) => {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
    };
    const atCrossing = (x, z) => level.crossings.some((c) => c.points.some((a, i) => i < c.points.length - 1 && segD(x, z, a, c.points[i + 1]) < 3));
    const kindOf = new Map(geoShapes(level).map((g) => [g.id, g.kind]));
    const walkable = walkableAt(createGeoGroundSampler(level), kindOf);
    // The ground height of main.js, so a walker on a bridge deck is on it.
    const terrain = terrainOf(level);
    const heightAt = streetHeightSampler(createGeoGroundSampler({ ...level, buildings: [] }), (x, z) => (terrain && !terrain.flat ? terrain.height(x, z) : 0));
    for (const focus of [spawnAt, centroid("Krog Street Market"), centroid("Ponce City Market")]) {
      const state = createPeds(level, { seed: 2, count: 60, radius: 150, props: env.props, focus, heightAt });
      let samples = 0;
      let off = 0;
      run(state, 30, { focus }, (s) => {
        if (s.tick % 15) return;
        for (const p of s.peds) {
          if (!p.live) continue;
          samples += 1;
          if (!walkable(p.x, p.z, p.y) && !atCrossing(p.x, p.z)) off += 1;
        }
      });
      expect(off, `${off} of ${samples} samples on a street`).toBe(0);
    }
  }, 60000);
});

describe("the cheer", () => {
  it("needs a big combo", () => {
    expect(bigCombo(ACT.cheer.min)).toBe(true);
    expect(bigCombo(ACT.cheer.min - 1)).toBe(false);
    const peds = [
      { id: 0, live: true, x: 5, z: 0 },
      { id: 1, live: true, x: ACT.cheer.radius + 1, z: 0 },
      { id: 2, live: false, x: 1, z: 0 },
    ];
    expect(cheerIds(peds, [0, 0, 0], 5000)).toEqual([0]);
    expect(cheerIds(peds, [0, 0, 0], 200)).toEqual([]);
    expect(cheerIds(peds, null, 5000)).toEqual([]);
  });

  it("turns the walkers near Nia to her for a cheer, then they walk on", () => {
    const state = run(createPeds(level, { seed: 1, count: 60, radius: 150, props: env.props }), 5, { focus: spawnAt });
    const nia = [level.spawn.position[0], level.spawn.position[1], level.spawn.position[2]];
    const near = cheerIds(state.peds, nia, 5000);
    expect(near.length).toBeGreaterThan(0);
    // A small combo: no cheer.
    stepPeds(state, 1 / 30, { focus: spawnAt, nia, banked: 300 });
    expect(state.cheers).toBe(0);
    stepPeds(state, 1 / 30, { focus: spawnAt, nia, banked: 5000 });
    expect(state.cheers).toBe(near.length);
    run(state, 1, { focus: spawnAt, nia });
    for (const id of near) {
      const p = state.peds[id];
      if (!p.live || !(p.cheer > 0)) continue;
      expect(p.pose).toBe(POSE.cheer);
      expect(p.speed).toBe(0);
      const d = Math.hypot(nia[0] - p.x, nia[2] - p.z);
      if (d > 0.5) expect(((nia[0] - p.x) * p.fx + (nia[2] - p.z) * p.fz) / d).toBeGreaterThan(0.99);
    }
    run(state, ACT.cheer.time[1] + 0.5, { focus: spawnAt, nia });
    expect(state.peds.filter((p) => p.live && p.cheer > 0).length).toBe(0);
    expect(state.peds.some((p) => p.pose === POSE.cheer)).toBe(false);
  });
});
