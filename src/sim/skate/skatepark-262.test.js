// #262: the H4W skatepark (levels/beltline-eastside/skatepark.json) in the
// pure simulation. Four problems from the 2026-11-13 design audit, run 3:
// 1. the ledge bonk, then a slow grind that tips over;
// 2. the quarter pipe never launches (and the kicker loses its pop);
// 3. a slow grind scores more than a fast grind of the same length;
// 4. the body goes into the planter and the ramp faces.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMBO, GRIND } from "./constants.js";
import { FLAT_GROUND, yawFromHeading } from "./controller.js";
import { createRun, stepRun } from "./run.js";
import { createSkaterEnv } from "./skater.js";
import { startGrind } from "./grind.js";
import { createLevelEnv } from "../../level/ground.js";
import { padPoint, withSkatepark } from "../../level/skatepark.js";
import { featureGround } from "../../level/skate-features.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const PARK = read("../../../levels/beltline-eastside/skatepark.json");
const LEVEL = withSkatepark(read("../../../levels/beltline-eastside/level.json"), PARK, read("../../../assets/skate-features/features.json"));
const ENV = createLevelEnv(LEVEL, { props: false });
const SKATER_ENV = createSkaterEnv(LEVEL, ENV.grindables);
const DT = 1 / 60;
const BALANCE = GRIND.balanceDrift / GRIND.balanceCorrect;
const PAD = LEVEL.skatepark;

// A pad point [u, v] in level [x, z], a pad direction as a yaw, and back.
const at = (u, v) => padPoint(PARK, u, v);
function yawOf(du, dv) {
  const a = at(0, 0);
  const b = at(du, dv);
  return yawFromHeading(b[0] - a[0], b[1] - a[1]);
}
function uv(x, z) {
  const [ax, az] = PARK.axis;
  const dx = x - PARK.center[0];
  const dz = z - PARK.center[1];
  return [dx * ax + dz * az, -dx * az + dz * ax];
}

// A run that starts at pad [u, v], heading pad direction (du, dv) at `speed`.
function runAt(u, v, du, dv, speed) {
  const [x, z] = at(u, v);
  const r = createRun(LEVEL, { position: [x, ENV.sampleGround(x, z).height, z], yaw: yawOf(du, dv) });
  r.skater.speed = speed;
  return r;
}

// Steps a run with input(tick, run) and returns every run state.
function ride(run, ticks, input = () => ({})) {
  const out = [];
  let r = run;
  for (let t = 0; t < ticks; t += 1) {
    r = stepRun(r, input(t, r), DT, ENV, SKATER_ENV);
    out.push(r);
  }
  return out;
}
const movesOf = (runs) => runs.flatMap((r) => r.moves);

describe("#262 problem 1: the 6 m concrete ledge", () => {
  // The line ledge stands at pad u = 4, v = -3.5. Its front edge is at v = -3.25.
  // The skater comes from the pad side at an angle `deg` to the ledge.
  function approach(deg, speed) {
    const a = (deg * Math.PI) / 180;
    const du = Math.cos(a);
    const dv = -Math.sin(a);
    return runAt(4 - 4 * du, -3.25 - 4 * dv, du, dv, speed);
  }

  it("catches the ledge on a steep approach with grind held: no bonk, and the grind keeps the speed", () => {
    // Grind held until the ledge grind ends (the end rail is next in line).
    const runs = ride(approach(70, 6), 100, (t, r) => ({ grind: r.skater.stats.exits === 0, steer: r.skater.state === "grind" ? BALANCE : 0 }));
    const i = runs.findIndex((r) => r.skater.justSnapped);
    expect(i, "the skater snaps to the ledge").toBeGreaterThan(0);
    const snap = runs[i];
    expect(snap.skater.grind.id).toMatch(/^ledge:skatepark:h4w-skatepark:line-ledge/);
    // The speed one tick before the hit, not the 2.5 m/s floor.
    expect(snap.skater.speed).toBeGreaterThanOrEqual(runs[i - 1].skater.speed);
    expect(snap.skater.speed).toBeGreaterThan(2 * GRIND.minSpeed * 0.9);
    expect(runs.some((r) => r.skater.bonked)).toBe(false);
    expect(runs.some((r) => r.skater.justFell)).toBe(false);
    expect(movesOf(runs).map((m) => m.name)).toContain("Ledge Grind");
  });

  it("catches the ledge on a grind press just after a bonk, with the speed before the bonk", () => {
    let bonk = -1;
    let hitSpeed = 0;
    const runs = ride(approach(70, 6), 100, (t, r) => {
      if (bonk < 0 && r.skater.bonked) bonk = t;
      if (bonk < 0) hitSpeed = r.skater.speed;
      const late = bonk >= 0 && t >= bonk + 6 && r.skater.stats.exits === 0; // 0.1 s after the bonk
      return { grind: late, steer: r.skater.state === "grind" ? BALANCE : 0 };
    });
    expect(bonk).toBeGreaterThan(0);
    const snap = runs.find((r) => r.skater.justSnapped);
    expect(snap, "the late press snaps").toBeTruthy();
    expect(runs.find((r) => r.skater.bonked).skater.speed).toBe(0);
    expect(snap.skater.speed).toBeGreaterThanOrEqual(hitSpeed);
    expect(snap.skater.speed).toBeGreaterThan(2 * GRIND.minSpeed * 0.9);
    expect(runs.some((r) => r.skater.justFell)).toBe(false);
  });

  it("still bonks on a head-on hit with no grind press", () => {
    const runs = ride(approach(90, 6), 60);
    expect(runs.some((r) => r.skater.bonked)).toBe(true);
    expect(runs.some((r) => r.skater.state === "grind")).toBe(false);
  });
});

describe("#262 problem 2: ramp air", () => {
  it("launches vert air off the quarter pipe, lands back on its face, and stays on the pad", () => {
    // The ramp lane v = 3, heading +u, past the manual pad: the quarter pipe
    // foot is at u = 12.3. Its lip is 1.2 m high, so the skater needs about
    // 7 m/s at the foot (v^2 / 2g = 1.2 m at g = 20).
    const runs = ride(runAt(8, 3, 1, 0, 10), 150);
    const launch = runs.find((r) => r.skater.state === "air");
    expect(launch, "the skater leaves the quarter pipe").toBeTruthy();
    expect(launch.skater.airFrom).toBe("ramp");
    expect(launch.skater.velocity[1]).toBeGreaterThan(3);
    const top = Math.max(...runs.map((r) => r.skater.position[1])) - PAD.top;
    expect(top).toBeGreaterThan(1.2 + 0.3);
    const landing = runs.find((r) => r.skater.justLanded);
    expect(landing.skater.groundId).toBe("skatepark:h4w-skatepark:quarter:face");
    expect(movesOf(runs).map((m) => m.name)).toContain("Vert Air");
    // Never on the deck, never off the end of the pad.
    for (const r of runs) {
      expect(r.skater.groundId ?? "").not.toBe("ground");
      expect(uv(r.skater.position[0], r.skater.position[2])[0]).toBeLessThan(PAD.size[0] / 2);
    }
    expect(runs[runs.length - 1].skater.state).toBe("rolling");
  });

  it("pops the skater up off the kicker and scores the air", () => {
    // The kicker is at pad u = -8, v = 0, its lip toward +u.
    const runs = ride(runAt(-13, 0, 1, 0, 8), 90);
    const launch = runs.find((r) => r.skater.state === "air");
    expect(launch).toBeTruthy();
    expect(launch.skater.velocity[1]).toBeGreaterThan(1.5);
    expect(movesOf(runs).map((m) => m.name)).toContain("Ramp Air");
  });
});

describe("#262 problem 3: grind score", () => {
  // A 12 m rail on flat ground, 0.33 m high (the flat bar height).
  const rail = { id: "rail:test", points: [[0, 0.33, 0], [12, 0.33, 0]], total: 12 };
  // The skater starts on the rail start at `speed`, so both grinds ride the same 12 m.
  function grindAt(speed) {
    const r = createRun({ spawn: { position: [0, 0.33, 0], yaw: 0 } });
    r.skater.speed = speed;
    r.skater.velocity = [speed, 0, 0];
    let run = { ...r, skater: startGrind(r.skater, { grindable: rail, s: 0, direction: 1 }) };
    const moves = [];
    for (let t = 0; t < 600 && !moves.length; t += 1) {
      run = stepRun(run, { steer: BALANCE }, DT, FLAT_GROUND, { grindables: [rail] });
      moves.push(...run.moves.filter((m) => m.move === "grind"));
    }
    return moves[0];
  }

  it("gives a fast grind no fewer points than a slow grind of the same length", () => {
    const slow = grindAt(3);
    const fast = grindAt(10);
    expect(slow.name).toMatch(/Rail Grind/);
    expect(fast.points).toBeGreaterThanOrEqual(slow.points);
  });

  it("scores the meters on the rail", () => {
    const fast = grindAt(10);
    expect(fast.points).toBe(COMBO.grindBase + COMBO.grindPerMeter * 12);
    expect(fast.name).toBe("Long Rail Grind");
  });
});

describe("#262 problem 4: the body stays out of the park features", () => {
  const sampleFeatures = featureGround(PAD.placements.map((p) => ({ feature: p.feature, placement: p })));
  const BODY = 0.3; // m, SKATE.bodyRadius
  // SKATE.maxStep plus 0.02 m: an edge at the step height (the 0.25 m side of
  // the kicker where the skater steps off it) is a step, not a wall.
  const STEP = 0.27;
  // How far a wall of a feature is inside the body circle. A feature column
  // is a wall when it is more than a step above the feet, and its surface
  // plane at the skater's column is too: the side of a box or of a ramp. The
  // slope of a ramp face just ahead of the feet is ground, not a wall.
  // Not checked: a skater who rolls on a steep face (ground normal y under
  // 0.9). There the wall ring is off by design (#58), and just under the
  // quarter pipe lip the deck is up to 0.18 m into the upright body for about
  // 4 ticks. A body that tilts with the ramp is a render change.
  function isWall(f, ox, oz, y) {
    if (f.height - y <= STEP || f.height > y + 1.6) return false;
    const [nx, ny, nz] = f.normal;
    return f.height + (nx * ox + nz * oz) / ny - y > STEP;
  }
  function intrusion(s) {
    const [x, y, z] = s.position;
    for (let r = 0.02; r <= BODY; r += 0.02) {
      for (let i = 0; i < 32; i += 1) {
        const a = (i * Math.PI) / 16;
        const [ox, oz] = [Math.cos(a) * r, Math.sin(a) * r];
        const f = sampleFeatures(x + ox, z + oz);
        if (f && isWall(f, ox, oz, y)) return { depth: BODY - r, id: f.id };
      }
    }
    return { depth: 0, id: null };
  }

  // [pad u, pad v, the most ticks in a row with the body more than 0.03 m in a wall].
  // The kicker: 1 tick (16.7 ms). Its back is tall only in its last few cm,
  // between the ring probes; a skater who jumps onto it from behind is in it
  // for 1 tick, then lands on its face.
  const FEATURES = { planter: [-2, -6.2, 0], quarter: [13.6, 3, 0], kicker: [-8, 0, 1], bank: [-13.5, 3, 0] };
  for (const [name, [tu, tv, allowed]] of Object.entries(FEATURES)) {
    it(`keeps the body out of the ${name} from 24 directions, rolling and jumping`, () => {
      let worst = { depth: 0 };
      let longest = { ticks: 0 };
      for (let deg = 0; deg < 360; deg += 15) {
        for (const [speed, jumpAt] of [[3, -1], [6, 10], [6, 20], [9, 20]]) {
          const a = (deg * Math.PI) / 180;
          const r0 = runAt(tu - 5 * Math.cos(a), tv - 5 * Math.sin(a), Math.cos(a), Math.sin(a), speed);
          let run = 0;
          for (const r of ride(r0, 120, (t) => ({ jump: t === jumpAt }))) {
            if (r.skater.state === "grind") break;
            if (r.skater.state === "rolling" && r.skater.groundNormal[1] < 0.9) continue;
            const c = intrusion(r.skater);
            run = c.depth > 0.03 ? run + 1 : 0;
            if (run > longest.ticks) longest = { ticks: run, deg, speed, jumpAt, id: c.id };
            if (c.depth > worst.depth) worst = { ...c, deg, speed, jumpAt, state: r.skater.state };
          }
        }
      }
      // 0.03 m: one probe step of the check plus the ring margin.
      expect(longest.ticks, JSON.stringify({ worst, longest })).toBeLessThanOrEqual(allowed);
      if (!allowed) expect(worst.depth, JSON.stringify(worst)).toBeLessThanOrEqual(0.03);
    });
  }
});
