// Times the sim steps (walkers, crowd, traffic, NPC skaters) in Node on the
// perf ride (scripts/perf.mjs), with the main.js setup of the high tier.
// No browser: a fast check of the sim CPU per 1/60 s step.
//   node scripts/sim-bench.mjs [--seconds 15] [--peds 120] [--profile]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chainStrips, followLineScript } from "../src/playtest/trail-script.js";
import { createLevelEnv } from "../src/level/ground.js";
import { createSkaterEnv } from "../src/sim/skate/skater.js";
import { createRun, stepRun } from "../src/sim/skate/run.js";
import { createCrowd, minGap, stepCrowd } from "../src/sim/npc/crowd.js";
import { PED_RADIUS, createPeds, pedMinGap, stepPeds } from "../src/sim/peds.js";
import { carGroundSampler, carPitch, createTraffic, stepTraffic, streetHeightSampler, streetsOnly } from "../src/sim/traffic/traffic.js";
import { parkedCars } from "../src/sim/traffic/parking.js";
import { createGeoGroundSampler } from "../src/level/geo/geo-ground.js";
import { terrainOf } from "../src/level/geo/terrain.js";
import { createNpcSkaters, skaterObstacles, stepNpcSkaters } from "../src/sim/npc/skaters.js";

const args = process.argv.slice(2);
const arg = (n, f) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : f);
const seconds = Number(arg("seconds", "15"));
const pedTotal = Number(arg("peds", "120"));
const ROOT = resolve(import.meta.dirname, "..");
const level = JSON.parse(readFileSync(resolve(ROOT, "levels/beltline-eastside/level.json"), "utf8"));
const env = createLevelEnv(level);
const skaterEnv = createSkaterEnv(level, env.grindables);
const [trail] = chainStrips(level.strips, "trail");
const ride = followLineScript(trail, level.spawn, createLevelEnv(level), { frames: Math.round(seconds * 60) }).script;
const terrain = terrainOf(level);
const ground = (x, z) => (terrain && !terrain.flat ? terrain.height(x, z) : 0);
const carHeight = streetHeightSampler(createGeoGroundSampler(streetsOnly(level)), ground);
const pedHeight = streetHeightSampler(createGeoGroundSampler({ ...level, buildings: [] }), ground);

// The cars are solid for the skaters, as in main.js.
const levelSample = env.sampleGround;
const parked = parkedCars(level, levelSample, { heightAt: (x, z) => carHeight(x, z, -Infinity) }).map((c) => ({ ...c, pitch: carPitch(c, (x, z) => carHeight(x, z, c.y)) }));
let traffic = createTraffic(level, { seed: 1, heightAt: carHeight });
env.sampleGround = carGroundSampler(levelSample, parked, () => traffic.cars);
let run = createRun(level);
let crowd = createCrowd(level, { seed: 1 });
const peds = createPeds(level, { seed: 1, count: pedTotal, radius: PED_RADIUS.high, heightAt: pedHeight, props: env.props });
let npcSkaters = createNpcSkaters(level, { env, avoid: crowd.npcs });
const dt = 1 / 60;
const cost = { skater: 0, crowd: 0, traffic: 0, walkers: 0, npcSkaters: 0 };
let worstPed = Infinity;
let worstCrowd = Infinity;
const t = (k, f) => {
  const a = performance.now();
  f();
  cost[k] += performance.now() - a;
};
for (let i = 0; i < ride.length; i += 1) {
  t("skater", () => (run = stepRun(run, ride[i], dt, env, skaterEnv, null)));
  const sk = run.skater;
  // The follow camera is about 6 m behind the skater.
  const cam = [sk.position[0] - Math.sin(sk.yaw ?? 0) * 6, sk.position[2] - Math.cos(sk.yaw ?? 0) * 6];
  t("crowd", () => (crowd = stepCrowd(crowd, dt, sk.position, skaterObstacles(npcSkaters), { focus: cam })));
  t("traffic", () => (traffic = stepTraffic(traffic, dt, sk.position, { focus: cam })));
  t("walkers", () => stepPeds(peds, dt, { focus: cam, nia: sk.position, others: [...crowd.npcs, ...skaterObstacles(npcSkaters)] }));
  t("npcSkaters", () => (npcSkaters = stepNpcSkaters(npcSkaters, dt, env, skaterEnv, { player: sk.position, crowd: crowd.npcs, focus: cam })));
  worstPed = Math.min(worstPed, pedMinGap(peds));
  worstCrowd = Math.min(worstCrowd, minGap(crowd.npcs));
}
const n = ride.length;
const out = Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, +(v / n).toFixed(3)]));
out.simSum = +(out.crowd + out.traffic + out.walkers + out.npcSkaters).toFixed(3);
console.log(JSON.stringify({ steps: n, msPerStep: out, live: peds.peds.filter((p) => p.live).length, pedMinGap: +worstPed.toFixed(3), crowdMinGap: +worstCrowd.toFixed(3), pedSpawns: peds.peds.reduce((s, p) => s + p.spawns, 0), npcFalls: npcSkaters.npcs.reduce((s, x) => s + x.stats.falls, 0), crowdBumps: crowd.bumps }));
