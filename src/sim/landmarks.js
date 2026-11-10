// Landmark discovery (#217). Pure and immutable: no DOM, no Three.js, no
// file access. Every function returns a new object.
//
// Design: design/gdd/landmark-discovery.md (Core Rules 2 to 6, States and
// Transitions, Formulas, Edge Cases). The data is levels/<level>/landmarks.json
// (#216); the tier values of the challenges come from LANDMARK_RULES in
// src/landmarks/validate.js.
//
// A spot is Unknown, Found or Claimed, per save. The skater finds a spot in
// its find zone and claims it with its challenge (gap, grind, line, combo).
// An `edge` marker has no challenge and stops at Found.
//
// This module reads the controller output and does not change the
// controller. One step takes an observation:
//   { position: [x, y, z], airborne, landed, bailed, teleported,
//     grind: { id, s } | null, linked, banked }
// landmarkObs(run) makes it from a run of src/sim/skate/run.js.
//
// The save goes through an injected storage object (getItem / setItem), so
// this module never touches window.localStorage itself.

import { LANDMARK_RULES, outlineDistance } from "../landmarks/validate.js";
import { COMBO } from "./skate/constants.js";

export const LANDMARKS = {
  claimPoints: { easy: 200, typical: 300, hard: 500 }, // P[tier]. min 100 / max 600 per tier.
  runCap: 1000, // claim points per run. min 600 / typical 1000 / max 1500.
  checkpointR: 4, // m, r_cp of a line checkpoint. Fixed.
  minAirTime: COMBO.minAirTime, // s in the air for a gap, the same as the gap goals.
  banner: {
    found: 3.0, // s, t_base of a Found banner. min 2 / typical 3 / max 4.
    claimed: 2.5, // s, t_base of a Claimed banner. min 1.5 / typical 2.5 / max 3.5.
    min: 1.5, // s, t_min.
    queueStep: 0.3, // each banner that waits takes this share off t_base.
    foundQueueMax: 2, // Found banners that can wait. Claimed banners have no cap.
  },
  unlockFractions: [0.35, 0.7, 1.0], // f_i, of the claim spots of the level. Tune 0.25 to 1.0.
  saveKey: "atl.landmarks",
  saveVersion: 1,
};

export const CLAIMED_TITLE = "SPOT CLAIMED";

const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const inCircle = (zone, x, z) => dist2(zone.x, zone.z, x, z) <= zone.r;

// ---------------------------------------------------------------- formulas

// awarded = min(first_claim ? P[tier] : 0, run_cap - run_claim_sum)
export function claimAward({ tier, firstClaim = true, runClaimSum = 0 }, k = LANDMARKS) {
  const points = firstClaim ? (k.claimPoints[tier] ?? 0) : 0;
  return Math.max(0, Math.min(points, k.runCap - runClaimSum));
}

// The claim points of every claim spot of a file, with no run cap.
export function claimPointsTotal(spots, k = LANDMARKS) {
  return spots.reduce((sum, s) => sum + (s.kind === "edge" ? 0 : (k.claimPoints[s.tier ?? s.challenge?.tier] ?? 0)), 0);
}

// T = ceil((n - 1) * d * s / v_line)
export function lineSeconds(tier, checkpoints, R = LANDMARK_RULES) {
  return Math.ceil(((checkpoints - 1) * R.lineSpacing[tier] * R.lineSlack[tier]) / R.lineSpeed);
}

// t_show = clamp(t_base * (1 - 0.3 * q), t_min, t_base), to 1 ms.
export function bannerTime(type, waiting, k = LANDMARKS) {
  const base = k.banner[type];
  const t = Math.min(base, Math.max(k.banner.min, base * (1 - k.banner.queueStep * waiting)));
  return Math.round(t * 1000) / 1000;
}

// unlock_i = ceil(f_i * N). N is the count of claim spots that ship. The
// fractions count in whole percent, so 0.35 * 20 is 7 and not 7.000000000000001.
export function unlockCounts(claimSpots, k = LANDMARKS) {
  return k.unlockFractions.map((f) => Math.ceil((Math.round(f * 100) * claimSpots) / 100));
}

// The count of outfits that `claimed` claims unlock.
export function outfitsFor(claimed, claimSpots, k = LANDMARKS) {
  if (claimSpots <= 0) return 0;
  return unlockCounts(claimSpots, k).filter((n) => claimed >= n).length;
}

// Claim points count toward the medals only, not toward the score goal.
export function medalScore(bankedScore, state) {
  return bankedScore + state.run.claimSum;
}

// ------------------------------------------------------------------- spots

function shapesOf(spot, level) {
  const fp = spot.footprint ?? {};
  const pick = (list, id, what) => {
    const hit = (list ?? []).find((x) => x.id === id);
    if (!hit) throw new Error(`landmarks: spot "${spot.id}" names the ${what} "${id}", and the level does not have it`);
    return [hit.outer, ...(hit.holes ?? [])];
  };
  if (typeof fp.building === "string") return [pick(level.buildings, fp.building, "building")];
  if (Array.isArray(fp.areas) && fp.areas.length) return fp.areas.map((id) => pick(level.areas, id, "area"));
  throw new Error(`landmarks: spot "${spot.id}" has find.edge and no footprint`);
}

function boxOf(shapes, pad) {
  const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const rings of shapes) {
    for (const [x, z] of rings[0]) {
      box.minX = Math.min(box.minX, x - pad);
      box.maxX = Math.max(box.maxX, x + pad);
      box.minZ = Math.min(box.minZ, z - pad);
      box.maxZ = Math.max(box.maxZ, z + pad);
    }
  }
  return box;
}

function prepareChallenge(c, k, R) {
  if (!c) return null;
  const base = { type: c.type, tier: c.tier, hint: c.hint ?? "" };
  if (c.type === "gap") {
    return { ...base, zone: { ...c.zone, r: c.zone.r ?? R.gapR[c.tier] }, landing: c.landing ? { ...c.landing, r: c.landing.r ?? R.gapLanding } : null, goal: c.goal ?? null };
  }
  if (c.type === "grind") return { ...base, feature: c.feature, zone: { ...c.zone }, meters: c.meters ?? R.grindMeters[c.tier] };
  if (c.type === "line") {
    const checkpoints = c.checkpoints.map((p) => [p[0], p[1]]);
    return { ...base, checkpoints, r: k.checkpointR, seconds: c.seconds ?? lineSeconds(c.tier, checkpoints.length, R) };
  }
  if (c.type === "combo") return { ...base, zone: { ...c.zone, r: c.zone.r ?? R.comboR }, points: c.points ?? R.comboPoints[c.tier] };
  throw new Error(`landmarks: unknown challenge type "${c.type}"`);
}

// The spots of a data file, ready for the checks. `level` gives the building
// and area outlines for the edge distance ({ buildings, areas }); a file with
// no `find.edge` needs no level. A value that the file leaves out comes from
// the tier (LANDMARK_RULES).
export function prepareLandmarks(data, level = {}, k = LANDMARKS, R = LANDMARK_RULES) {
  return data.spots.map((s) => {
    let find;
    if (s.find.edge != null) {
      const shapes = shapesOf(s, level);
      find = { edge: s.find.edge, shapes, box: boxOf(shapes, s.find.edge) };
    } else {
      const at = s.find.at ?? s.at;
      find = { r: s.find.r, at: [at[0], at[1]] };
    }
    const challenge = s.kind === "edge" ? null : prepareChallenge(s.challenge, k, R);
    return { id: s.id, kind: s.kind, name: s.name, short: s.short ?? "", at: [s.at[0], s.at[1]], tier: challenge?.tier ?? null, find, challenge, card: s.card ?? [] };
  });
}

// The find distance of a spot from (x, z): the distance to the footprint (0
// inside it) or to the find point. Null when the skater is outside the zone.
// The edge of the zone is inside it (8.0 m of 8 m is Found).
export function findDistance(spot, x, z) {
  const f = spot.find;
  if (f.edge != null) {
    if (x < f.box.minX || x > f.box.maxX || z < f.box.minZ || z > f.box.maxZ) return null;
    let best = Infinity;
    for (const rings of f.shapes) best = Math.min(best, outlineDistance([x, z], rings));
    return best <= f.edge ? best : null;
  }
  const d = dist2(f.at[0], f.at[1], x, z);
  return d <= f.r ? d : null;
}

// The id of the gap goal (goals.json) that a claim of this spot completes,
// or null. Only a `gap` challenge at the same zone completes a gap goal: a
// bridge with a grind or a line challenge does not.
export function gapGoalOf(spot, goalDef) {
  const c = spot.challenge;
  if (!c || c.type !== "gap") return null;
  const goal = (goalDef?.goals ?? []).find((g) => g.type === "gap" && g.zone.x === c.zone.x && g.zone.z === c.zone.z && g.zone.r === c.zone.r);
  return goal ? goal.id : null;
}

// ------------------------------------------------------------------- state

const NO_TRACK = { air: null, grind: null, lines: {}, link: null };
const NO_BANNER = { current: null, queue: [], dropped: 0 };
const NO_EVENTS = { found: [], claimed: [] };
const newRunPart = () => ({ found: [], claimed: [], claimSum: 0 });

// `progress` is { found, claimed, outfits } from the save (levelProgress).
// Ids that the spot list does not have are ignored. An edge marker is never
// Claimed. A Claimed spot is also Found.
export function createLandmarks(spots, { level = null, progress = {} } = {}, k = LANDMARKS) {
  const ids = (list) => (Array.isArray(list) ? list : []);
  const claimed = spots.filter((s) => s.challenge && ids(progress.claimed).includes(s.id)).map((s) => s.id);
  const found = spots.filter((s) => ids(progress.found).includes(s.id) || claimed.includes(s.id)).map((s) => s.id);
  const claimSpots = spots.filter((s) => s.challenge).length;
  const saved = Number.isInteger(progress.outfits) ? Math.max(0, Math.min(k.unlockFractions.length, progress.outfits)) : 0;
  return {
    level,
    spots,
    claimSpots,
    found,
    claimed,
    outfits: Math.max(saved, outfitsFor(claimed.length, claimSpots, k)), // the most outfits this save unlocked; a reset keeps it
    run: newRunPart(), // what this run found and claimed: { found: [ids], claimed: [{ id, points, first }], claimSum }
    track: NO_TRACK, // the open attempts
    banner: NO_BANNER,
    events: NO_EVENTS, // this step: { found: [ids], claimed: [{ id, points, first, goal }] }
  };
}

// A new run: the states stay, the run record and the attempts start again.
export function startLandmarkRun(state) {
  return { ...state, run: newRunPart(), track: NO_TRACK, banner: NO_BANNER, events: NO_EVENTS };
}

// "Reset progress": every spot is Unknown again. The unlocked outfits stay.
export function resetLandmarks(state) {
  return { ...state, found: [], claimed: [], run: newRunPart(), track: NO_TRACK, banner: NO_BANNER, events: NO_EVENTS };
}

export function spotState(state, id) {
  if (state.claimed.includes(id)) return "claimed";
  return state.found.includes(id) ? "found" : "unknown";
}

// What the maps, the HUD and the results screen read.
export function landmarkView(state, k = LANDMARKS) {
  const spots = state.spots.map((s) => {
    const st = spotState(state, s.id);
    const edge = s.kind === "edge";
    return {
      id: s.id,
      kind: s.kind,
      name: s.name,
      at: s.at,
      short: s.short,
      state: st,
      gold: st === "claimed" || (edge && st === "found"),
      cardUnlocked: st === "claimed" || (edge && st === "found"),
      ring: st === "found" && !edge, // the challenge ring and the HUD hint show
      hint: st === "found" && !edge ? s.challenge.hint : null,
      challenge: s.challenge,
      attempt: state.track.lines[s.id] ?? null, // a line in progress: { next, t }
    };
  });
  return {
    spots,
    counts: { spots: state.spots.length, claimSpots: state.claimSpots, found: state.found.length, claimed: state.claimed.length },
    unlocks: { at: unlockCounts(state.claimSpots, k), unlocked: state.outfits },
    run: state.run,
    banner: state.banner.current,
  };
}

// ------------------------------------------------------------------ banner

// One banner shows at a time. A Claimed banner goes before a Found banner.
// At most `foundQueueMax` Found banners wait; one more is dropped. A Claimed
// banner is never dropped. The time of a banner is set when it starts to
// show, from the count of banners that still wait.

// Adds a banner to the queue, in show order. No cap here (stepBanner).
export function pushBanner(banner, item) {
  if (item.type !== "claimed") return { ...banner, queue: [...banner.queue, item] };
  const at = banner.queue.findIndex((b) => b.type !== "claimed");
  const queue = at < 0 ? [...banner.queue, item] : [...banner.queue.slice(0, at), item, ...banner.queue.slice(at)];
  return { ...banner, queue };
}

// One tick: the banner on show loses `dt`, the new banners join the queue,
// the next one starts when none shows, and the Found banners past the cap
// are dropped (the newest first).
export function stepBanner(banner, dt, items = [], k = LANDMARKS) {
  if (!banner.current && !banner.queue.length && !items.length) return banner;
  let b = banner;
  if (b.current) {
    const left = b.current.left - dt;
    b = { ...b, current: left > 1e-9 ? { ...b.current, left } : null };
  }
  for (const item of items) b = pushBanner(b, item);
  let next = null;
  if (!b.current && b.queue.length) {
    next = b.queue[0];
    b = { ...b, queue: b.queue.slice(1) };
  }
  let room = k.banner.foundQueueMax;
  const queue = b.queue.filter((q) => q.type === "claimed" || (room -= 1) >= 0);
  if (queue.length !== b.queue.length) b = { ...b, queue, dropped: b.dropped + b.queue.length - queue.length };
  if (next) {
    const time = bannerTime(next.type, b.queue.length, k);
    b = { ...b, current: { ...next, time, left: time } };
  }
  return b;
}

const foundBanner = (spot) => ({ type: "found", id: spot.id, title: spot.name, text: spot.short });
const claimedBanner = (spot, points) => ({ type: "claimed", id: spot.id, title: CLAIMED_TITLE, text: spot.name, points });

// -------------------------------------------------------------------- step

// Applies the claims and the finds of one step, in that order. A spot that
// is claimed before it is Found becomes Found and Claimed here, with the
// Claimed banner only. `finds` is in banner order (the nearer spot first).
function applyChanges(state, dt, claims, finds, k) {
  if (!claims.length && !finds.length) {
    const banner = stepBanner(state.banner, dt, [], k);
    return banner === state.banner && state.events === NO_EVENTS ? state : { ...state, banner, events: NO_EVENTS };
  }
  let { found, claimed, run, outfits } = state;
  const items = [];
  const events = { found: [], claimed: [] };
  for (const spot of claims) {
    const first = !claimed.includes(spot.id);
    const points = claimAward({ tier: spot.tier, firstClaim: first, runClaimSum: run.claimSum }, k);
    if (!found.includes(spot.id)) found = [...found, spot.id];
    if (first) claimed = [...claimed, spot.id];
    run = { ...run, claimed: [...run.claimed, { id: spot.id, points, first }], claimSum: run.claimSum + points };
    events.claimed.push({ id: spot.id, points, first, goal: spot.challenge?.goal ?? null });
    items.push(claimedBanner(spot, points));
  }
  for (const spot of finds) {
    if (found.includes(spot.id)) continue;
    found = [...found, spot.id];
    run = { ...run, found: [...run.found, spot.id] };
    events.found.push(spot.id);
    items.push(foundBanner(spot));
  }
  outfits = Math.max(outfits, outfitsFor(claimed.length, state.claimSpots, k));
  // A Found banner that still waits for a spot that is now Claimed is stale.
  const stale = state.banner.queue.some((b) => b.type === "found" && claims.some((s) => s.id === b.id));
  const banner = stale ? { ...state.banner, queue: state.banner.queue.filter((b) => b.type !== "found" || !claims.some((s) => s.id === b.id)) } : state.banner;
  return { ...state, found, claimed, outfits, run, banner: stepBanner(banner, dt, items, k), events };
}

// One sim tick. `active` is false before the run timer starts and after the
// run ends (the overtime is part of the run): then no spot changes and the
// open attempts are dropped. The banners count down in both cases. The game
// does not call this while the simulation is paused (photo mode).
export function stepLandmarks(state, obs, dt, { active = true } = {}, k = LANDMARKS) {
  if (!active) {
    const idle = state.track === NO_TRACK ? state : { ...state, track: NO_TRACK };
    return applyChanges(idle, dt, [], [], k);
  }
  const [x, , z] = obs.position;
  const open = state.spots.filter((s) => s.challenge && !state.claimed.includes(s.id));
  const done = [];
  const claim = (spot) => {
    if (!done.includes(spot)) done.push(spot);
  };
  let { air, grind, lines, link } = state.track;

  if (obs.teleported || obs.bailed) {
    // A travel step or a bail ends every attempt. The rings stay.
    air = null;
    grind = null;
    lines = {};
    link = null;
  }
  if (!obs.teleported) {
    // Gap: in the air inside the zone, then a landing with no bail (the rule
    // of the gap goals in src/sim/skate/goals.js). A hard gap also needs the
    // landing inside its landing zone.
    if (!obs.bailed) {
      if (obs.airborne) {
        const zones = air ? [...air.zones] : [];
        for (const s of open) if (s.challenge.type === "gap" && !zones.includes(s.id) && inCircle(s.challenge.zone, x, z)) zones.push(s.id);
        air = { time: (air ? air.time : 0) + dt, zones };
      } else if (air && !obs.grind) {
        if (obs.landed && air.time >= k.minAirTime) {
          for (const s of open) if (air.zones.includes(s.id) && (!s.challenge.landing || inCircle(s.challenge.landing, x, z))) claim(s);
        }
        air = null;
      }
    }

    // Grind: one grind on the feature, `meters` or more, that touches the
    // zone. A grind that leaves the zone counts its full length.
    if (obs.grind && !obs.bailed) {
      if (!grind || grind.id !== obs.grind.id) grind = { id: obs.grind.id, from: obs.grind.s, touched: [] };
      const length = Math.abs(obs.grind.s - grind.from);
      for (const s of open) {
        if (s.challenge.type !== "grind" || s.challenge.feature !== grind.id) continue;
        if (!grind.touched.includes(s.id) && inCircle(s.challenge.zone, x, z)) grind = { ...grind, touched: [...grind.touched, s.id] };
        if (grind.touched.includes(s.id) && length >= s.challenge.meters) claim(s);
      }
    } else grind = null;

    // Line: the checkpoints in order within `seconds`. The timer starts at
    // the first checkpoint, and starts again each tick the skater is in it.
    // A late finish drops the attempt.
    if (!obs.bailed) {
      for (const s of open) {
        const c = s.challenge;
        if (c.type !== "line") continue;
        const near = (i) => dist2(c.checkpoints[i][0], c.checkpoints[i][1], x, z) <= c.r;
        let a = lines[s.id] ?? null;
        if (a) {
          a = { ...a, t: a.t + dt };
          if (a.t > c.seconds + 1e-9) a = null;
        }
        if (near(0)) a = { next: 1, t: 0 };
        else if (a && near(a.next)) a = { ...a, next: a.next + 1 };
        if (a && a.next >= c.checkpoints.length) {
          claim(s);
          a = null;
        }
        if (a) lines = { ...lines, [s.id]: a };
        else if (lines[s.id]) {
          lines = { ...lines };
          delete lines[s.id];
        }
      }

      // Combo: the banked value (pending * multiplier) is `points` or more,
      // and the last link was inside the zone. The bank comes about 0.8 s
      // after the last link, so the bank position does not count.
      if (obs.linked) link = [x, z];
      if (obs.banked > 0) {
        if (link) for (const s of open) if (s.challenge.type === "combo" && obs.banked >= s.challenge.points && inCircle(s.challenge.zone, link[0], link[1])) claim(s);
        link = null;
      }
    }
  }

  // Find: after the challenges, so a claim of an Unknown spot shows no Found
  // banner. The nearer spot shows its banner first.
  const finds = state.spots
    .filter((s) => !state.found.includes(s.id) && !done.includes(s))
    .map((s) => ({ s, d: findDistance(s, x, z) }))
    .filter((f) => f.d !== null)
    .sort((a, b) => a.d - b.d)
    .map((f) => f.s);

  const idle = !air && !grind && !link && Object.keys(lines).length === 0;
  const track = idle ? NO_TRACK : { air, grind, lines, link };
  const claims = state.spots.filter((s) => done.includes(s)); // file order
  return applyChanges(state.track === track ? state : { ...state, track }, dt, claims, finds, k);
}

// Sets a spot to Found or Claimed with the normal effects (banner, points,
// run record). For the dev test hook; the game uses stepLandmarks.
export function markSpot(state, id, to, k = LANDMARKS) {
  const spot = state.spots.find((s) => s.id === id);
  if (!spot) return state;
  if (to === "claimed" && spot.challenge && !state.claimed.includes(id)) return applyChanges(state, 0, [spot], [], k);
  if (to === "found" || to === "claimed") return applyChanges(state, 0, [], [spot], k);
  return state;
}

// The observation of one tick from a run (src/sim/skate/run.js, after
// stepRun). `teleported` is true on the tick of a "Travel here" step.
export function landmarkObs(run, { teleported = false } = {}) {
  const s = run.skater;
  return {
    position: s.position,
    airborne: s.state === "air",
    landed: Boolean(s.justLanded),
    bailed: Boolean(s.justFell || s.respawned),
    teleported,
    grind: s.grind ? { id: s.grind.id, s: s.grind.s } : null,
    linked: run.moves.length > 0,
    banked: run.banked,
  };
}

// -------------------------------------------------------------------- save

// The save: { v: 1, levels: { <level>: { found: [ids], claimed: [ids], outfits } } }
// under the key `atl.landmarks`. `outfits` is the most outfits the level
// unlocked, so "Reset progress" can keep them.

const idList = (v) => (Array.isArray(v) ? [...new Set(v.filter((id) => typeof id === "string"))] : []);

function cleanSave(raw, k) {
  const entries = [];
  if (raw && typeof raw === "object" && raw.v === k.saveVersion && raw.levels && typeof raw.levels === "object" && !Array.isArray(raw.levels)) {
    for (const [name, p] of Object.entries(raw.levels)) {
      if (!p || typeof p !== "object") continue;
      entries.push([name, { found: idList(p.found), claimed: idList(p.claimed), outfits: Number.isInteger(p.outfits) && p.outfits > 0 ? p.outfits : 0 }]);
    }
  }
  // Object.fromEntries defines own keys: a level named "__proto__" in a
  // hostile save is a plain entry and never the prototype of `levels`.
  return { v: k.saveVersion, levels: Object.fromEntries(entries) };
}

// Returns { save, ok, foreign }. `ok` is false when the storage is missing
// or throws (a private window, blocked site data): then the progress lasts
// for this page only. `foreign` is true when the stored value is from
// another version; the game reads it as empty.
export function readLandmarkSave(storage, k = LANDMARKS) {
  const empty = { v: k.saveVersion, levels: {} };
  let text;
  try {
    if (!storage) return { save: empty, ok: false, foreign: false };
    text = storage.getItem(k.saveKey);
  } catch {
    return { save: empty, ok: false, foreign: false };
  }
  if (text == null) return { save: empty, ok: true, foreign: false };
  try {
    const raw = JSON.parse(text);
    if (raw && typeof raw === "object" && raw.v === k.saveVersion) return { save: cleanSave(raw, k), ok: true, foreign: false };
  } catch {
    // Not JSON: read as empty.
  }
  return { save: empty, ok: true, foreign: true };
}

export function levelProgress(save, level) {
  return (level != null && Object.hasOwn(save.levels, level) ? save.levels[level] : null) ?? { found: [], claimed: [], outfits: 0 };
}

// The save with the progress of the level of `state`. The other levels stay.
export function withLevelProgress(save, state) {
  return { ...save, levels: { ...save.levels, [state.level]: { found: [...state.found], claimed: [...state.claimed], outfits: state.outfits } } };
}

// Writes the progress of `state`. Returns false when the storage is missing
// or throws.
export function writeLandmarkSave(storage, state, k = LANDMARKS) {
  const read = readLandmarkSave(storage, k);
  if (!read.ok) return false;
  try {
    storage.setItem(k.saveKey, JSON.stringify(withLevelProgress(read.save, state)));
    return true;
  } catch {
    return false;
  }
}

// "Reset progress" for the levels that are not loaded: found and claimed
// clear, the outfits stay. Returns false when the storage is missing or throws.
export function resetLandmarkSave(storage, k = LANDMARKS) {
  const read = readLandmarkSave(storage, k);
  if (!read.ok) return false;
  const levels = Object.fromEntries(Object.entries(read.save.levels).map(([name, p]) => [name, { found: [], claimed: [], outfits: p.outfits }]));
  try {
    storage.setItem(k.saveKey, JSON.stringify({ v: k.saveVersion, levels }));
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------- tracker

// The landmark state of one loaded level, with its save. Not pure: it holds
// the state and writes to `storage` when a spot changes. `tracker.saved` is
// false when the progress does not reach the storage (the settings menu then
// shows "Progress is not saved in this browser.").
export function createLandmarkTracker({ data, level = {}, storage = null, k = LANDMARKS } = {}) {
  const spots = prepareLandmarks(data, level, k);
  const read = readLandmarkSave(storage, k);
  let state = createLandmarks(spots, { level: data.level, progress: levelProgress(read.save, data.level) }, k);
  // Try one write at the start: some browsers read and then refuse to write.
  // A value from another version stays until the first change.
  let saved = read.ok && (read.foreign || writeLandmarkSave(storage, state, k));
  const persist = () => {
    saved = writeLandmarkSave(storage, state, k);
  };
  const changed = () => state.events.found.length > 0 || state.events.claimed.length > 0;
  return {
    get state() {
      return state;
    },
    get saved() {
      return saved;
    },
    view: () => landmarkView(state, k),
    // One sim tick. Returns the events of the tick.
    step(obs, dt, opts) {
      state = stepLandmarks(state, obs, dt, opts, k);
      if (changed()) persist();
      return state.events;
    },
    startRun() {
      state = startLandmarkRun(state);
    },
    mark(id, to) {
      state = markSpot(state, id, to, k);
      if (changed()) persist();
      return spotState(state, id);
    },
    // "Reset progress", after the confirm dialog.
    reset() {
      state = resetLandmarks(state);
      saved = resetLandmarkSave(storage, k) && writeLandmarkSave(storage, state, k);
    },
  };
}

// The test hook for the e2e tests (GDD Open Question 2). The caller puts it
// at window.__atl.landmarks in a dev build only: with `dev` false this
// returns null, so a release build has no way to set a spot.
export function landmarkTestHook(tracker, { dev = false } = {}) {
  if (!dev) return null;
  return {
    states: () => Object.fromEntries(tracker.state.spots.map((s) => [s.id, spotState(tracker.state, s.id)])),
    view: () => tracker.view(),
    banner: () => ({ current: tracker.state.banner.current, waiting: tracker.state.banner.queue.length, dropped: tracker.state.banner.dropped }),
    run: () => tracker.state.run,
    saved: () => tracker.saved,
    find: (id) => tracker.mark(id, "found"),
    claim: (id) => tracker.mark(id, "claimed"),
    reset: () => tracker.reset(),
  };
}
