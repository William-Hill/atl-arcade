// The scripted rides of the landmark test (e2e/landmarks.spec.js, #219), in
// the pure simulation: the same level, env and skater constants as the page
// (with ?cars=0: a car is a wall for the skater). Each ride is planned here
// in a closed loop (the planner reads the skater state each tick) with the
// REAL controller, and the result is a plain input script that the page
// replays tick for tick with __atl.runScript().
//
// planRide(id) plans the ride for the challenge of one spot of
// levels/beltline-eastside/landmarks.json and checks it with the landmark
// module: { id, type, script, start, claimed, found, ticks, note }.

import { BALANCE, LANDMARKS as DATA, comboLine, park } from "./skatepark-ride.js";
import { landingProbe, travelSpot } from "../src/level/geo/travel.js";
import { terrainOf } from "../src/level/geo/terrain.js";
import { goalsFor } from "../src/level/goals.js";
import { createCombo, comboValue } from "../src/sim/skate/combo.js";
import { yawFromHeading } from "../src/sim/skate/controller.js";
import { createGoals, stepGoals } from "../src/sim/skate/goals.js";
import { stepRun } from "../src/sim/skate/run.js";
import { createSkater } from "../src/sim/skate/skater.js";
import { createCardState } from "../src/sim/fact-cards.js";
import { createLandmarks, landmarkObs, prepareLandmarks, spotState, stepLandmarks } from "../src/sim/landmarks.js";

const DT = 1 / 60;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

let spotsMade = null;
export function spots() {
  if (!spotsMade) spotsMade = prepareLandmarks(DATA, park().level);
  return spotsMade;
}
export const spotOf = (id) => spots().find((s) => s.id === id);

// The ground of a point where the skater rides: the deck when it is on a
// bridge strip, the surface under a bridge otherwise (as fast travel lands).
export function groundAt(x, z) {
  const { level, env } = park();
  const terrain = terrainOf(level).height(x, z);
  const spot = travelSpot(level, x, z);
  const strip = spot && Math.hypot(spot.x - x, spot.z - z) < 4 ? spot : null;
  return env.sampleGround(x, z, strip ? landingProbe(level, strip, terrain) : terrain + 2)?.height ?? terrain;
}

export const startAt = (x, z, yaw) => ({ position: [x, groundAt(x, z), z], yaw });

function newRun(start) {
  return { skater: createSkater(park().level, start), combo: createCombo(), tick: 0, time: 0, moves: [], lastMove: null, moveSeq: 0, banked: 0, cards: createCardState() };
}

// Joins equal inputs of a tick list into { frames, input } entries.
function pack(inputs) {
  const script = [];
  for (const input of inputs) {
    const key = JSON.stringify(input);
    if (script.length && JSON.stringify(script[script.length - 1].input) === key) script[script.length - 1].frames += 1;
    else script.push({ frames: 1, input });
  }
  return script;
}

// Plans a ride in a closed loop: `plan(run, tick)` gives the input of the
// tick, or null to stop. Returns { script, start }.
function drive(start, plan, { max = 1500, tail = 45 } = {}) {
  const { env, skaterEnv } = park();
  let run = newRun(start);
  const inputs = [];
  for (let t = 0; t < max; t += 1) {
    const input = plan(run, t);
    if (!input) break;
    run = stepRun(run, input, DT, env, skaterEnv);
    inputs.push(input);
  }
  // A short roll at the end, so the page shows the banner.
  for (let i = 0; i < tail; i += 1) inputs.push({});
  return { script: pack(inputs), start };
}

// Replays a script with the real controller, the goals and the landmark
// module, as the page does. Every spot starts Unknown.
export function replay(script, start, { progress } = {}) {
  const { env, skaterEnv } = park();
  const def = goalsFor("beltline-eastside");
  let run = newRun(start);
  let goals = createGoals(def);
  let marks = createLandmarks(spots(), { level: "beltline-eastside", progress });
  const out = { found: [], claimed: [], bails: 0, respawns: 0, ticks: 0, claimTick: null, grindMeters: 0, banks: [] };
  let grindFrom = null;
  for (const entry of script) {
    for (let i = 0; i < entry.frames; i += 1) {
      run = stepRun(run, entry.input ?? {}, DT, env, skaterEnv);
      goals = stepGoals(goals, run, def, DT);
      marks = stepLandmarks(marks, landmarkObs(run), DT, { active: !goals.ended });
      out.ticks += 1;
      const s = run.skater;
      if (s.justFell) out.bails += 1;
      if (s.respawned) out.respawns += 1;
      if (s.grind) {
        grindFrom ??= s.grind.s;
        out.grindMeters = Math.max(out.grindMeters, Math.abs(s.grind.s - grindFrom));
      } else grindFrom = null;
      if (run.banked) out.banks.push(run.banked);
      out.found.push(...marks.events.found);
      for (const c of marks.events.claimed) {
        out.claimed.push(c.id);
        out.claimTick ??= out.ticks;
      }
    }
  }
  return { ...out, end: run.skater, score: run.combo.score, gaps: goals.gaps, state: (id) => spotState(marks, id), claimSum: marks.run.claimSum };
}

// ------------------------------------------------------------------- plans

// The heading of the strip (trail, path, sidewalk or street) at a point.
function stripYaw(x, z) {
  const spot = travelSpot(park().level, x, z);
  return spot ? spot.yaw : 0;
}
const ahead = (yaw, d) => [Math.cos(yaw) * d, -Math.sin(yaw) * d];

// Gap: roll along the strip into the zone, hop at its center, land.
function gapPlans(spot) {
  const z = spot.challenge.zone;
  const plans = [];
  for (const turn of [0, Math.PI]) {
    const yaw = wrap(stripYaw(z.x, z.z) + turn);
    for (const back of [9, 6, 12]) {
      const [dx, dz] = ahead(yaw, -back);
      const start = startAt(z.x + dx, z.z + dz, yaw);
      plans.push(() =>
        drive(start, (run, t) => {
          const s = run.skater;
          const d = Math.hypot(s.position[0] - z.x, s.position[2] - z.z);
          if (t > 260) return null;
          if (s.state === "air") return {};
          return d < 2.5 && t < 200 ? { push: true, jump: true } : { push: t < 200 };
        }),
      );
    }
  }
  return plans;
}

// Grind: roll next to the curb to get speed, then hold grind and keep the
// balance for the meters of the challenge and 2 m more.
function grindPlans(spot) {
  const { skaterEnv } = park();
  const c = spot.challenge;
  const g = skaterEnv.grindables.find((x) => x.id === c.feature);
  const plans = [];
  // The point of the curb the nearest to the zone center, as an index.
  let mid = 0;
  g.points.forEach((p, i) => {
    if (Math.hypot(p[0] - c.zone.x, p[2] - c.zone.z) < Math.hypot(g.points[mid][0] - c.zone.x, g.points[mid][2] - c.zone.z)) mid = i;
  });
  for (const dir of [1, -1]) {
    for (const side of [1, -1]) {
      for (const runUp of [12, 16, 8]) {
        plans.push(() => {
          // Start `runUp` m before the zone point along the curb, 0.9 m to one side.
          let i = mid;
          let left = runUp + c.meters * 0.4;
          while (left > 0 && i - dir >= 0 && i - dir < g.points.length) {
            left -= Math.hypot(g.points[i][0] - g.points[i - dir][0], g.points[i][2] - g.points[i - dir][2]);
            i -= dir;
          }
          const j = Math.min(g.points.length - 1, Math.max(0, i + dir));
          if (j === i) return null;
          const tx = (g.points[j][0] - g.points[i][0]) * 1;
          const tz = (g.points[j][2] - g.points[i][2]) * 1;
          const n = Math.hypot(tx, tz);
          const yaw = yawFromHeading(tx, tz);
          const start = startAt(g.points[i][0] + (-tz / n) * 0.9 * side, g.points[i][2] + (tx / n) * 0.9 * side, yaw);
          let from = null;
          let done = false;
          return drive(start, (run, t) => {
            const s = run.skater;
            if (t > 700 || (done && s.state !== "grind")) return null;
            if (s.state === "grind") {
              from ??= s.grind.s;
              if (Math.abs(s.grind.s - from) >= c.meters + 2) done = true;
              return done ? { steer: BALANCE, jump: true } : { grind: true, steer: BALANCE };
            }
            if (done) return {};
            // Steer along the curb while the speed builds, then press grind.
            return t < runUp * 6 ? { push: true } : { push: true, grind: true };
          });
        });
      }
    }
  }
  return plans;
}

// Line: steer through the checkpoints in order, along the trail: between 2
// checkpoints the way points are on the center line of the nearest trail or
// path (a straight line can leave a bridge).
function linePlans(spot) {
  const { level } = park();
  const cps = spot.challenge.checkpoints;
  const way = [];
  for (let i = 0; i + 1 < cps.length; i += 1) {
    const [ax, az] = cps[i];
    const [bx, bz] = cps[i + 1];
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 3);
    way.push({ p: cps[i], cp: true });
    for (let k = 1; k < steps; k += 1) {
      const t = travelSpot(level, ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps, { kinds: ["trail", "path"] });
      if (t) way.push({ p: [t.x, t.z], cp: false });
    }
  }
  way.push({ p: cps[cps.length - 1], cp: true });
  const plans = [];
  for (const back of [10, 6, 14]) {
    plans.push(() => {
      const dx = way[0].p[0] - way[1].p[0];
      const dz = way[0].p[1] - way[1].p[1];
      const n = Math.hypot(dx, dz);
      const start = startAt(cps[0][0] + (dx / n) * back, cps[0][1] + (dz / n) * back, yawFromHeading(-dx, -dz));
      let next = 0;
      return drive(start, (run, t) => {
        const s = run.skater;
        if (t > 60 * (spot.challenge.seconds + 8)) return null;
        while (next < way.length && Math.hypot(s.position[0] - way[next].p[0], s.position[2] - way[next].p[1]) < (way[next].cp ? 1.5 : 2.5)) next += 1;
        if (next >= way.length) return null;
        const want = yawFromHeading(way[next].p[0] - s.position[0], way[next].p[1] - s.position[2]);
        const err = wrap(want - s.yaw);
        return { push: true, steer: Math.max(-1, Math.min(1, err * 4)) };
      });
    });
  }
  return plans;
}

// Combo on a flat strip: hops and dance moves in turn until the combo is
// worth the points, then a roll until it banks. The start moves back along
// the strip so the last link is near the zone center.
function comboPlans(spot) {
  const c = spot.challenge;
  const plans = [];
  for (const turn of [0, Math.PI]) {
    const yaw = wrap(stripYaw(c.zone.x, c.zone.z) + turn);
    const attempt = (back, slow = false) => {
      const [dx, dz] = ahead(yaw, -back);
      const start = startAt(c.zone.x + dx, c.zone.z + dz, yaw);
      let step = 0;
      let wait = 0;
      let last = null;
      const ride = drive(start, (run, t) => {
        const s = run.skater;
        if (run.moves.length) last = [s.position[0], s.position[2]];
        if (t > 1400 || (run.combo.score > 0 && !run.combo.active)) return null;
        // Keep the heading of the strip.
        const steer = Math.max(-1, Math.min(1, wrap(stripYaw(s.position[0], s.position[2]) + turn - s.yaw) * 3));
        // A slow ride (for a path with a sharp bend) pushes only at the start.
        const push = !slow || t < 40;
        if (t < (slow ? 40 : 80)) return { push: true, steer };
        if (comboValue(run.combo) >= c.points) return { steer };
        if (s.state !== "rolling" || s.style) return { push, steer };
        if (wait > 0) {
          wait -= 1;
          return { push, steer };
        }
        wait = 3;
        step += 1;
        const move = [{ jump: true }, { style1: true }, { jump: true }, { style2: true }][(step - 1) % 4];
        return { ...move, push, steer };
      });
      return { ride, last };
    };
    // The start that puts the last link in the zone depends on the path: try
    // a start each 5 m back along the heading of the strip.
    for (let back = 15; back <= 60; back += 5) plans.push(() => attempt(back).ride);
    for (let back = 4; back <= 40; back += 4) plans.push(() => attempt(back, true).ride);
  }
  return plans;
}

// The ride for the challenge of spot `id`. It tries a few starts and keeps
// the first that claims the spot with no bail. `claimed` is false when no
// plan worked: then `note` says what happened in the last one.
export function planRide(id) {
  const spot = spotOf(id);
  const c = spot.challenge;
  if (!c) return { id, type: null, claimed: false, note: "an edge marker has no challenge" };
  // The skatepark combo is the rail line of the skatepark test (#222).
  const plans = c.type === "gap" ? gapPlans(spot) : c.type === "grind" ? grindPlans(spot) : c.type === "line" ? linePlans(spot) : id === "historic-fourth-ward-skatepark" ? [() => comboLine()] : comboPlans(spot);
  let lastTry = null;
  for (const plan of plans) {
    const ride = plan();
    if (!ride) continue;
    const r = replay(ride.script, ride.start);
    lastTry = { ride, r };
    if (r.claimed.includes(id) && r.bails === 0 && r.respawns === 0) return { id, type: c.type, tier: c.tier, script: ride.script, start: ride.start, claimed: true, ticks: r.ticks, claimTick: r.claimTick, grindMeters: r.grindMeters, banks: r.banks, also: r.claimed.filter((x) => x !== id), found: [...new Set(r.found)], gaps: r.gaps, claimSum: r.claimSum, end: r.end.position };
  }
  const r = lastTry?.r;
  return { id, type: c.type, tier: c.tier, claimed: false, plans: plans.length, note: r ? `last plan: ${r.bails} bails, ${r.respawns} respawns, grind ${r.grindMeters.toFixed(1)} m, banks ${JSON.stringify(r.banks)}, found ${[...new Set(r.found)].join(",")}, end ${r.end.position.map((v) => v.toFixed(1)).join(",")}` : "no plan" };
}
