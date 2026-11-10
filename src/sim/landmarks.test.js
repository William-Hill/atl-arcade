import { describe, expect, it } from "vitest";
import {
  CLAIMED_TITLE,
  LANDMARKS,
  bannerTime,
  claimAward,
  claimPointsTotal,
  createLandmarkTracker,
  createLandmarks,
  findDistance,
  gapGoalOf,
  landmarkObs,
  landmarkTestHook,
  landmarkView,
  levelProgress,
  lineSeconds,
  markSpot,
  medalScore,
  outfitsFor,
  prepareLandmarks,
  pushBanner,
  readLandmarkSave,
  resetLandmarks,
  spotState,
  startLandmarkRun,
  stepBanner,
  stepLandmarks,
  unlockCounts,
  writeLandmarkSave,
} from "./landmarks.js";
import { LANDMARK_RULES, landmarkCounts } from "../landmarks/validate.js";
import { createGoals, stepGoals } from "./skate/goals.js";
import { createRun, stepRun, teleportRun } from "./skate/run.js";
import { createSkaterEnv } from "./skate/skater.js";
import { createLevelEnv } from "../level/ground.js";
import { goalsFor } from "../level/goals.js";
import { withSkatepark } from "../level/skatepark.js";
import BELTLINE_FILE from "../../levels/beltline-eastside/level.json";
import BELTLINE_SKATEPARK from "../../levels/beltline-eastside/skatepark.json";
import SKATE_FEATURES from "../../assets/skate-features/features.json";
import BELTLINE_SPOTS from "../../levels/beltline-eastside/landmarks.json";

// The level as the game loads it (src/level/levels.js): the skatepark (#222)
// adds its pad to the areas, and the skatepark spot has that pad as its
// footprint.
const BELTLINE = withSkatepark(BELTLINE_FILE, BELTLINE_SKATEPARK, SKATE_FEATURES);

const DT = 1 / 60;

// A small level: a square building (x 0 to 10, z 0 to 10) and a park.
const LEVEL = {
  buildings: [{ id: "b1", outer: [[0, 0], [10, 0], [10, 10], [0, 10]] }],
  areas: [{ id: "a1", outer: [[100, 0], [140, 0], [140, 40], [100, 40]] }],
};

// One spot of each challenge type, far apart, and 1 edge marker.
const SPOTS = {
  v: 1,
  level: "test-level",
  spots: [
    { id: "warehouse", kind: "building", name: "Old Warehouse", at: [5, 5], footprint: { building: "b1" }, find: { edge: 8 }, short: "A 1911 warehouse.", challenge: { type: "combo", tier: "typical", hint: "Land a 1,000 point combo", zone: { x: 0, z: -30, r: 10 }, points: 1000 } },
    { id: "bridge", kind: "bridge", name: "Trail Bridge", at: [300, 0], find: { r: 20 }, short: "A bridge of 1910.", challenge: { type: "gap", tier: "typical", hint: "Hop the bridge", zone: { x: 300, z: 0, r: 8 } } },
    { id: "park", kind: "park", name: "Pond Park", at: [120, 20], footprint: { areas: ["a1"] }, find: { edge: 8 }, short: "A park with a pond.", challenge: { type: "grind", tier: "typical", hint: "Grind the rail for 15 m", feature: "rail:long", zone: { x: 120, z: 60, r: 15 }, meters: 15 } },
    { id: "art", kind: "art", name: "Trail Art", at: [600, 0], find: { r: 14 }, short: "A piece of trail art.", challenge: { type: "line", tier: "typical", hint: "Ride the 3 rings", checkpoints: [[600, 100], [630, 100], [660, 100]], seconds: 14 } },
    { id: "district", kind: "edge", name: "Old District", at: [900, 0], find: { r: 20 }, short: "A district east of here." },
  ],
};

const fresh = (data = SPOTS, progress) => createLandmarks(prepareLandmarks(data, LEVEL), { level: data.level, progress });
const obs = (x, z, over = {}) => ({ position: [x, 0, z], airborne: false, landed: false, bailed: false, teleported: false, grind: null, linked: false, banked: 0, ...over });
const step = (state, o, dt = DT, opts) => stepLandmarks(state, o, dt, opts);
// Far from every spot of SPOTS.
const NOWHERE = [-500, -500];
// A hop: 30 ticks in the air at (x, z), then a landing at (lx, lz).
function hop(state, x, z, { lx = x, lz = z, landed = true, ticks = 30 } = {}) {
  let s = state;
  for (let i = 0; i < ticks; i += 1) s = step(s, obs(x, z, { airborne: true }));
  return step(s, obs(lx, lz, { landed }));
}

// A storage that keeps values, one that refuses to write, and one that
// throws on every call.
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, v) => void map.set(key, String(v)) };
}
const readOnlyStorage = () => ({
  getItem: () => null,
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
});
const blockedStorage = () => ({
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("SecurityError");
  },
});

describe("AC-2: a spot is Found in its find zone", () => {
  it("turns an Unknown spot to Found in the step the skater enters, with a 3.0 s banner", () => {
    let s = fresh();
    s = step(s, obs(40, 5));
    expect(spotState(s, "warehouse")).toBe("unknown");
    expect(s.banner.current).toBeNull();
    s = step(s, obs(18, 5));
    expect(spotState(s, "warehouse")).toBe("found");
    expect(s.events.found).toEqual(["warehouse"]);
    expect(s.run.found).toEqual(["warehouse"]);
    expect(s.banner.current).toMatchObject({ type: "found", id: "warehouse", title: "Old Warehouse", text: "A 1911 warehouse.", time: 3, left: 3 });
  });

  it("shows the banner for 3.0 s of sim time and does not ask for a pause", () => {
    let s = step(fresh(), obs(18, 5));
    for (let i = 0; i < 179; i += 1) s = step(s, obs(40, 5));
    expect(s.banner.current?.id).toBe("warehouse");
    s = step(s, obs(40, 5));
    expect(s.banner.current).toBeNull();
    // The state has no pause flag, and a step never changes `dt`.
    expect(Object.keys(s)).not.toContain("paused");
  });

  it("finds a spot once: the second visit gives no event and no banner", () => {
    let s = step(fresh(), obs(18, 5));
    for (let i = 0; i < 200; i += 1) s = step(s, obs(40, 5));
    s = step(s, obs(18, 5));
    expect(s.events.found).toEqual([]);
    expect(s.banner.current).toBeNull();
  });

  it("returns the same state object when nothing changes", () => {
    const s = fresh();
    expect(step(s, obs(...NOWHERE))).toBe(s);
  });

  it("stops an edge marker at Found, with a gold icon and an open card", () => {
    let s = step(fresh(), obs(900, 10));
    expect(spotState(s, "district")).toBe("found");
    s = markSpot(s, "district", "claimed");
    expect(spotState(s, "district")).toBe("found");
    const view = landmarkView(s).spots.find((v) => v.id === "district");
    expect(view).toMatchObject({ state: "found", gold: true, cardUnlocked: true, ring: false, hint: null });
  });
});

describe("F-2: the find check", () => {
  const spots = prepareLandmarks(SPOTS, LEVEL);
  const by = (id) => spots.find((s) => s.id === id);

  it("finds a building at 8.0 m from the outline, not at 8.01 m, and inside it", () => {
    expect(findDistance(by("warehouse"), 18, 5)).toBe(8);
    expect(findDistance(by("warehouse"), 18.01, 5)).toBeNull();
    expect(findDistance(by("warehouse"), 5, 5)).toBe(0);
    expect(spotState(step(fresh(), obs(18.01, 5)), "warehouse")).toBe("unknown");
    expect(spotState(step(fresh(), obs(5, 5)), "warehouse")).toBe("found");
  });

  it("measures a park to its outline too", () => {
    expect(findDistance(by("park"), 92, 20)).toBe(8);
    expect(findDistance(by("park"), 91.99, 20)).toBeNull();
  });

  it("finds a bridge at 20 m and an art spot at 14 m, edge included", () => {
    expect(findDistance(by("bridge"), 320, 0)).toBe(20);
    expect(findDistance(by("bridge"), 320.01, 0)).toBeNull();
    expect(findDistance(by("art"), 600, 14)).toBe(14);
    expect(findDistance(by("art"), 600, 14.01)).toBeNull();
  });

  it("uses find.at when the file has it, not the map point", () => {
    const data = { ...SPOTS, spots: [{ ...SPOTS.spots[1], find: { r: 14, at: [350, 0] } }] };
    const [spot] = prepareLandmarks(data, LEVEL);
    expect(findDistance(spot, 300, 0)).toBeNull();
    expect(findDistance(spot, 364, 0)).toBe(14);
  });

  it("fails loudly when a footprint is not in the level", () => {
    expect(() => prepareLandmarks(SPOTS, { buildings: [], areas: [] })).toThrow(/warehouse/);
  });
});

describe("AC-4 and F-3: the gap challenge", () => {
  it("claims a typical gap for a hop in the air 8.0 m from the point", () => {
    const s = hop(fresh(), 308, 0);
    expect(spotState(s, "bridge")).toBe("claimed");
  });

  it("does not claim on the ground in the zone, or in the air at 8.01 m", () => {
    let s = fresh();
    for (let i = 0; i < 60; i += 1) s = step(s, obs(300, 0));
    expect(spotState(s, "bridge")).toBe("found");
    expect(spotState(hop(fresh(), 308.01, 0), "bridge")).toBe("found");
  });

  it("needs a landing with no bail, and the air time of the gap goals", () => {
    let s = fresh();
    for (let i = 0; i < 30; i += 1) s = step(s, obs(300, 0, { airborne: true }));
    s = step(s, obs(300, 0, { bailed: true }));
    s = step(s, obs(300, 0, { landed: true }));
    expect(spotState(s, "bridge")).toBe("found");
    // 6 ticks is 0.1 s: less than COMBO.minAirTime (0.2 s).
    expect(spotState(hop(fresh(), 300, 0, { ticks: 6 }), "bridge")).toBe("found");
  });

  it("keeps the air through a grind, as the gap goals do", () => {
    let s = fresh();
    for (let i = 0; i < 30; i += 1) s = step(s, obs(300, 0, { airborne: true }));
    for (let i = 0; i < 30; i += 1) s = step(s, obs(310, 0, { grind: { id: "rail:other", s: i } }));
    s = step(s, obs(320, 0, { airborne: true }));
    s = step(s, obs(322, 0, { landed: true }));
    expect(spotState(s, "bridge")).toBe("claimed");
  });

  it("takes the radius from the tier: easy 12 m, typical 8 m, hard 5 m with a 3 m landing zone", () => {
    const gap = (tier, extra = {}) => ({ ...SPOTS.spots[1], challenge: { type: "gap", tier, hint: "Hop", zone: { x: 300, z: 0 }, ...extra } });
    const one = (spot) => createLandmarks(prepareLandmarks({ ...SPOTS, spots: [spot] }, LEVEL));
    expect(spotState(hop(one(gap("easy")), 312, 0), "bridge")).toBe("claimed");
    expect(spotState(hop(one(gap("easy")), 312.01, 0), "bridge")).toBe("found");
    expect(spotState(hop(one(gap("typical")), 308, 0), "bridge")).toBe("claimed");
    const hard = gap("hard", { landing: { x: 310, z: 0 } });
    expect(prepareLandmarks({ ...SPOTS, spots: [hard] }, LEVEL)[0].challenge).toMatchObject({ zone: { r: 5 }, landing: { r: 3 } });
    expect(spotState(hop(one(hard), 305, 0, { lx: 313, lz: 0 }), "bridge")).toBe("claimed");
    expect(spotState(hop(one(hard), 305, 0, { lx: 313.01, lz: 0 }), "bridge")).toBe("found");
    expect(spotState(hop(one(hard), 305.01, 0, { lx: 310, lz: 0 }), "bridge")).toBe("found");
  });

  it("ignores a travel step: a jump in the air cannot complete a gap", () => {
    let s = fresh();
    for (let i = 0; i < 30; i += 1) s = step(s, obs(-500, 0, { airborne: true }));
    s = step(s, obs(300, 0, { teleported: true }));
    s = step(s, obs(300, 0, { landed: true }));
    expect(spotState(s, "bridge")).toBe("found");
    // In the air on the travel tick itself: the air before it does not count.
    let t = fresh();
    for (let i = 0; i < 30; i += 1) t = step(t, obs(300, 0, { airborne: true }));
    t = step(t, obs(300, 0, { airborne: true, teleported: true }));
    t = step(t, obs(300, 0, { landed: true }));
    expect(spotState(t, "bridge")).toBe("found");
  });
});

describe("AC-4 and F-4: the grind challenge", () => {
  // A 30 m rail along x at z 60: s 0 is x 105.
  const grindTo = (state, from, to, id = "rail:long") => {
    let s = state;
    for (let m = from; m <= to + 1e-9; m += 0.1) s = step(s, obs(105 + m, 60, { grind: { id, s: Math.round(m * 10) / 10 } }));
    return s;
  };

  it("claims a typical grind when 1 grind reaches 15 m, not at 14.9 m", () => {
    expect(spotState(grindTo(fresh(), 3, 17.9), "park")).toBe("unknown");
    expect(spotState(grindTo(fresh(), 3, 18), "park")).toBe("claimed");
  });

  it("counts a grind in the other direction on the rail", () => {
    let s = fresh();
    for (let m = 25; m >= 10; m -= 1) s = step(s, obs(105 + m, 60, { grind: { id: "rail:long", s: m } }));
    expect(spotState(s, "park")).toBe("claimed");
  });

  it("does not add 2 short grinds", () => {
    let s = grindTo(fresh(), 0, 10);
    s = step(s, obs(115, 60, { airborne: true }));
    s = grindTo(s, 10, 20);
    expect(spotState(s, "park")).toBe("unknown");
  });

  it("counts the full length of a grind that starts in the zone and leaves it", () => {
    // The zone is x 105 to 135 on the rail line; this rail runs on to x 160.
    let s = fresh();
    for (let m = 25; m <= 40; m += 1) s = step(s, obs(105 + m, 60, { grind: { id: "rail:long", s: m } }));
    expect(findDistance(s.spots.find((x) => x.id === "park"), 145, 60)).toBeNull();
    expect(spotState(s, "park")).toBe("claimed");
  });

  it("does not claim on another rail, or on the rail with no touch of the zone", () => {
    expect(spotState(grindTo(fresh(), 0, 20, "rail:other"), "park")).toBe("unknown");
    let s = fresh();
    for (let m = 40; m <= 60; m += 1) s = step(s, obs(105 + m, 60, { grind: { id: "rail:long", s: m } }));
    expect(spotState(s, "park")).toBe("unknown");
  });

  it("drops the grind on a bail", () => {
    let s = grindTo(fresh(), 0, 10);
    s = step(s, obs(115, 60, { bailed: true, grind: { id: "rail:long", s: 10 } }));
    s = grindTo(s, 10.1, 20);
    expect(spotState(s, "park")).toBe("unknown");
  });

  it("takes the meters from the tier when the file leaves them out", () => {
    const spot = { ...SPOTS.spots[2], challenge: { type: "grind", tier: "hard", hint: "Grind", feature: "rail:long", zone: { x: 120, z: 60, r: 15 } } };
    expect(prepareLandmarks({ ...SPOTS, spots: [spot] }, LEVEL)[0].challenge.meters).toBe(LANDMARK_RULES.grindMeters.hard);
  });
});

describe("AC-4 and F-5: the line challenge", () => {
  // dt 1 s, so the times are whole numbers.
  const ride = (state, path) => path.reduce((s, [x, z, over]) => step(s, obs(x, z, over), 1), state);
  const wait = (n) => Array.from({ length: n }, () => [615, 100]);

  it("gives T = 14 s for a typical line of 3 checkpoints, 7 s for 2, and 24 s for an easy line of 3", () => {
    expect(lineSeconds("typical", 3)).toBe(14);
    expect(lineSeconds("typical", 2)).toBe(7);
    expect(lineSeconds("easy", 3)).toBe(24);
    const spot = { ...SPOTS.spots[3], challenge: { type: "line", tier: "typical", hint: "Ride", checkpoints: SPOTS.spots[3].challenge.checkpoints } };
    expect(prepareLandmarks({ ...SPOTS, spots: [spot] }, LEVEL)[0].challenge).toMatchObject({ seconds: 14, r: 4 });
  });

  it("claims a finish in order at 14 s after checkpoint 1", () => {
    const s = ride(fresh(), [[600, 100], ...wait(5), [630, 100], ...wait(7), [660, 100]]);
    expect(landmarkView(ride(fresh(), [[600, 100], [615, 100]])).spots.find((v) => v.id === "art").attempt).toEqual({ next: 1, t: 1 });
    expect(spotState(s, "art")).toBe("claimed");
    expect(s.track.lines).toEqual({});
  });

  it("drops a late finish: 15 s is not a claim, and a new attempt can start", () => {
    let s = ride(fresh(), [[600, 100], ...wait(5), [630, 100], ...wait(8), [660, 100]]);
    expect(spotState(s, "art")).toBe("unknown");
    expect(s.track.lines).toEqual({});
    s = ride(s, [[600, 100], [630, 100], [660, 100]]);
    expect(spotState(s, "art")).toBe("claimed");
  });

  it("does not claim checkpoints out of order", () => {
    const s = ride(fresh(), [[600, 100], [660, 100], [630, 100]]);
    expect(spotState(s, "art")).toBe("unknown");
    expect(s.track.lines.art).toMatchObject({ next: 2 });
  });

  it("needs checkpoint 1 first", () => {
    expect(spotState(ride(fresh(), [[630, 100], [660, 100]]), "art")).toBe("unknown");
  });

  it("uses a 4 m checkpoint radius, edge included", () => {
    expect(spotState(ride(fresh(), [[600, 104], [630, 104], [660, 104]]), "art")).toBe("claimed");
    expect(spotState(ride(fresh(), [[600, 104], [630, 104.01], [660, 104]]), "art")).toBe("unknown");
  });

  it("resets the attempt on a bail; the ring stays and the next attempt can claim", () => {
    let s = step(fresh(), obs(600, 10)); // Found: the ring shows
    s = ride(s, [[600, 100], [630, 100], [640, 100, { bailed: true }], [660, 100]]);
    expect(spotState(s, "art")).toBe("found");
    expect(s.track.lines).toEqual({});
    expect(landmarkView(s).spots.find((v) => v.id === "art").ring).toBe(true);
    s = ride(s, [[600, 100], [630, 100], [660, 100]]);
    expect(spotState(s, "art")).toBe("claimed");
  });

  it("starts the timer again while the skater is in checkpoint 1", () => {
    const s = ride(fresh(), [[600, 100], ...wait(20).map(() => [600, 100]), [630, 100], [660, 100]]);
    expect(spotState(s, "art")).toBe("claimed");
  });
});

describe("AC-4 and F-6: the combo challenge", () => {
  // The combo zone of the warehouse is at (0, -30), r 10.
  it("claims a 1200 point combo with the last link 10.0 m from the spot; the bank position does not count", () => {
    let s = step(fresh(), obs(10, -30, { linked: true }));
    s = step(s, obs(60, -30, { banked: 1200 }));
    expect(spotState(s, "warehouse")).toBe("claimed");
  });

  it("claims at the tier value itself (1000) and not at 999", () => {
    const run = (banked) => step(step(fresh(), obs(0, -30, { linked: true })), obs(0, -30, { banked }));
    expect(spotState(run(1000), "warehouse")).toBe("claimed");
    expect(spotState(run(999), "warehouse")).toBe("unknown");
  });

  it("does not claim with the last link at 10.01 m, even when the bank is in the zone", () => {
    let s = step(fresh(), obs(10.01, -30, { linked: true }));
    s = step(s, obs(0, -30, { banked: 5000 }));
    expect(spotState(s, "warehouse")).toBe("unknown");
  });

  it("uses the last link, not an earlier one", () => {
    let s = step(fresh(), obs(0, -30, { linked: true }));
    s = step(s, obs(40, -30, { linked: true }));
    s = step(s, obs(0, -30, { banked: 5000 }));
    expect(spotState(s, "warehouse")).toBe("unknown");
  });

  it("drops the links on a bail", () => {
    let s = step(fresh(), obs(0, -30, { linked: true }));
    s = step(s, obs(0, -30, { bailed: true }));
    s = step(s, obs(0, -30, { banked: 5000 }));
    expect(spotState(s, "warehouse")).toBe("unknown");
  });

  it("takes the points and the radius from the tier: 600 / 1000 / 2000 and 10 m", () => {
    for (const tier of ["easy", "typical", "hard"]) {
      const spot = { ...SPOTS.spots[0], challenge: { type: "combo", tier, hint: "Combo", zone: { x: 0, z: -30 } } };
      expect(prepareLandmarks({ ...SPOTS, spots: [spot] }, LEVEL)[0].challenge).toMatchObject({ points: LANDMARK_RULES.comboPoints[tier], zone: { r: 10 } });
    }
    expect(LANDMARK_RULES.comboPoints).toEqual({ easy: 600, typical: 1000, hard: 2000 });
  });
});

describe("AC-5: a claim", () => {
  it("turns a Found spot to Claimed with the banner, the points, the card, and no ring", () => {
    let s = step(fresh(), obs(300, 15));
    for (let i = 0; i < 200; i += 1) s = step(s, obs(300, 15));
    expect(landmarkView(s).spots.find((v) => v.id === "bridge")).toMatchObject({ state: "found", ring: true, hint: "Hop the bridge", cardUnlocked: false, gold: false });
    s = hop(s, 300, 0);
    expect(spotState(s, "bridge")).toBe("claimed");
    expect(s.events.claimed).toEqual([{ id: "bridge", points: 300, first: true, goal: null }]);
    expect(s.banner.current).toMatchObject({ type: "claimed", id: "bridge", title: "SPOT CLAIMED", text: "Trail Bridge", points: 300, time: 2.5 });
    expect(CLAIMED_TITLE).toBe("SPOT CLAIMED");
    expect(s.run.claimSum).toBe(300);
    expect(medalScore(4000, s)).toBe(4300);
    expect(landmarkView(s).spots.find((v) => v.id === "bridge")).toMatchObject({ state: "claimed", ring: false, hint: null, cardUnlocked: true, gold: true });
  });

  it("does not check a Claimed spot again", () => {
    let s = hop(fresh(), 300, 0);
    s = hop(s, 300, 0);
    expect(s.run.claimed).toHaveLength(1);
    expect(s.events.claimed).toEqual([]);
  });
});

describe("F-1: claim points", () => {
  it("awards 200 for a typical spot with a cap of 1000 and 800 claimed in the run", () => {
    expect(claimAward({ tier: "typical", firstClaim: true, runClaimSum: 800 })).toBe(200);
    expect(claimAward({ tier: "easy" })).toBe(200);
    expect(claimAward({ tier: "typical" })).toBe(300);
    expect(claimAward({ tier: "hard" })).toBe(500);
    expect(claimAward({ tier: "hard", firstClaim: false })).toBe(0);
    expect(claimAward({ tier: "hard", runClaimSum: 1000 })).toBe(0);
  });

  it("awards 0 when the cap is full; the claim still counts and the card unlocks", () => {
    // 4 typical spots: 300 + 300 + 300 + 100, then 0.
    const bridge = (i) => ({ ...SPOTS.spots[1], id: `bridge-${i}`, at: [300 * i, 0], challenge: { ...SPOTS.spots[1].challenge, zone: { x: 300 * i, z: 0, r: 8 } } });
    let s = createLandmarks(prepareLandmarks({ ...SPOTS, spots: [1, 2, 3, 4, 5].map(bridge) }, LEVEL));
    const points = [];
    for (let i = 1; i <= 5; i += 1) {
      s = hop(s, 300 * i, 0);
      points.push(s.events.claimed[0].points);
    }
    expect(points).toEqual([300, 300, 300, 100, 0]);
    expect(s.run.claimSum).toBe(1000);
    expect(s.claimed).toHaveLength(5);
    expect(landmarkView(s).spots[4]).toMatchObject({ state: "claimed", cardUnlocked: true });
    expect(s.banner.queue.at(-1)).toMatchObject({ title: "SPOT CLAIMED", points: 0 });
    // A new run has a new cap; the states stay.
    const next = startLandmarkRun(s);
    expect(next.run).toEqual({ found: [], claimed: [], claimSum: 0 });
    expect(next.claimed).toHaveLength(5);
  });

  it("sums the 20 spots of the GDD to 5800, and the 13 spots of the Beltline file to 4000", () => {
    const tiers = (easy, typical, hard) => [...Array(easy).fill("easy"), ...Array(typical).fill("typical"), ...Array(hard).fill("hard")].map((tier) => ({ kind: "building", tier }));
    expect(claimPointsTotal(tiers(8, 9, 3))).toBe(5800);
    const counts = landmarkCounts(BELTLINE_SPOTS);
    const fromCounts = counts.tiers.easy * 200 + counts.tiers.typical * 300 + counts.tiers.hard * 500;
    expect(claimPointsTotal(BELTLINE_SPOTS.spots)).toBe(fromCounts);
    expect(counts.tiers).toEqual({ easy: 5, typical: 5, hard: 3 });
    expect(fromCounts).toBe(4000);
  });
});

describe("F-7: the banner queue", () => {
  const found = (id) => ({ type: "found", id, title: id, text: "" });
  const claimed = (id) => ({ type: "claimed", id, title: CLAIMED_TITLE, text: id, points: 0 });
  const EMPTY = { current: null, queue: [], dropped: 0 };

  it("shows a Found banner for 3.0, 2.1 and 1.5 s with 0, 1 and 2 banners that wait", () => {
    expect([0, 1, 2].map((q) => bannerTime("found", q))).toEqual([3, 2.1, 1.5]);
    expect([0, 1, 2, 5].map((q) => bannerTime("claimed", q))).toEqual([2.5, 1.75, 1.5, 1.5]);
    expect(stepBanner(EMPTY, 0, [found("a")]).current.time).toBe(3);
    expect(stepBanner(EMPTY, 0, [found("a"), found("b")]).current.time).toBe(2.1);
    expect(stepBanner(EMPTY, 0, [found("a"), found("b"), found("c")]).current.time).toBe(1.5);
  });

  it("shows one banner at a time, each for its time", () => {
    let b = stepBanner(EMPTY, 0, [found("a"), found("b")]);
    expect(b.current).toMatchObject({ id: "a", time: 2.1 });
    b = stepBanner(b, 2.0);
    expect(b.current.id).toBe("a");
    b = stepBanner(b, 0.1);
    expect(b.current).toMatchObject({ id: "b", time: 3, left: 3 });
    b = stepBanner(b, 3);
    expect(b).toEqual(EMPTY);
  });

  it("shows a Claimed banner before the Found banners that wait, in claim order", () => {
    let b = stepBanner(EMPTY, 0, [found("a"), found("b"), found("c")]);
    b = stepBanner(b, 0, [claimed("x"), claimed("y")]);
    expect(b.current.id).toBe("a"); // the banner on show is not cut
    expect(b.queue.map((q) => q.id)).toEqual(["x", "y", "b", "c"]);
  });

  it("holds 2 Found banners; a third has no banner", () => {
    let b = stepBanner(EMPTY, 0, [found("a")]);
    b = stepBanner(b, 0, [found("b"), found("c"), found("d")]);
    expect(b.queue.map((q) => q.id)).toEqual(["b", "c"]);
    expect(b.dropped).toBe(1);
  });

  it("never drops a Claimed banner, and each one shows for 1.5 s or more", () => {
    let b = EMPTY;
    b = pushBanner(pushBanner(pushBanner(b, found("f1")), found("f2")), found("f3"));
    for (let i = 0; i < 6; i += 1) b = pushBanner(b, claimed(`c${i}`));
    expect(b.queue.filter((q) => q.type === "claimed")).toHaveLength(6);
    const shown = [];
    b = stepBanner(b, 0);
    while (b.current) {
      shown.push([b.current.id, b.current.time]);
      b = stepBanner(b, b.current.time);
    }
    expect(shown.map((x) => x[0])).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "f1", "f2"]);
    expect(Math.min(...shown.map((x) => x[1]))).toBe(1.5);
  });

  it("changes the state and the icon of a spot whose Found banner is dropped", () => {
    // 4 point spots at one place: 1 banner shows, 2 wait, 1 is dropped.
    const at = (i) => ({ ...SPOTS.spots[4], id: `edge-${i}`, at: [0, i] });
    const s = step(createLandmarks(prepareLandmarks({ ...SPOTS, spots: [0, 1, 2, 3].map(at) }, LEVEL)), obs(0, 0));
    expect(s.found).toHaveLength(4);
    expect(s.banner.dropped).toBe(1);
    expect(s.banner.queue).toHaveLength(2);
    expect(landmarkView(s).spots.every((v) => v.state === "found" && v.gold)).toBe(true);
  });
});

describe("the banner of a spot that is claimed while its Found banner waits", () => {
  it("takes the Found banner out of the queue", () => {
    let s = markSpot(fresh(), "warehouse", "found");
    s = markSpot(s, "bridge", "found");
    expect(s.banner.queue.map((q) => [q.type, q.id])).toEqual([["found", "bridge"]]);
    s = markSpot(s, "bridge", "claimed");
    expect(s.banner.current.id).toBe("warehouse");
    expect(s.banner.queue.map((q) => [q.type, q.id])).toEqual([["claimed", "bridge"]]);
  });
});

describe("F-8: the collection", () => {
  it("unlocks an outfit at 7, 14 and 20 claims of 20, and at 7, 14 and 19 of 19", () => {
    expect(unlockCounts(20)).toEqual([7, 14, 20]);
    expect(unlockCounts(19)).toEqual([7, 14, 19]);
    expect([6, 7, 13, 14, 19, 20].map((n) => outfitsFor(n, 20))).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it("takes N from the claim spots of the file: 5, 10 and 13 for the Beltline file", () => {
    const s = createLandmarks(prepareLandmarks(BELTLINE_SPOTS, BELTLINE));
    expect(s.claimSpots).toBe(landmarkCounts(BELTLINE_SPOTS).claim);
    expect(s.claimSpots).toBe(13);
    expect(landmarkView(s).unlocks).toEqual({ at: [5, 10, 13], unlocked: 0 });
    expect(landmarkView(s).counts).toEqual({ spots: 15, claimSpots: 13, found: 0, claimed: 0 });
  });

  it("counts the unlocks as the claims come in, and a reset keeps them", () => {
    // 4 claim spots: the unlocks are at 2, 3 and 4.
    let s = fresh();
    expect(landmarkView(s).unlocks.at).toEqual([2, 3, 4]);
    s = markSpot(s, "bridge", "claimed");
    expect(s.outfits).toBe(0);
    s = markSpot(s, "park", "claimed");
    expect(s.outfits).toBe(1);
    s = resetLandmarks(s);
    expect(s.claimed).toEqual([]);
    expect(s.found).toEqual([]);
    expect(s.outfits).toBe(1);
  });
});

describe("E-1: 2 find zones overlap", () => {
  it("finds both spots in 1 step, and the nearer spot shows its banner first", () => {
    // 2 bridges, 10 m apart. The skater is 4 m from the second one.
    const far = { ...SPOTS.spots[1], id: "far-bridge", name: "Far Bridge", at: [300, 0] };
    const near = { ...SPOTS.spots[1], id: "near-bridge", name: "Near Bridge", at: [300, 10] };
    let s = createLandmarks(prepareLandmarks({ ...SPOTS, spots: [far, near] }, LEVEL));
    s = step(s, obs(300, 14, {}));
    expect(s.events.found).toEqual(["near-bridge", "far-bridge"]);
    expect(s.found).toHaveLength(2);
    expect(s.banner.current).toMatchObject({ id: "near-bridge", time: 2.1 });
    expect(s.banner.queue.map((q) => q.id)).toEqual(["far-bridge"]);
  });
});

describe("E-2: the run starts inside a find zone", () => {
  it("does not check before the run timer starts, and finds the spot on the first tick after", () => {
    let s = fresh();
    for (let i = 0; i < 60; i += 1) s = step(s, obs(5, 5), DT, { active: false });
    expect(spotState(s, "warehouse")).toBe("unknown");
    s = step(s, obs(5, 5), DT, { active: true });
    expect(spotState(s, "warehouse")).toBe("found");
  });

  it("drops an open attempt when the run and its overtime are over, and still counts the banner down", () => {
    let s = step(fresh(), obs(600, 10), 1);
    expect(s.banner.current.left).toBe(3);
    s = step(s, obs(600, 100), 1);
    expect(s.track.lines.art).toEqual({ next: 1, t: 0 });
    s = step(s, obs(630, 100), 1, { active: false });
    expect(s.track.lines).toEqual({});
    expect(s.banner.current.left).toBe(1);
    s = step(s, obs(660, 100), 1, { active: false });
    expect(spotState(s, "art")).toBe("found");
    expect(s.banner.current).toBeNull();
  });
});

describe("E-4: a challenge completes on an Unknown spot", () => {
  it("gives Found and Claimed in 1 step, with the SPOT CLAIMED banner only", () => {
    // The find zone of this bridge is away from its gap zone, so the hop
    // completes the gap while the spot is still Unknown.
    let u = createLandmarks(prepareLandmarks({ ...SPOTS, spots: [{ ...SPOTS.spots[1], find: { r: 10, at: [300, 200] } }] }, LEVEL));
    for (let i = 0; i < 30; i += 1) u = step(u, obs(300, 0, { airborne: true }));
    expect(spotState(u, "bridge")).toBe("unknown");
    u = step(u, obs(300, 0, { landed: true }));
    expect(spotState(u, "bridge")).toBe("claimed");
    expect(u.found).toEqual(["bridge"]);
    expect(u.events).toEqual({ found: [], claimed: [{ id: "bridge", points: 300, first: true, goal: null }] });
    expect(u.banner.current).toMatchObject({ type: "claimed", title: "SPOT CLAIMED" });
    expect(u.banner.queue).toEqual([]);
  });

  it("shows no Found banner when the claim and the first entry are in the same step", () => {
    // The combo zone of the warehouse is outside its find zone: the bank
    // tick is the first tick inside the find zone.
    let s = step(fresh(), obs(0, -30, { linked: true }));
    expect(spotState(s, "warehouse")).toBe("unknown");
    s = step(s, obs(5, -8, { banked: 1200 }));
    expect(spotState(s, "warehouse")).toBe("claimed");
    expect(s.events.found).toEqual([]);
    expect(s.banner.current.type).toBe("claimed");
    expect(s.banner.queue).toEqual([]);
  });
});

describe("AC-6 and E-6: the save", () => {
  const KEY = "atl.landmarks";

  it("writes { v: 1, levels: { <level>: { found, claimed } } } under atl.landmarks", () => {
    const storage = fakeStorage();
    const tracker = createLandmarkTracker({ data: SPOTS, level: LEVEL, storage });
    tracker.step(obs(18, 5), DT);
    for (let i = 0; i < 31; i += 1) tracker.step(obs(300, 0, { airborne: i < 30, landed: i === 30 }), DT);
    expect(LANDMARKS.saveKey).toBe(KEY);
    expect(JSON.parse(storage.map.get(KEY))).toEqual({ v: 1, levels: { "test-level": { found: ["warehouse", "bridge"], claimed: ["bridge"], outfits: 0 } } });
    expect(tracker.saved).toBe(true);
  });

  it("gives the same states after a reload, and the run record lists only this run", () => {
    const storage = fakeStorage();
    const first = createLandmarkTracker({ data: SPOTS, level: LEVEL, storage });
    first.step(obs(18, 5), DT);
    first.mark("bridge", "claimed");
    expect(first.state.run.claimed.map((c) => c.id)).toEqual(["bridge"]);

    const second = createLandmarkTracker({ data: SPOTS, level: LEVEL, storage });
    expect(second.state.found).toEqual(["warehouse", "bridge"]);
    expect(second.state.claimed).toEqual(["bridge"]);
    expect(second.state.run).toEqual({ found: [], claimed: [], claimSum: 0 });
    expect(second.state.banner.current).toBeNull();
    second.mark("park", "claimed");
    expect(second.state.run.claimed).toEqual([{ id: "park", points: 300, first: true }]);
    expect(second.view().spots.map((v) => v.state)).toEqual(["found", "claimed", "claimed", "unknown", "unknown"]);
  });

  it("keeps the progress of the other levels", () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ v: 1, levels: { "other-level": { found: ["a", "b"], claimed: ["a"] } } }) });
    createLandmarkTracker({ data: SPOTS, level: LEVEL, storage }).mark("bridge", "found");
    const save = JSON.parse(storage.map.get(KEY));
    expect(save.levels["other-level"]).toEqual({ found: ["a", "b"], claimed: ["a"], outfits: 0 });
    expect(save.levels["test-level"].found).toEqual(["bridge"]);
  });

  it("ignores a spot id that the level file does not have, with no error (E-6)", () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ v: 1, levels: { "test-level": { found: ["gone-spot", "bridge", 7, null], claimed: ["gone-spot", "district"] } } }) });
    const tracker = createLandmarkTracker({ data: SPOTS, level: LEVEL, storage });
    expect(tracker.state.found).toEqual(["bridge"]);
    expect(tracker.state.claimed).toEqual([]); // an edge marker is never Claimed
    expect(tracker.view().spots.map((v) => v.state)).toEqual(["unknown", "found", "unknown", "unknown", "unknown"]);
    expect(tracker.saved).toBe(true);
  });

  it("reads a Claimed id as Found too", () => {
    const s = fresh(SPOTS, { found: [], claimed: ["park"] });
    expect(s.found).toEqual(["park"]);
  });

  it("reads a broken value, another version, or a wrong shape as an empty save, with no error", () => {
    for (const text of ["not json", "null", "[]", JSON.stringify({ v: 2, levels: { "test-level": { found: ["bridge"], claimed: [] } } }), JSON.stringify({ v: 1, levels: 5 }), JSON.stringify({ v: 1, levels: { "test-level": "x", __proto__: null } })]) {
      const storage = fakeStorage({ [KEY]: text });
      const read = readLandmarkSave(storage);
      expect(read.ok).toBe(true);
      expect(levelProgress(read.save, "test-level")).toEqual({ found: [], claimed: [], outfits: 0 });
      expect(createLandmarkTracker({ data: SPOTS, level: LEVEL, storage }).state.found).toEqual([]);
    }
    expect(levelProgress({ v: 1, levels: {} }, "__proto__")).toEqual({ found: [], claimed: [], outfits: 0 });
  });

  it("reads a level named __proto__ in a hostile save as a plain entry, with no change to a prototype", () => {
    const text = '{"v":1,"levels":{"__proto__":{"found":["bridge"],"claimed":[],"outfits":2},"constructor":{"found":["x"]},"test-level":{"found":["park"]}}}';
    const { save, ok } = readLandmarkSave(fakeStorage({ [KEY]: text }));
    expect(ok).toBe(true);
    expect(Object.getPrototypeOf(save.levels)).toBe(Object.prototype);
    expect(Object.keys(save.levels).sort()).toEqual(["__proto__", "constructor", "test-level"]);
    expect({}.found).toBeUndefined();
    expect(levelProgress(save, "__proto__")).toEqual({ found: ["bridge"], claimed: [], outfits: 2 });
    expect(levelProgress(save, "toString")).toEqual({ found: [], claimed: [], outfits: 0 });
    // The tracker of the real level reads only its own entry.
    expect(createLandmarkTracker({ data: SPOTS, level: LEVEL, storage: fakeStorage({ [KEY]: text }) }).state.found).toEqual(["park"]);
    // A level list that is an array is a wrong shape.
    expect(readLandmarkSave(fakeStorage({ [KEY]: '{"v":1,"levels":[{"found":["q"]}]}' })).save.levels).toEqual({});
  });

  it("does not write over a save of another version until a spot changes", () => {
    const text = JSON.stringify({ v: 2, levels: {} });
    const storage = fakeStorage({ [KEY]: text });
    const tracker = createLandmarkTracker({ data: SPOTS, level: LEVEL, storage });
    expect(storage.map.get(KEY)).toBe(text);
    tracker.mark("bridge", "found");
    expect(JSON.parse(storage.map.get(KEY)).v).toBe(1);
  });

  it("keeps the claims for this page when the storage is blocked, missing, or read only", () => {
    for (const storage of [blockedStorage(), null, readOnlyStorage()]) {
      const tracker = createLandmarkTracker({ data: SPOTS, level: LEVEL, storage });
      expect(tracker.saved).toBe(false);
      tracker.mark("bridge", "claimed");
      expect(spotState(tracker.state, "bridge")).toBe("claimed");
      expect(tracker.state.run.claimSum).toBe(300);
      expect(tracker.saved).toBe(false);
      expect(() => tracker.reset()).not.toThrow();
      expect(tracker.saved).toBe(false);
    }
    expect(writeLandmarkSave(blockedStorage(), fresh())).toBe(false);
  });

  it("resets every level and keeps the unlocked outfits", () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ v: 1, levels: { "other-level": { found: ["a"], claimed: ["a"], outfits: 2 } } }) });
    const tracker = createLandmarkTracker({ data: SPOTS, level: LEVEL, storage });
    tracker.mark("bridge", "claimed");
    tracker.mark("park", "claimed");
    tracker.reset();
    expect(tracker.view().spots.every((v) => v.state === "unknown")).toBe(true);
    expect(JSON.parse(storage.map.get(KEY))).toEqual({ v: 1, levels: { "other-level": { found: [], claimed: [], outfits: 2 }, "test-level": { found: [], claimed: [], outfits: 1 } } });
    expect(createLandmarkTracker({ data: SPOTS, level: LEVEL, storage }).state.outfits).toBe(1);
  });
});

describe("gap goals", () => {
  const def = goalsFor("beltline-eastside");
  const spots = prepareLandmarks(BELTLINE_SPOTS, BELTLINE);
  const by = (id) => spots.find((s) => s.id === id);

  it("links a gap goal only to a gap challenge at the same zone", () => {
    expect(gapGoalOf(by("freedom-parkway-bridge"), def)).toBe("gap-freedom-parkway");
    expect(by("freedom-parkway-bridge").challenge.goal).toBe("gap-freedom-parkway");
    // A gap at another zone, and bridges with a grind or a line challenge.
    expect(gapGoalOf(by("ponce-de-leon-bridge"), def)).toBeNull();
    expect(gapGoalOf(by("ralph-mcgill-bridge"), def)).toBeNull();
    expect(gapGoalOf(by("north-avenue-bridge"), def)).toBeNull();
    // A grind challenge with the zone of the goal still does not complete it.
    const grind = { ...by("ralph-mcgill-bridge"), challenge: { ...by("ralph-mcgill-bridge").challenge, zone: { ...def.goals.find((g) => g.id === "gap-freedom-parkway").zone } } };
    expect(gapGoalOf(grind, def)).toBeNull();
    expect(spots.filter((s) => gapGoalOf(s, def)).map((s) => s.id)).toEqual(["freedom-parkway-bridge"]);
  });
});

describe("the dev test hook", () => {
  it("is null outside a dev build", () => {
    const tracker = createLandmarkTracker({ data: SPOTS, level: LEVEL, storage: fakeStorage() });
    expect(landmarkTestHook(tracker)).toBeNull();
    expect(landmarkTestHook(tracker, { dev: false })).toBeNull();
  });

  it("reads the states and the banner, and sets a spot, in a dev build", () => {
    const tracker = createLandmarkTracker({ data: SPOTS, level: LEVEL, storage: fakeStorage() });
    const hook = landmarkTestHook(tracker, { dev: true });
    expect(hook.states()).toEqual({ warehouse: "unknown", bridge: "unknown", park: "unknown", art: "unknown", district: "unknown" });
    expect(hook.find("warehouse")).toBe("found");
    expect(hook.claim("bridge")).toBe("claimed");
    expect(hook.claim("no-such-spot")).toBe("unknown");
    expect(hook.banner()).toMatchObject({ current: { id: "warehouse", time: 3 }, waiting: 1, dropped: 0 });
    expect(hook.run().claimSum).toBe(300);
    expect(hook.saved()).toBe(true);
    hook.reset();
    expect(Object.values(hook.states()).every((v) => v === "unknown")).toBe(true);
  });
});

// The real level, the real controller, the real landmark file. The skater
// rides the trail at x 336 to the north (-z), as in the gap goal tests of
// src/sim/skate/goals.test.js.
describe("with the real controller on the Beltline level", () => {
  const env = createLevelEnv(BELTLINE);
  const skaterEnv = createSkaterEnv(BELTLINE);
  const def = goalsFor("beltline-eastside");
  const spots = prepareLandmarks(BELTLINE_SPOTS, BELTLINE);

  function ride(z, script, { travelAt = null } = {}) {
    const y = env.sampleGround(336, z, 26.5).height;
    let r = createRun(BELTLINE, { position: [336, y, z], yaw: Math.PI / 2 });
    let g = createGoals(def);
    let s = createLandmarks(spots, { level: "beltline-eastside" });
    const log = { goalTick: null, claimTick: null, foundTick: null };
    let tick = 0;
    for (const e of script) for (let i = 0; i < e.frames; i += 1) {
      tick += 1;
      let teleported = false;
      if (tick === travelAt) {
        // "Travel here" while the skater is in the air: the run moves to the
        // trail under the bridge, at rest.
        r = teleportRun(r, BELTLINE, { position: [336, env.sampleGround(336, 18.6, 26.5).height, 18.6], yaw: Math.PI / 2 });
        teleported = true;
      } else r = stepRun(r, e.input, DT, env, skaterEnv);
      g = stepGoals(g, r, def, DT);
      s = stepLandmarks(s, landmarkObs(r, { teleported }), DT);
      if (g.justCleared.includes("gap-freedom-parkway")) log.goalTick ??= tick;
      if (s.events.claimed.length) log.claimTick ??= tick;
      if (s.events.found.includes("freedom-parkway-bridge")) log.foundTick ??= tick;
    }
    return { s, g, log };
  }
  const HOP = [{ frames: 90, input: { push: true } }, { frames: 1, input: { push: true, jump: true } }, { frames: 90, input: {} }];

  it("prepares the 13 claim spots and the 2 edge markers of the file", () => {
    expect(spots).toHaveLength(15);
    expect(spots.filter((s) => s.challenge)).toHaveLength(13);
    expect(spots.filter((s) => s.kind === "edge").every((s) => s.challenge === null)).toBe(true);
    // Each value of a challenge in the file is the value of its tier.
    for (const s of spots.filter((x) => x.challenge)) {
      const c = s.challenge;
      if (c.type === "gap") expect(c.zone.r).toBe(LANDMARK_RULES.gapR[c.tier]);
      if (c.type === "combo") expect(c.points).toBe(LANDMARK_RULES.comboPoints[c.tier]);
      if (c.type === "line") expect(c.seconds).toBe(lineSeconds(c.tier, c.checkpoints.length));
    }
  });

  it("finds the Freedom Parkway bridge on the ride in, then claims it with a hop on the tick the gap goal clears", () => {
    const { s, g, log } = ride(40, HOP);
    expect(g.gaps).toEqual(["gap-freedom-parkway"]);
    expect(spotState(s, "freedom-parkway-bridge")).toBe("claimed");
    expect(log.foundTick).toBeLessThan(log.claimTick);
    expect(log.claimTick).toBe(log.goalTick);
    expect(s.run.claimed).toEqual([{ id: "freedom-parkway-bridge", points: 200, first: true }]);
    expect(s.claimed).toEqual(["freedom-parkway-bridge"]);
  });

  it("does not claim for a ride through the zone on the ground", () => {
    const { s } = ride(40, [{ frames: 240, input: { push: true } }]);
    expect(spotState(s, "freedom-parkway-bridge")).toBe("found");
    expect(s.run.claimed).toEqual([]);
  });

  it("does not claim for a hop away from every spot", () => {
    const { s } = ride(140, HOP);
    expect(s.claimed).toEqual([]);
  });

  it("finds the spot after a travel step into the zone, and a jump before the travel does not claim the gap", () => {
    // Far south of the bridge: a hop, and a travel step in the air.
    const { s } = ride(160, [{ frames: 30, input: { push: true } }, { frames: 1, input: { push: true, jump: true } }, { frames: 60, input: {} }], { travelAt: 40 });
    expect(spotState(s, "freedom-parkway-bridge")).toBe("found");
  });
});
