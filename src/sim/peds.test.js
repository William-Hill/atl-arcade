import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PEDS, PED_COUNT, createPeds, hubDensity, pedCount, pedHubs, pedMinGap, pedRoutes, stepPeds } from "./peds.js";
import { createGeoGroundSampler } from "../level/geo/geo-ground.js";
import { pathOffsetPoint } from "./npc/path.js";

const level = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const routes = pedRoutes(level);
const spawnAt = [level.spawn.position[0], level.spawn.position[2]];

function run(state, seconds, opts) {
  for (let t = 0; t < seconds; t += 1 / 30) stepPeds(state, 1 / 30, opts);
  return state;
}

describe("pedRoutes", () => {
  it("walks the trail, the sidewalks and the street edges", () => {
    const kinds = new Set(routes.routes.map((r) => r.kind));
    expect([...kinds].sort()).toEqual(["edge", "sidewalk", "trail"]);
    const trail = routes.routes.filter((r) => r.kind === "trail").reduce((a, r) => a + r.path.length, 0);
    expect(trail).toBeGreaterThan(2000);
  });

  it("keeps right inside the route room", () => {
    for (const r of routes.routes) {
      expect(r.lane).toBeGreaterThan(0);
      expect(r.room).toBeGreaterThan(r.lane);
    }
  });

  it("puts the sidewalk routes on sidewalks and the edge routes on open ground", () => {
    const sample = createGeoGroundSampler(level);
    const kindOf = new Map((level.strips ?? []).map((s) => [s.id, s.kind]));
    const park = new Set(level.areas.filter((a) => a.kind === "park").map((a) => a.id));
    let walk = 0;
    let walkOn = 0;
    let edge = 0;
    let edgeOn = 0;
    for (const r of routes.routes) {
      for (let s = 1; s < r.path.length - 1; s += 5) {
        const at = pathAt(r, s);
        const id = sample(at[0], at[1])?.id;
        if (r.kind === "edge") {
          edge += 1;
          if (id === "ground" || park.has(id)) edgeOn += 1;
        }
        if (r.kind === "sidewalk") {
          walk += 1;
          if (kindOf.get(id) === "sidewalk") walkOn += 1;
        }
      }
    }
    // A sidewalk crosses a path or a trail now and then.
    expect(walkOn / walk).toBeGreaterThan(0.9);
    // The edge is checked every EDGE_WALK.step m, so a corner can clip.
    expect(edgeOn / edge).toBeGreaterThan(0.97);
  });

  it("finds hubs at the storefronts and the landmarks", () => {
    const hubs = pedHubs(level);
    expect(hubs.some((h) => h.kind === "landmark")).toBe(true);
    expect(hubs.some((h) => h.kind === "storefront" || h.kind === "shop")).toBe(true);
    const pcm = level.buildings.find((b) => b.name === "Ponce City Market");
    const [x, z] = pcm.outer[0];
    expect(hubDensity(routes, x, z)).toBeGreaterThan(1);
    expect(hubDensity(routes, 1e5, 1e5)).toBe(0);
  });

  it("weights the spawn points by the hubs", () => {
    const pts = routes.candidates.points.filter((p) => routes.routes[p.route].kind === "sidewalk");
    const near = pts.filter((p) => p.hub > 1);
    const far = pts.filter((p) => p.hub === 0);
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    expect(Math.min(...near.map((p) => p.w))).toBeGreaterThan(Math.max(...far.map((p) => p.w)));
  });
});

function pathAt(r, s) {
  return pathOffsetPoint(r.path, s, 0);
}

describe("createPeds", () => {
  it("is seeded", () => {
    const a = createPeds(level, { seed: 7, count: 50 });
    const b = createPeds(level, { seed: 7, count: 50 });
    const c = createPeds(level, { seed: 8, count: 50 });
    expect(a.peds.map((p) => [p.x, p.z])).toEqual(b.peds.map((p) => [p.x, p.z]));
    expect(a.peds.map((p) => [p.x, p.z])).not.toEqual(c.peds.map((p) => [p.x, p.z]));
  });

  it("fills the pool around the focus, clear of each other", () => {
    const state = createPeds(level, { count: 200, radius: 150 });
    const live = state.peds.filter((p) => p.live);
    expect(live.length).toBe(200);
    for (const p of live) expect(Math.hypot(p.x - spawnAt[0], p.z - spawnAt[1])).toBeLessThanOrEqual(150 + PEDS.sample);
    expect(pedMinGap(state)).toBeGreaterThanOrEqual(0);
  });

  it("uses the height sampler", () => {
    const state = createPeds(level, { count: 20, heightAt: (x, z, y, r) => (r.kind === "trail" ? 5 : 1) });
    for (const p of state.peds) expect(p.y).toBe(state.routes[p.route].kind === "trail" ? 5 : 1);
  });
});

describe("stepPeds", () => {
  it("walks along the routes without overlap", () => {
    const state = createPeds(level, { seed: 3, count: 200, radius: 150 });
    const start = state.peds.map((p) => [p.x, p.z, p.phase]);
    for (let t = 0; t < 20; t += 1 / 30) {
      stepPeds(state, 1 / 30, { focus: spawnAt });
      expect(pedMinGap(state)).toBeGreaterThan(-1e-6);
    }
    const moved = state.peds.filter((p, i) => Math.hypot(p.x - start[i][0], p.z - start[i][1]) > 5);
    expect(moved.length).toBeGreaterThan(state.peds.length * 0.6);
    for (const p of state.peds) {
      const r = state.routes[p.route];
      expect(Math.abs(p.offset)).toBeLessThanOrEqual(r.room + 1e-9);
      expect(p.s).toBeGreaterThanOrEqual(0);
      expect(p.s).toBeLessThanOrEqual(r.path.length);
    }
  });

  it("keeps the pool around a moving focus", () => {
    const state = createPeds(level, { count: 120, radius: 120 });
    const focus = [...spawnAt];
    for (let t = 0; t < 20; t += 1 / 30) {
      focus[1] -= 5 / 30; // 5 m/s north
      stepPeds(state, 1 / 30, { focus });
    }
    stepPeds(state, 1 / 30, { focus });
    for (const p of state.peds) if (p.live) expect(Math.hypot(p.x - focus[0], p.z - focus[1])).toBeLessThanOrEqual(120 + PEDS.sample);
    expect(state.peds.some((p) => p.spawns > 1)).toBe(true);
  });

  it("scatters again after a fast travel", () => {
    const state = createPeds(level, { count: 80, radius: 120 });
    const far = [-98, -812];
    stepPeds(state, 1 / 30, { focus: far });
    for (const p of state.peds.filter((q) => q.live)) expect(Math.hypot(p.x - far[0], p.z - far[1])).toBeLessThanOrEqual(120 + PEDS.sample);
  });

  it("steps aside for Nia and never walks into her", () => {
    const state = createPeds(level, { seed: 5, count: 200, radius: 150 });
    run(state, 2, { focus: spawnAt });
    const p = state.peds.find((q) => q.live && q.pause <= 0 && q.speed > 0.8 && state.routes[q.route].kind === "trail");
    expect(p).toBeTruthy();
    // Nia stands still on the walker's line, 5 m ahead.
    const nia = [p.x + p.fx * 5, 0, p.z + p.fz * 5];
    const offset0 = p.offset;
    let closest = Infinity;
    for (let t = 0; t < 6; t += 1 / 30) {
      stepPeds(state, 1 / 30, { focus: spawnAt, nia });
      closest = Math.min(closest, Math.hypot(p.x - nia[0], p.z - nia[2]));
    }
    expect(closest).toBeGreaterThanOrEqual(PEDS.radius + PEDS.niaRadius);
    expect(Math.abs(p.offset - offset0) > 0.3 || p.dir !== Math.sign(offset0) || closest > 1).toBe(true);
  });

  it("keeps clear of the crowd and the NPC skaters", () => {
    const state = createPeds(level, { seed: 4, count: 200, radius: 150 });
    run(state, 1, { focus: spawnAt });
    // A crowd member stands on the line of each of 20 moving walkers, 2 m ahead.
    const walking = state.peds.filter((q) => q.live && q.pause <= 0 && q.speed > 0.5).slice(0, 20);
    const others = walking.map((q) => ({ x: q.x + q.fx * 2, z: q.z + q.fz * 2, radius: 0.4 }));
    // A walker already on a crowd member when it appears may only move away.
    const gap = (p, o) => Math.hypot(p.x - o.x, p.z - o.z) - PEDS.radius - o.radius;
    const start = new Set(state.peds.flatMap((p) => others.filter((o) => gap(p, o) < 0).map((o) => `${p.id}:${others.indexOf(o)}`)));
    let worst = Infinity;
    for (let t = 0; t < 8; t += 1 / 30) {
      stepPeds(state, 1 / 30, { focus: spawnAt, others });
      for (const p of state.peds) if (p.live) others.forEach((o, i) => start.has(`${p.id}:${i}`) || (worst = Math.min(worst, gap(p, o))));
    }
    expect(worst).toBeGreaterThanOrEqual(-1e-6);
  });

  it("does not spawn on a crowd member", () => {
    const state = createPeds(level, { seed: 6, count: 150, radius: 120 });
    // A crowd member on every spawn candidate near the focus; then a fast travel there.
    const far = [-98, -812];
    const others = state.built.candidates.points.filter((c) => Math.hypot(c.x - far[0], c.z - far[1]) < 120).map((c) => ({ x: c.x, z: c.z, radius: 0.4 }));
    stepPeds(state, 1 / 30, { focus: far, others });
    for (const p of state.peds.filter((q) => q.live)) for (const o of others) expect(Math.hypot(p.x - o.x, p.z - o.z)).toBeGreaterThanOrEqual(PEDS.radius + o.radius - 1e-6);
  });

  it("stops now and then near a hub", () => {
    const pcm = level.buildings.find((b) => b.name === "Ponce City Market");
    const at = pcm.outer[0];
    const state = createPeds(level, { seed: 2, count: 150, radius: 120, focus: at });
    let paused = 0;
    for (let t = 0; t < 20; t += 1 / 30) {
      stepPeds(state, 1 / 30, { focus: at });
      paused = Math.max(paused, state.peds.filter((p) => p.pause > 0).length);
    }
    expect(paused).toBeGreaterThan(0);
  });

  it("advances the walk phase with the distance walked", () => {
    const state = createPeds(level, { seed: 9, count: 40 });
    run(state, 1, { focus: spawnAt });
    const p = state.peds.find((q) => q.live && q.pause <= 0 && q.speed > 0.5);
    const [x, z, phase] = [p.x, p.z, p.phase];
    stepPeds(state, 0.1, { focus: spawnAt });
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > 0) expect(p.phase).not.toBe(phase);
  });
});

describe("pedCount", () => {
  it("uses the tier count when the URL has no number", () => {
    expect(pedCount("high", null)).toBe(PED_COUNT.high);
    expect(pedCount("phone", "")).toBe(PED_COUNT.phone);
    expect(pedCount("low", "many")).toBe(PED_COUNT.low);
    expect(pedCount("unknown", null)).toBe(PED_COUNT.low);
  });
  it("turns the walkers off with 0 and clamps a set count", () => {
    expect(pedCount("high", "0")).toBe(0);
    expect(pedCount("high", "45")).toBe(45);
    expect(pedCount("high", "-3")).toBe(0);
    expect(pedCount("high", "5000")).toBe(400);
  });
  it("keeps the high tier at 120 walkers or fewer", () => {
    expect(PED_COUNT.high).toBeLessThanOrEqual(120);
    expect(PED_COUNT.phone).toBeLessThanOrEqual(PED_COUNT.low);
  });
});
