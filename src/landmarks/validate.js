// The validator of a landmark data file (levels/<level>/landmarks.json). Pure.
//
// Design: design/gdd/landmark-discovery.md (Core Rules 1 and 8, Formulas,
// AC-1, F-4, S-1, S-2, S-3). Issue #216.
//
// validateLandmarks(data, ctx) returns a list of error strings. An empty
// list means the file can ship. `ctx` holds the facts about the level that
// the checks need, so this module reads no file:
//   level        the level (bounds, buildings, areas, strips)
//   grindables   [{ id, total, points: [[x, y, z]] }] from createLevelEnv()
//   goals        the goals of the level (goals.json `goals`), optional
//   permissions  the file names in docs/permissions/, optional

// The tuning values of the GDD that the data must agree with.
export const LANDMARK_RULES = {
  kinds: ["building", "bridge", "park", "skate", "art", "edge"],
  tiers: ["easy", "typical", "hard"],
  types: ["gap", "grind", "line", "combo"],
  shortMax: 90, // characters of the `short` line
  factMax: 160, // characters of one card fact
  cardMin: 3,
  cardMax: 5,
  findEdge: { min: 4, max: 12 }, // m, d_edge
  findR: { min: 10, max: 28 }, // m, r_find
  gapR: { easy: 12, typical: 8, hard: 5 }, // m, k_tier * L_air
  gapLanding: 3, // m, the landing zone of a hard gap
  grindMeters: { easy: 9, typical: 15, hard: 24 }, // v_g (6 m/s) * t_tier
  grindRailShare: 0.8, // of the rail length, the most a challenge asks
  grindHardRailMin: 11, // m, a shorter rail cannot host a hard grind
  grindZoneR: { min: 8, max: 30 },
  lineSpacing: { easy: 40, typical: 30, hard: 35 }, // m between checkpoints
  lineSpacingSlack: 1, // m, a checkpoint may be this far off the spacing
  lineSlack: { easy: 1.8, typical: 1.4, hard: 1.15 },
  lineSpeed: 6, // m/s, v_line
  lineCheckpoints: { min: 2, max: 3 },
  comboPoints: { easy: 600, typical: 1000, hard: 2000 },
  comboR: 10, // m, r_combo
  pavedReach: 1.5, // m past the half width of a strip that still counts as on it
  fenceInset: 3, // m, EDGE_FENCE.inset (src/level/edge-fence.js)
};

// A fact needs a primary source (docs/decisions.md, 2026-11-07): the
// National Register / National Park Service, the National Archives, the
// City of Atlanta, the Atlanta History Center, the Atlanta Preservation
// Center, the New Georgia Encyclopedia, or Atlanta BeltLine, Inc. A spot can
// also cite its own site: it names that host in `site`.
export const PRIMARY_HOSTS = ["nps.gov", "archives.gov", "atlantaga.gov", "atlantahistorycenter.com", "atlantapreservationcenter.com", "georgiaencyclopedia.org", "beltline.org"];

// Pointers only, never a source. A spot cannot name one of them as its site.
export const POINTER_HOSTS = ["wikipedia.org", "wikimedia.org", "wikidata.org", "atlasobscura.com", "historypointer.com", "hmdb.org", "yelp.com", "tripadvisor.com", "facebook.com", "instagram.com", "reddit.com"];

// Words that a fact, a `short` line, or a hint must not hold (AGENTS.md
// political rules, and the research note, section 3). Whole words, any case.
export const BANNED_WORDS = ["crime", "police", "graffiti", "blight", "blighted", "slum", "decline", "declined", "abandoned", "derelict", "gentrification", "displaced", "displacement", "riot", "arson", "murder", "bail"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPoint = (p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);
const isText = (v) => typeof v === "string" && v.trim().length > 0 && v === v.trim();
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function hostOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

// True when `host` is `base` or a subdomain of it.
const under = (host, base) => host === base || host.endsWith(`.${base}`);

export function isPrimarySource(url, site = null) {
  const host = hostOf(url);
  if (!host) return false;
  if (POINTER_HOSTS.some((b) => under(host, b))) return false;
  if (PRIMARY_HOSTS.some((b) => under(host, b))) return true;
  return Boolean(site) && under(host, String(site).toLowerCase());
}

function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = dx * dx + dz * dz;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}

// The distance from a point to a closed outline; 0 inside it.
export function outlineDistance(p, ring) {
  if (pointInRing(p, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) best = Math.min(best, segmentDistance(p, ring[i], ring[(i + 1) % ring.length]));
  return best;
}

// True when a point is on a paved strip that is not a street: a trail, a
// path, or a sidewalk. A point under a street bridge is on the trail below.
export function onPaved(p, level, reach = LANDMARK_RULES.pavedReach) {
  for (const s of level.strips ?? []) {
    if (s.kind === "street") continue;
    const half = (s.width ?? 2) / 2 + reach;
    for (let i = 0; i < s.points.length - 1; i += 1) if (segmentDistance(p, s.points[i], s.points[i + 1]) <= half) return true;
  }
  return false;
}

function inFence(p, level, margin = 0) {
  const b = level.bounds;
  const k = LANDMARK_RULES.fenceInset + margin;
  return p[0] >= b.minX + k && p[0] <= b.maxX - k && p[1] >= b.minZ + k && p[1] <= b.maxZ - k;
}

// The outlines of a spot footprint ({ building } or { areas }), or null.
function footprintRings(fp, level, at, err) {
  if (fp == null) return null;
  if (typeof fp.building === "string") {
    const b = (level.buildings ?? []).find((x) => x.id === fp.building);
    if (!b) return err(`footprint.building "${fp.building}" is not a building of the level`), null;
    return [b.outer];
  }
  if (Array.isArray(fp.areas) && fp.areas.length > 0) {
    const rings = [];
    for (const id of fp.areas) {
      const a = (level.areas ?? []).find((x) => x.id === id);
      if (!a) return err(`footprint.areas "${id}" is not an area of the level`), null;
      rings.push(a.outer);
    }
    return rings;
  }
  err("footprint needs `building` (a level building id) or `areas` (level area ids)");
  return null;
}

function checkText(label, text, max, err) {
  if (!isText(text)) return err(`${label} is missing or has space at an end`);
  if ([...text].length > max) err(`${label} has ${[...text].length} characters (max ${max})`);
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  for (const w of BANNED_WORDS) if (words.includes(w)) err(`${label} has the word "${w}" (political rules)`);
}

function checkZone(label, zone, r, level, err) {
  if (!zone || !isNum(zone.x) || !isNum(zone.z) || !isNum(zone.r)) return err(`${label} needs { x, z, r }`), false;
  if (r != null && zone.r !== r) err(`${label}.r is ${zone.r} (the tier gives ${r})`);
  const p = [zone.x, zone.z];
  if (!inFence(p, level)) err(`${label} center is outside the edge fence`);
  return true;
}

function checkChallenge(spot, ctx, err) {
  const R = LANDMARK_RULES;
  const c = spot.challenge;
  const { level } = ctx;
  if (!c || typeof c !== "object") return err("challenge is missing");
  if (!R.types.includes(c.type)) return err(`challenge.type "${c.type}" is not one of ${R.types.join(", ")}`);
  if (!R.tiers.includes(c.tier)) return err(`challenge.tier "${c.tier}" is not one of ${R.tiers.join(", ")}`);
  checkText("challenge.hint", c.hint, 60, err);

  if (c.type === "gap") {
    if (checkZone("challenge.zone", c.zone, R.gapR[c.tier], level, err) && !onPaved([c.zone.x, c.zone.z], level)) err("challenge.zone center is not on a trail, a path, or a sidewalk");
    if (c.tier === "hard") {
      if (checkZone("challenge.landing", c.landing, R.gapLanding, level, err) && !onPaved([c.landing.x, c.landing.z], level)) err("challenge.landing center is not on a trail, a path, or a sidewalk");
    } else if (c.landing != null) err("challenge.landing is for a hard gap only");
    if (c.goal != null) {
      const g = (ctx.goals ?? []).find((x) => x.id === c.goal);
      if (!g || g.type !== "gap") err(`challenge.goal "${c.goal}" is not a gap goal of the level`);
      else if (c.zone && (g.zone.x !== c.zone.x || g.zone.z !== c.zone.z || g.zone.r !== c.zone.r)) err(`challenge.zone is not the zone of the goal "${c.goal}"`);
    }
  }

  if (c.type === "grind") {
    const ok = checkZone("challenge.zone", c.zone, null, level, err);
    if (ok && (c.zone.r < R.grindZoneR.min || c.zone.r > R.grindZoneR.max)) err(`challenge.zone.r is ${c.zone.r} (range ${R.grindZoneR.min} to ${R.grindZoneR.max})`);
    const g = (ctx.grindables ?? []).find((x) => x.id === c.feature);
    if (!g) return err(`challenge.feature "${c.feature}" is not a grind feature of the level`);
    if (c.tier === "hard" && g.total < R.grindHardRailMin) err(`a hard grind needs a rail of ${R.grindHardRailMin} m or more ("${c.feature}" is ${g.total.toFixed(1)} m)`);
    const meters = Math.min(R.grindMeters[c.tier], Math.floor(R.grindRailShare * g.total * 10) / 10);
    if (c.meters !== meters) err(`challenge.meters is ${c.meters} (the tier and the ${g.total.toFixed(1)} m rail give ${meters})`);
    if (ok && !g.points.some((p) => dist([p[0], p[2]], [c.zone.x, c.zone.z]) <= c.zone.r)) err(`the feature "${c.feature}" does not pass through challenge.zone`);
  }

  if (c.type === "line") {
    const cps = c.checkpoints;
    if (!Array.isArray(cps) || cps.length < R.lineCheckpoints.min || cps.length > R.lineCheckpoints.max || !cps.every(isPoint)) return err(`challenge.checkpoints needs ${R.lineCheckpoints.min} to ${R.lineCheckpoints.max} points [x, z]`);
    const d = R.lineSpacing[c.tier];
    cps.forEach((p, i) => {
      if (!inFence(p, level)) err(`checkpoint ${i + 1} is outside the edge fence`);
      if (!onPaved(p, level)) err(`checkpoint ${i + 1} is not on a trail, a path, or a sidewalk`);
      if (i > 0 && Math.abs(dist(p, cps[i - 1]) - d) > R.lineSpacingSlack) err(`checkpoint ${i + 1} is ${dist(p, cps[i - 1]).toFixed(1)} m from checkpoint ${i} (the tier gives ${d} m)`);
    });
    const seconds = Math.ceil(((cps.length - 1) * d * R.lineSlack[c.tier]) / R.lineSpeed);
    if (c.seconds !== seconds) err(`challenge.seconds is ${c.seconds} (the formula gives ${seconds})`);
  }

  if (c.type === "combo") {
    if (checkZone("challenge.zone", c.zone, R.comboR, level, err) && !onPaved([c.zone.x, c.zone.z], level)) err("challenge.zone center is not on a trail, a path, or a sidewalk");
    if (c.points !== R.comboPoints[c.tier]) err(`challenge.points is ${c.points} (the tier gives ${R.comboPoints[c.tier]})`);
  }
}

function checkCredit(spot, ctx, err) {
  const c = spot.credit;
  if (!c || typeof c !== "object") return err("an art spot needs a `credit`");
  for (const k of ["artist", "title"]) if (!isText(c[k])) err(`credit.${k} is missing`);
  if (!Number.isInteger(c.year)) err("credit.year is missing");
  // Cleared: written permission, and its record is in docs/permissions/.
  if (c.permission !== "written") return err(`credit.permission is "${c.permission}" (an art spot ships only with "written")`);
  if (!isText(c.ref) || !(ctx.permissions ?? []).includes(c.ref)) err(`credit.ref "${c.ref}" is not a file in docs/permissions/`);
}

function checkSpot(spot, ctx, err) {
  const R = LANDMARK_RULES;
  const { level } = ctx;
  if (!R.kinds.includes(spot.kind)) err(`kind "${spot.kind}" is not one of ${R.kinds.join(", ")}`);
  checkText("name", spot.name, 60, err);
  if (!isPoint(spot.at)) return err("`at` needs [x, z]");
  const b = level.bounds;
  if (spot.at[0] < b.minX || spot.at[0] > b.maxX || spot.at[1] < b.minZ || spot.at[1] > b.maxZ) err("`at` is outside the level bounds");

  // The footprint and the find value.
  const rings = footprintRings(spot.footprint, level, spot.at, err);
  if (rings && !rings.some((r) => pointInRing(spot.at, r))) err("`at` is not inside the footprint");
  const f = spot.find;
  if (!f || typeof f !== "object" || (f.edge == null) === (f.r == null)) err("`find` needs `edge` (m to the footprint) or `r` (m to a point), not both");
  else if (f.edge != null) {
    if (!isNum(f.edge) || f.edge < R.findEdge.min || f.edge > R.findEdge.max) err(`find.edge is ${f.edge} (range ${R.findEdge.min} to ${R.findEdge.max})`);
    if (!rings) err("find.edge needs a footprint");
    if (f.at != null) err("find.at goes with find.r only");
    // A player must be able to reach the zone on a paved way.
    if (rings && isNum(f.edge) && !pavedNear(rings, f.edge, level)) err(`no trail, path, or sidewalk comes within find.edge (${f.edge} m) of the footprint`);
  } else {
    if (!isNum(f.r) || f.r < R.findR.min || f.r > R.findR.max) err(`find.r is ${f.r} (range ${R.findR.min} to ${R.findR.max})`);
    if (f.at != null && !isPoint(f.at)) err("find.at needs [x, z]");
    const center = isPoint(f.at) ? f.at : spot.at;
    if (!inFence(center, level)) err("the find point is outside the edge fence");
    if (isNum(f.r) && !pavedWithin(center, f.r, level)) err(`no trail, path, or sidewalk comes within find.r (${f.r} m) of the find point`);
  }

  // The text.
  checkText("short", spot.short, R.shortMax, err);
  if (spot.site != null) {
    if (!isText(spot.site) || POINTER_HOSTS.some((h) => under(spot.site.toLowerCase(), h))) err(`site "${spot.site}" cannot be a source`);
  }
  if (!Array.isArray(spot.card) || spot.card.length < R.cardMin || spot.card.length > R.cardMax) err(`card needs ${R.cardMin} to ${R.cardMax} facts (has ${Array.isArray(spot.card) ? spot.card.length : 0})`);
  const seen = new Set();
  (Array.isArray(spot.card) ? spot.card : []).forEach((fact, i) => {
    const label = `card fact ${i + 1}`;
    checkText(label, fact?.text, R.factMax, err);
    if (seen.has(fact?.text)) err(`${label} repeats another fact`);
    seen.add(fact?.text);
    const s = fact?.source;
    if (!s || !isText(s.name) || !isText(s.url)) return err(`${label} has no source (name and URL)`);
    if (!hostOf(s.url)) return err(`${label} source URL "${s.url}" is not an https URL`);
    if (!isPrimarySource(s.url, spot.site)) err(`${label} source "${hostOf(s.url)}" is not a primary source`);
  });

  // The challenge and the credit.
  if (spot.kind === "edge") {
    if (spot.challenge != null) err("an edge marker has no challenge");
  } else checkChallenge(spot, ctx, err);
  if (spot.kind === "art") checkCredit(spot, ctx, err);
  else if (spot.credit != null) err("`credit` is for an art spot only");
}

// True when a paved strip that is not a street comes within `d` of a point.
function pavedWithin(p, d, level) {
  for (const s of level.strips ?? []) {
    if (s.kind === "street") continue;
    for (let i = 0; i < s.points.length - 1; i += 1) if (segmentDistance(p, s.points[i], s.points[i + 1]) <= d) return true;
  }
  return false;
}

// True when a point of a paved strip is within `d` of one of the outlines.
function pavedNear(rings, d, level) {
  for (const s of level.strips ?? []) {
    if (s.kind === "street") continue;
    for (let i = 0; i < s.points.length - 1; i += 1) {
      const a = s.points[i];
      const b = s.points[i + 1];
      const n = Math.max(1, Math.ceil(dist(a, b) / 2));
      for (let k = 0; k <= n; k += 1) {
        const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        if (rings.some((r) => outlineDistance(p, r) <= d)) return true;
      }
    }
  }
  return false;
}

export function validateLandmarks(data, ctx) {
  const errors = [];
  if (!data || typeof data !== "object") return ["the file is not an object"];
  if (data.v !== 1) errors.push(`v is ${data.v} (this validator reads version 1)`);
  if (data.level !== ctx.level?.name) errors.push(`level is "${data.level}" (the level file says "${ctx.level?.name}")`);
  if (!Array.isArray(data.spots) || data.spots.length === 0) return [...errors, "spots is missing or empty"];
  const ids = new Set();
  const goals = new Set();
  for (const spot of data.spots) {
    const id = spot?.id;
    const err = (m) => errors.push(`${id ?? "(no id)"}: ${m}`);
    if (!isText(id) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) err("id needs lower case words with hyphens");
    if (ids.has(id)) err("id is used twice");
    ids.add(id);
    checkSpot(spot ?? {}, ctx, err);
    const goal = spot?.challenge?.goal;
    if (goal != null) {
      if (goals.has(goal)) err(`the goal "${goal}" is the gap of 2 spots`);
      goals.add(goal);
    }
  }
  return errors;
}

// The counts for the report of the CLI and for the tests.
export function landmarkCounts(data) {
  const spots = data.spots ?? [];
  const claim = spots.filter((s) => s.kind !== "edge");
  const by = (list, key) => list.reduce((o, s) => ({ ...o, [key(s)]: (o[key(s)] ?? 0) + 1 }), {});
  return { spots: spots.length, claim: claim.length, edge: spots.length - claim.length, kinds: by(spots, (s) => s.kind), tiers: by(claim, (s) => s.challenge?.tier), types: by(claim, (s) => s.challenge?.type) };
}
