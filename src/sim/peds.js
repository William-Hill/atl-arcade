// Pedestrians: people out walking on the BeltLine trail, the sidewalks, and
// the street edges, more of them near the storefronts and the landmarks.
// Pure and seeded: no Three.js here. The render is src/render/peds-view.js.
//
// The gen-city approach: a pool of walkers lives around the camera. Each
// walker follows a route (a center line from the level) at an arc length
// `s` and a side offset (positive is on the right of +s), and keeps right.
// A walker that falls out of the pool radius comes back at a spawn point in
// the ring at the pool edge, picked by the density: a base per route kind
// plus a Gaussian bump at each hub (a shop front, a storefront, a
// landmark). Walkers step aside for Nia, the crowd, the street props, and
// each other, stop now and then near a hub (window shopping), and turn
// around at the end of a route. A move that would overlap another walker
// or Nia does not happen, so walkers never overlap. They never change
// Nia's motion.

import { chainStrips, projectOnLine } from "../playtest/trail-script.js";
import { createPath, pathOffsetPoint, pathTangent } from "./npc/path.js";
import { seededRandom } from "./npc/crowd.js";
import { sidewalkLayout, piecePoints } from "../level/geo/curbs.js";
import { createGeoGroundSampler } from "../level/geo/geo-ground.js";
import { EDGE } from "../level/geo/lanes.js";
import { orientRing } from "../level/geo/extrude.js";
import { frontEdges } from "../level/geo/facade-kit.js";
import { shopSignName } from "../level/geo/shop-signs.js";
import { LANDMARKS } from "../level/geo/landmarks.js";
import { propObstacles } from "../level/geo/props.js";
import { createGrid, gridNear, gridOf, gridSet } from "./grid.js";
import { farStride, stepsOnTick, viewerDistance } from "./far-step.js";
import { geoShapes } from "../level/geo/geo-ground.js";
import { ACT, POSE, busStops, cheerIds, groupSize, groupSlot, nearestFreePlace, pedPlaces, pickRole, placePassed, stayTime, stepToward, takesGoal, walkableAt } from "./ped-activity.js";

export const PEDS = {
  radius: 0.3, // m, the circle a walker keeps clear
  speed: [1.0, 1.5], // m/s, the cruise range
  accel: 1.5, // m/s^2
  stride: 1.45, // m per walk cycle (two steps)
  look: 3.5, // m, how far ahead a walker looks for something in its way
  margin: 0.15, // m of extra room when stepping around something
  asideSpeed: 0.7, // m/s, the side step
  giveWay: 7, // m, a walker steps aside when Nia is this close
  niaRadius: 0.45,
  niaMargin: 0.5,
  pauseRate: 0.012, // pauses per s per unit of hub density
  pause: [2, 7], // s, a window-shopping stop
  endPause: [0.5, 2], // s, at the end of a route
  idle: 0.12, // the share of walkers that spawn standing near a hub
  stuck: 3, // s held still before a walker turns around
  jump: 60, // m: a focus move this big (a fast travel) scatters the pool again
  scatterMin: 8, // m from the focus, the nearest scatter spawn
  heightStep: 0.5, // m walked between two ground samples
  sample: 4, // m between two spawn candidates on a route
  cell: 32, // m, the spawn candidate grid
  near: 4, // m, the cell of the walker grid for the neighbor search (#189)
  // Far-step (#189): a walker this far (m) from the camera and from Nia
  // steps every `stride` ticks (src/sim/far-step.js). Inside the first band
  // (give way, the crowd, the props) it steps on every tick.
  far: [
    [40, 2],
    [80, 4],
    [130, 6],
  ],
};

// The pool size and the pool radius (m) by quality tier. The fog hides the
// pool edge (fogNear in src/render/quality.js). With the grid and the
// far-step (#189), 120 walkers take about 0.3 ms per step in Node (npm run
// perf:sim) and 0.5 to 0.6 ms in the browser; 320 take about 0.65 ms in Node.
// `?peds=<n>` sets another count. The counts were 70, 50 and 120 until
// 2026-11-07: the owner saw too many people, and the trail read as a queue
// (docs/decisions.md).
export const PED_COUNT = { low: 60, phone: 45, high: 90 };

// Pure: the walker count for a tier and the `peds` URL value. "0" turns the
// walkers off (0). A positive whole number sets the count, up to 400.
export function pedCount(quality, param) {
  const tier = PED_COUNT[quality] ?? PED_COUNT.low;
  if (param == null || param === "") return tier;
  const n = Number(param);
  if (!Number.isFinite(n)) return tier;
  return Math.max(0, Math.min(400, Math.round(n)));
}
export const PED_RADIUS = { low: 150, phone: 140, high: 200 };

// The density of each route kind (walkers per m of route, relative), and
// the peak of a hub bump. A hub bump has the Gaussian width `sigma` (m).
export const DENSITY = { trail: 1, sidewalk: 0.3, edge: 0.1 };
export const HUBS = { landmark: 4, shop: 3, storefront: 1.2, park: 2, bus: 1.5, sigma: 30, landmarkStep: 25 };
// The parks with more people (#133): a hub each HUBS.landmarkStep m of the
// park outline.
export const HUB_PARKS = ["Historic Fourth Ward Park"];

// The route lanes: the keep-right offset (m from the route center line)
// and the room (the largest offset a walker may step out to).
const LANES = {
  trail: (w) => ({ lane: w / 2 - 0.45, room: w / 2 + 0.5 }), // the trail edge, and the shoulder
  sidewalk: (w) => ({ lane: Math.min(0.5, w / 2 - PEDS.radius), room: w / 2 - PEDS.radius + 0.05 }),
  edge: () => ({ lane: 0.4, room: 0.8 }),
};
// The street edge walk: this far past the street side (m). A run of edge
// shorter than `minRun` is left out.
export const EDGE_WALK = { out: 1.1, step: 2, minRun: 24 };

const ROUTES = new WeakMap();

function centroid(ring) {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

// The density hubs: { kind, x, z, w }. A storefront or a shop gets one hub
// at the middle of its front wall (frontEdges() in facade-kit.js), and a
// landmark building gets hubs every HUBS.landmarkStep m along its outline.
export function pedHubs(level, fronts = frontEdges(level)) {
  const hubs = [];
  const parks = new Set(HUB_PARKS);
  for (const a of level.areas ?? []) {
    if (a.kind !== "park" || !parks.has(a.name) || !(a.outer?.length >= 3)) continue;
    let acc = 0;
    for (let i = 0; i < a.outer.length; i += 1) {
      const p = a.outer[i];
      const q = a.outer[(i + 1) % a.outer.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      for (let t = HUBS.landmarkStep - acc; t < len; t += HUBS.landmarkStep) hubs.push({ kind: "park", x: p[0] + ((q[0] - p[0]) * t) / len, z: p[1] + ((q[1] - p[1]) * t) / len, w: HUBS.park });
      acc = (acc + len) % HUBS.landmarkStep;
    }
  }
  const landmarkNames = new Set(LANDMARKS.map((l) => l.buildingName));
  for (const b of level.buildings ?? []) {
    if (!(b.outer?.length >= 3)) continue;
    if (landmarkNames.has(b.name)) {
      const ring = b.outer;
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const c = ring[(i + 1) % ring.length];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const n = Math.max(1, Math.round(len / HUBS.landmarkStep));
        for (let k = 0; k < n; k += 1) {
          const t = (k + 0.5) / n;
          hubs.push({ kind: "landmark", x: a[0] + (c[0] - a[0]) * t, z: a[1] + (c[1] - a[1]) * t, w: HUBS.landmark });
        }
      }
      continue;
    }
    const shop = Boolean(shopSignName(b.use));
    const front = fronts.get(b.id);
    if (!shop && !front) continue;
    let at = centroid(b.outer);
    if (front && Number.isInteger(front.edge)) {
      const ring = orientRing(b.outer, false);
      const a = ring[front.edge];
      const c = ring[(front.edge + 1) % ring.length];
      if (a && c) at = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    }
    hubs.push({ kind: shop ? "shop" : "storefront", x: at[0], z: at[1], w: shop ? HUBS.shop : HUBS.storefront });
  }
  return hubs;
}

function hubGrid(hubs, cell) {
  const grid = new Map();
  for (const h of hubs) {
    const k = `${Math.floor(h.x / cell)},${Math.floor(h.z / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(h);
  }
  return grid;
}

// The hub density at (x, z): the sum of the hub bumps.
export function hubDensity(routes, x, z) {
  const { grid, cell } = routes.hubIndex;
  const s2 = 2 * HUBS.sigma * HUBS.sigma;
  const reach = Math.ceil((3 * HUBS.sigma) / cell);
  const ix = Math.floor(x / cell);
  const iz = Math.floor(z / cell);
  let sum = 0;
  for (let a = ix - reach; a <= ix + reach; a += 1) {
    for (let b = iz - reach; b <= iz + reach; b += 1) {
      for (const h of grid.get(`${a},${b}`) ?? []) {
        const d2 = (h.x - x) ** 2 + (h.z - z) ** 2;
        if (d2 < 9 * HUBS.sigma * HUBS.sigma) sum += h.w * Math.exp(-d2 / s2);
      }
    }
  }
  return sum;
}

// The street edge walks: for each main or residential street with no
// sidewalk on a side, the line EDGE_WALK.out m past that side, cut where
// it is not on open ground (a building, a street, a sidewalk, a path).
export function edgeWalks(level, sample = createGeoGroundSampler(level)) {
  const open = new Set(["ground", ...(level.areas ?? []).filter((a) => a.kind === "park").map((a) => a.id)]);
  const out = [];
  for (const s of level.strips ?? []) {
    if (s.kind !== "street" || s.bridge || !EDGE.has(s.highway) || s.points.length < 2) continue;
    const path = createPath(s.points);
    const n = Math.floor(path.length / EDGE_WALK.step);
    if (n < 2) continue;
    for (const side of [-1, 1]) {
      const off = side * (s.width / 2 + EDGE_WALK.out);
      let run = [];
      const flush = () => {
        if (run.length >= 2 && (run.length - 1) * (path.length / n) >= EDGE_WALK.minRun) out.push({ id: `${s.id}:${side > 0 ? "r" : "l"}${out.length}`, points: run });
        run = [];
      };
      for (let k = 0; k <= n; k += 1) {
        const p = pathOffsetPoint(path, (k / n) * path.length, off);
        const id = sample(p[0], p[1])?.id;
        if (open.has(id)) run.push(p);
        else flush();
      }
      flush();
    }
  }
  return out;
}

function routeOf(kind, points, width, stripIds, height) {
  const path = createPath(points);
  return { kind, path, ...LANES[kind](width), stripIds, height, bridges: [] };
}

// The spans of a trail route ([s0, s1]) with no shoulder: each bridge (2 m
// past each end), so a walker who steps aside stays on the deck, and each
// place where the shoulder is not walkable (a street that the trail
// crosses), 2 m each way.
function bridgeSpans(route, strips, walkable) {
  for (const b of strips) {
    if (!b.bridge || b.points.length < 2) continue;
    const ends = [b.points[0], b.points[b.points.length - 1]].map(([x, z]) => projectOnLine(route.path.points, x, z));
    if (ends.some((e) => e.d > 3)) continue;
    route.bridges.push([Math.min(ends[0].s, ends[1].s) - 2, Math.max(ends[0].s, ends[1].s) + 2]);
  }
  const spans = [];
  for (let s = 0; s <= route.path.length; s += WALK_CHECK) {
    const off = [-route.room, route.room].some((o) => {
      const [x, z] = pathOffsetPoint(route.path, s, o);
      return !walkable(x, z);
    });
    if (!off) continue;
    const last = spans[spans.length - 1];
    if (last && last[1] >= s - 2) last[1] = s + 2;
    else spans.push([s - 2, s + 2]);
  }
  route.bridges.push(...spans);
  // The deck room: the trail edge less a walker radius.
  route.deckRoom = route.lane + 0.45 - PEDS.radius;
}

// Pure: the room (the largest offset) of `route` at arc length `s`.
export function roomAt(route, s) {
  for (const [a, b] of route.bridges) if (s >= a && s <= b) return route.deckRoom;
  return route.room;
}

// The routes of a level, its hubs, and the spawn candidates. One build per
// level object. `fronts` is the Map of frontEdges() (tests can pass one).
export function pedRoutes(level, { fronts } = {}) {
  if (ROUTES.has(level)) return ROUTES.get(level);
  const strips = level.strips ?? [];
  const surf = level.surfaces ?? {};
  const routes = [];
  const built = {};
  const trailIds = new Set(strips.filter((s) => s.kind === "trail").map((s) => s.id));
  const trailW = strips.find((s) => s.kind === "trail")?.width ?? 4.3;
  const ground = createGeoGroundSampler(level);
  const kindOf = new Map(geoShapes(level).map((g) => [g.id, g.kind]));
  const walkable = walkableAt(ground, kindOf);
  for (const line of chainStrips(strips, "trail")) {
    const r = routeOf("trail", line, trailW, trailIds, surf.trail ?? 0);
    if (r.path.length > 30) {
      bridgeSpans(r, strips.filter((s) => s.kind === "trail"), walkable);
      routes.push(r);
    }
  }
  // The sidewalks less the parts on a street (curbs.js cuts), chained over
  // the strip joints. A bridge sidewalk is whole.
  const layout = sidewalkLayout(level);
  const pieces = [];
  for (const s of strips) {
    if (s.kind !== "sidewalk") continue;
    const L = createPath(s.points).length;
    const cuts = (layout.get(s.id)?.cuts ?? []).slice().sort((a, b) => a[0] - b[0]);
    let at = 0;
    for (const [a, b] of [...cuts, [L, L]]) {
      if (a - at > 1) pieces.push({ kind: "sidewalk", id: s.id, points: piecePoints(s.points, [at, a]) });
      at = Math.max(at, b);
    }
  }
  const walkIds = new Set(strips.filter((s) => s.kind === "sidewalk").map((s) => s.id));
  const walkW = Math.min(2, ...strips.filter((s) => s.kind === "sidewalk").map((s) => s.width));
  // A sidewalk or an edge walk is checked piece by piece the first time a
  // walker comes there (routeOpen()): a walker turns around where the walk
  // room is not walkable (#133).
  for (const line of chainStrips(pieces, "sidewalk")) {
    const r = routeOf("sidewalk", line, walkW, walkIds, surf.sidewalk ?? 0);
    if (r.path.length > 12) routes.push(r);
  }
  for (const e of edgeWalks(level, ground)) routes.push(routeOf("edge", e.points, 0, new Set(), surf.ground ?? 0));
  for (const r of routes) if (r.kind !== "trail") r.open = new Uint8Array(Math.ceil(r.path.length / OPEN_CHUNK) + 1);
  built.walkable = walkable;

  const hubs = pedHubs(level, fronts ?? frontEdges(level));
  Object.assign(built, { routes, hubs });
  // The bus stops on the sidewalks of the main streets, each a hub.
  const highway = new Map(strips.filter((s) => s.kind === "street").map((s) => [s.id, s.highway]));
  const streets = createGeoGroundSampler({ ...level, buildings: [], areas: [], strips: strips.filter((s) => s.kind === "street") });
  built.candidates = { grid: candidateGrid(routes, () => 0) };
  built.stops = busStops(built, (x, z) => highway.get(streets(x, z)?.id) ?? null).filter((st) => routeOpen(built, routes[st.route], st.s));
  for (const st of built.stops) hubs.push({ kind: "bus", x: st.x, z: st.z, w: HUBS.bus });
  built.hubIndex = { grid: hubGrid(hubs, HUBS.sigma), cell: HUBS.sigma };
  // The spawn candidates: a point every PEDS.sample m of each route, with
  // its density weight.
  const points = [];
  const grid = candidateGrid(routes, (x, z) => hubDensity(built, x, z), points);
  built.candidates = { points, grid };
  ROUTES.set(level, built);
  return built;
}

// The walk room of a sidewalk or an edge walk, checked in pieces of
// OPEN_CHUNK m (each 1 m: the center and both room edges, WALK_MARGIN m
// wider for a corner between two checks). A piece on a street, a junction,
// a building corner, or off the level is closed. Each piece is checked
// once, on first use, and kept on the route (it depends only on the level).
const OPEN_CHUNK = 4;
const WALK_CHECK = 1;
const WALK_MARGIN = 0.15;
export function routeOpen(built, route, s) {
  if (!route.open) return true;
  const i = Math.max(0, Math.min(route.open.length - 1, Math.floor(s / OPEN_CHUNK)));
  if (route.open[i] === 0) {
    let ok = true;
    for (let at = i * OPEN_CHUNK; ok && at <= (i + 1) * OPEN_CHUNK; at += WALK_CHECK) {
      const t = Math.min(at, route.path.length);
      for (const o of [-route.room - WALK_MARGIN, 0, route.room + WALK_MARGIN]) {
        const [x, z] = pathOffsetPoint(route.path, t, o);
        if (!built.walkable(x, z)) {
          ok = false;
          break;
        }
      }
    }
    route.open[i] = ok ? 1 : 2;
  }
  return route.open[i] === 1;
}

function candidateGrid(routes, hubAt, points = []) {
  const grid = new Map();
  routes.forEach((r, ri) => {
    for (let s = 1; s < r.path.length - 1; s += PEDS.sample) {
      const [x, z] = pathOffsetPoint(r.path, s, 0);
      const hub = hubAt(x, z);
      const p = { route: ri, s, x, z, hub, w: DENSITY[r.kind] * (1 + hub) };
      const k = `${Math.floor(x / PEDS.cell)},${Math.floor(z / PEDS.cell)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(p);
      points.push(p);
    }
  });
  return grid;
}

// The spawn candidates between rMin and rMax m of (fx, fz), with the
// running sum of their weights, for a weighted pick.
function candidatesIn(routes, fx, fz, rMin, rMax) {
  const { grid } = routes.candidates;
  const list = [];
  const cum = [];
  let total = 0;
  const c = PEDS.cell;
  for (let a = Math.floor((fx - rMax) / c); a <= Math.floor((fx + rMax) / c); a += 1) {
    for (let b = Math.floor((fz - rMax) / c); b <= Math.floor((fz + rMax) / c); b += 1) {
      for (const p of grid.get(`${a},${b}`) ?? []) {
        const d = Math.hypot(p.x - fx, p.z - fz);
        if (d < rMin || d > rMax) continue;
        total += p.w;
        list.push(p);
        cum.push(total);
      }
    }
  }
  return { list, cum, total };
}

function pick(set, u) {
  const target = u * set.total;
  let lo = 0;
  let hi = set.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (set.cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return set.list[lo];
}

const lerp = (r, [a, b]) => a + r * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function placePed(state, p) {
  const r = state.routes[p.route];
  const [x, z] = pathOffsetPoint(r.path, p.s, p.offset);
  const [tx, tz] = pathTangent(r.path, p.s);
  p.x = x;
  p.z = z;
  p.fx = tx * p.dir;
  p.fz = tz * p.dir;
  gridSet(state.grid, p, x, z);
}

function sampleHeight(state, p) {
  const r = state.routes[p.route];
  p.y = state.heightAt(p.x, p.z, p.ySampled ? p.y : undefined, r);
  p.ySampled = p.s;
  p.hub = hubDensity(state.built, p.x, p.z);
}

function overlapsPed(state, self, x, z) {
  const rr = 2 * PEDS.radius;
  return gridNear(state.grid, x, z, rr, (o) => {
    if (o === self || !o.live) return false;
    const dx = o.x - x;
    const dz = o.z - z;
    return dx * dx + dz * dz < rr * rr;
  });
}

// The others (the crowd, the NPC skaters) and Nia as circles: { x, z, r },
// in a grid (8 m cells). `maxR` is the largest circle.
export function moverGrid(others, nia) {
  const list = others.map((o) => ({ x: o.x, z: o.z, r: o.radius ?? o.r ?? 0.4, nia: false }));
  if (nia) list.push({ x: nia[0], z: nia[2], r: PEDS.niaRadius, nia: true });
  const grid = gridOf(list, 8);
  grid.maxR = list.reduce((m, o) => Math.max(m, o.r), 0);
  return grid;
}

// True when a walker at (x, z) would touch one of the movers. With `from`
// ([x, z], the walker now), only a move that also gets closer counts, so
// a mover that walks into a walker never traps it.
function touchesMover(grid, x, z, from = null) {
  return gridNear(grid, x, z, PEDS.radius + grid.maxR, (o) => {
    const d = Math.hypot(o.x - x, o.z - z);
    if (d >= PEDS.radius + o.r) return false;
    return !from || d < Math.hypot(o.x - from[0], o.z - from[1]);
  });
}

// The walker that `p` is bound to (a group leader, a talk partner), or
// null when that walker has gone (it respawned since).
function boundTo(state, id, spawns) {
  const o = id >= 0 ? state.peds[id] : null;
  return o && o.live && o.spawns === spawns ? o : null;
}

// Frees what walker `p` holds (a place) and drops its group and talk, before
// it spawns again.
function release(state, p) {
  if (p.goal) p.goal.user = -1;
  p.goal = null;
  p.leg = null;
  const lead = boundTo(state, p.lead, p.leadSpawns);
  if (lead) lead.members = Math.max(0, lead.members - 1);
  p.lead = -1;
  p.members = 0;
  p.want = 0;
  p.talk = 0;
  p.with = -1;
  p.cheer = 0;
}

function leaveGroup(state, p) {
  const lead = boundTo(state, p.lead, p.leadSpawns);
  if (lead) lead.members = Math.max(0, lead.members - 1);
  p.lead = -1;
  p.role = "walk";
}

// A new walker joins a leader that spawned in the last ACT.recruit s and
// still wants members (a group or a talk). Returns true when it did.
function joinRecruiter(state, p) {
  while (state.recruit.length) {
    const e = state.recruit[0];
    const r = boundTo(state, e.id, e.spawns);
    if (!r || r.want <= 0 || state.time > e.until) {
      state.recruit.shift();
      continue;
    }
    const route = state.routes[r.route];
    const slot =
      r.role === "chat"
        ? { s: r.s + r.dir * ACT.chatGap, offset: r.offset }
        : groupSlot(r, r.members + 1, r.side, roomAt(route, r.s));
    p.route = r.route;
    p.s = clamp(slot.s, 1, route.path.length - 1);
    p.offset = slot.offset;
    p.dir = r.dir;
    placePed(state, p);
    // One try for each new walker: a slot with no room ends the recruit.
    state.recruit.shift();
    if (!routeOpen(state.built, route, p.s) || overlapsPed(state, p, p.x, p.z) || touchesMover(state.movers, p.x, p.z)) return false;
    r.want -= 1;
    if (r.want > 0) state.recruit.unshift(e);
    p.cruise = r.cruise;
    p.role = r.role === "chat" ? "chat" : "member";
    if (r.role === "chat") {
      // The two face each other and talk for the same time.
      p.talk = r.talk;
      p.with = r.id;
      p.withSpawns = r.spawns;
      r.with = p.id;
      r.withSpawns = p.spawns + 1;
    } else {
      p.lead = r.id;
      p.leadSpawns = r.spawns;
      p.k = r.members + 1;
      r.members += 1;
    }
    return true;
  }
  return false;
}

// Puts walker `p` at a free place near the spawn candidate `c`, in its
// stay. It walks back to the anchor of the place on its route after.
function startAtPlace(state, p, c) {
  const pl = nearestFreePlace(state.places, c.x, c.z, ACT.placeNear, (q) => routeOpen(state.built, state.routes[q.route], q.s));
  if (!pl || overlapsPed(state, p, pl.x, pl.z) || touchesMover(state.movers, pl.x, pl.z)) return;
  const r = state.routes[pl.route];
  p.route = pl.route;
  p.s = pl.s;
  p.offset = p.dir * r.lane;
  p.x = pl.x;
  p.z = pl.z;
  p.fx = pl.fx;
  p.fz = pl.fz;
  gridSet(state.grid, p, p.x, p.z);
  p.y = state.heightAt(p.x, p.z, undefined, r);
  pl.user = p.id;
  p.goal = pl;
  p.leg = "stay";
  p.home = { s: pl.s, offset: p.offset };
  p.stay = stayTime(state.rand(), pl.kind) * (0.3 + 0.7 * state.rand());
  p.pose = pl.kind === "bench" ? POSE.sit : POSE.walk;
  p.pause = 0;
}

// Puts walker `p` at a weighted spawn point between rMin and rMax m of the
// focus, clear of the other walkers, the crowd, the NPC skaters and Nia.
// Returns false when there is no room.
function spawn(state, p, rMin, rMax) {
  const rand = state.rand;
  release(state, p);
  p.role = "walk";
  p.pose = POSE.walk;
  p.strideLen = PEDS.stride;
  const fresh = () => {
    p.live = true;
    p.speed = 0;
    p.phase = rand() * Math.PI * 2;
    p.look = Math.floor(rand() * 2 ** 31);
    p.stuck = 0;
    p.ySampled = 0;
    p.met = -1;
    sampleHeight(state, p);
  };
  if (joinRecruiter(state, p)) {
    fresh();
    p.pause = 0;
    p.speed = p.talk > 0 ? 0 : p.cruise;
    p.spawns += 1;
    return true;
  }
  const [fx, fz] = state.focus;
  const key = `${Math.round(fx / 8)},${Math.round(fz / 8)},${rMin},${rMax}`;
  if (state.spawnCache.key !== key) state.spawnCache = { key, set: candidatesIn(state.built, fx, fz, rMin, rMax) };
  const set = state.spawnCache.set;
  if (!set.list.length) return false;
  for (let tries = 0; tries < 8; tries += 1) {
    const c = pick(set, rand());
    const r = state.routes[c.route];
    p.route = c.route;
    p.s = clamp(c.s + (rand() - 0.5) * PEDS.sample, 1, r.path.length - 1);
    p.dir = rand() < 0.5 ? 1 : -1;
    p.offset = p.dir * r.lane + (rand() - 0.5) * 0.2;
    placePed(state, p);
    if (routeOpen(state.built, r, p.s) && !overlapsPed(state, p, p.x, p.z) && !touchesMover(state.movers, p.x, p.z)) {
      p.cruise = lerp(rand(), PEDS.speed);
      fresh();
      p.pause = rand() < PEDS.idle * Math.min(1, c.hub) ? lerp(rand(), PEDS.pause) * 1.5 : 0;
      // The role (ped-activity.js): a jog, a group leader, a talk, or a walk.
      p.role = pickRole(rand(), r.kind, c.hub);
      if (p.role === "jog") {
        p.cruise = lerp(rand(), ACT.jogSpeed);
        p.strideLen = ACT.jogStride;
        p.pause = 0;
      } else if (p.role === "group") {
        p.want = groupSize(rand()) - 1;
        // Beside the leader, on the side with the most room.
        p.side = p.offset >= 0 ? -1 : 1;
        p.pause = 0;
      } else if (p.role === "chat") {
        p.want = 1;
        p.talk = lerp(rand(), ACT.chat);
        p.pause = 0;
      }
      if (p.want > 0) state.recruit.push({ id: p.id, spawns: p.spawns + 1, until: state.time + ACT.recruit });
      // Some walkers start at a place near the spawn point: on a bench, at a
      // bus stop, at a shop door, part way into the stay.
      if (p.role === "walk" && rand() < ACT.placeSpawn) startAtPlace(state, p, c);
      p.speed = p.pause > 0 || p.talk > 0 || p.goal ? 0 : p.cruise;
      p.spawns += 1;
      return true;
    }
  }
  return false;
}

function propIndex(obstacles) {
  const grid = new Map();
  for (const o of obstacles) {
    const k = `${Math.floor(o.c[0] / 8)},${Math.floor(o.c[1] / 8)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ x: o.c[0], z: o.c[1], r: o.r });
  }
  return grid;
}

// A seeded pool of walkers around `focus` ([x, z]). `heightAt(x, z, y,
// route)` gives the ground height (y is the last height, or undefined for a
// new walker; route.stripIds are the strips of the route); the default is
// the flat surface height of the route kind. `props` are the street props
// (the level env props), as obstacles; their benches are places to sit.
export function createPeds(level, { seed = 1, count = PED_COUNT.low, radius = PED_RADIUS.low, focus = null, heightAt = null, props = [], fronts } = {}) {
  const built = pedRoutes(level, { fronts });
  const at = focus ?? [level.spawn.position[0], level.spawn.position[2]];
  const state = {
    built,
    routes: built.routes,
    // The places (ped-activity.js): the bench seats, the bus stops, and the
    // shop doors. Each state has its own copy (a place holds its user).
    places: pedPlaces(built, { walkable: built.walkable, props, stops: built.stops, hubs: built.hubs }),
    rand: seededRandom(seed),
    radius,
    focus: [at[0], at[1]],
    heightAt: heightAt ?? ((x, z, y, r) => r.height),
    props: propIndex(propObstacles(props.filter((p) => !p.roof))),
    spawnCache: { key: null, set: null },
    movers: moverGrid([], null),
    grid: createGrid(PEDS.near),
    recruit: [],
    peds: [],
    time: 0,
    tick: 0,
    cheers: 0,
  };
  for (let i = 0; i < count; i += 1) state.peds.push({ id: i, live: false, x: Infinity, z: Infinity, y: 0, spawns: 0, offset: 0, dir: 1, s: 0, speed: 0, phase: 0, pause: 0, fx: 1, fz: 0, role: "walk", pose: POSE.walk, strideLen: PEDS.stride, lead: -1, leadSpawns: 0, members: 0, want: 0, side: 1, k: 0, talk: 0, with: -1, withSpawns: 0, goal: null, leg: null, stay: 0, home: null, cheer: 0, met: -1 });
  scatter(state);
  return state;
}

function scatter(state) {
  for (const p of state.peds) {
    release(state, p);
    p.live = false;
  }
  state.recruit = [];
  // Not right at the camera, so no walker pops up in its face.
  for (const p of state.peds) spawn(state, p, PEDS.scatterMin, state.radius);
}

// The things a walker steps around near (x, z): the other walkers, the
// street props, Nia, and the others (the crowd, the NPC skaters, in
// state.movers).
function forEachNear(state, p, nia, fn) {
  const reach = PEDS.look + 1;
  gridNear(state.grid, p.x, p.z, reach, (o) => {
    if (o === p || !o.live) return;
    if (Math.abs(o.x - p.x) > reach || Math.abs(o.z - p.z) > reach) return;
    fn(o.x, o.z, PEDS.radius, o);
  });
  const ix = Math.floor(p.x / 8);
  const iz = Math.floor(p.z / 8);
  for (let a = ix - 1; a <= ix + 1; a += 1) for (let b = iz - 1; b <= iz + 1; b += 1) for (const o of state.props.get(`${a},${b}`) ?? []) fn(o.x, o.z, o.r, null);
  gridNear(state.movers, p.x, p.z, reach + 3, (o) => {
    if (!o.nia && Math.abs(o.x - p.x) <= reach + 3 && Math.abs(o.z - p.z) <= reach + 3) fn(o.x, o.z, o.r, null);
  });
  if (nia) fn(nia[0], nia[2], PEDS.niaRadius + PEDS.niaMargin, "nia");
}

function startTalk(a, b, t) {
  a.talk = t;
  a.with = b.id;
  a.withSpawns = b.spawns;
  a.speed = 0;
  a.pose = POSE.talk;
  face(a, b.x, b.z);
}

function face(p, x, z) {
  const dx = x - p.x;
  const dz = z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > 1e-3) {
    p.fx = dx / d;
    p.fz = dz / d;
  }
}

// A move off the route (to a place and back): to (x, z) if the walker
// overlaps no one there. Returns true when it moved.
function moveFree(state, p, x, z) {
  if (overlapsPed(state, p, x, z) || touchesMover(state.movers, x, z, [p.x, p.z])) return false;
  const d = Math.hypot(x - p.x, z - p.z);
  face(p, x, z);
  p.x = x;
  p.z = z;
  p.phase = (p.phase + (d / PEDS.stride) * Math.PI * 2) % (Math.PI * 200);
  gridSet(state.grid, p, x, z);
  p.walked = (p.walked ?? 0) + d;
  if (p.walked >= PEDS.heightStep) {
    p.walked = 0;
    p.y = state.heightAt(p.x, p.z, p.y, state.routes[p.route]);
  }
  return true;
}

// A walker with a goal: to the place, a stay, and back to its route spot.
function stepGoal(state, p, dt) {
  const g = p.goal;
  const route = state.routes[p.route];
  if (p.leg === "stay") {
    p.speed = 0;
    p.fx = g.fx;
    p.fz = g.fz;
    p.pose = g.kind === "bench" ? POSE.sit : POSE.walk;
    p.stay -= dt;
    if (p.stay <= 0) p.leg = "back";
    return;
  }
  p.pose = POSE.walk;
  const back = p.leg === "back";
  const [tx, tz] = back ? pathOffsetPoint(route.path, p.home.s, p.home.offset) : [g.x, g.z];
  const speed = p.cruise * ACT.goalSpeed;
  const [nx, nz, arrived] = stepToward(p.x, p.z, tx, tz, speed, dt);
  if (!moveFree(state, p, nx, nz)) {
    p.speed = 0;
    p.stuck += dt;
    // Blocked on the way: give the place up and go back.
    if (!back && p.stuck > PEDS.stuck) {
      p.leg = "back";
      p.stuck = 0;
    }
    return;
  }
  p.speed = speed;
  p.stuck = 0;
  if (!arrived) return;
  if (!back) {
    p.leg = "stay";
    p.stay = stayTime(state.rand(), g.kind);
    p.speed = 0;
    p.fx = g.fx;
    p.fz = g.fz;
    p.pose = g.kind === "bench" ? POSE.sit : POSE.walk;
    return;
  }
  // Back on the route: walk on.
  g.user = -1;
  p.goal = null;
  p.leg = null;
  p.s = p.home.s;
  p.offset = p.home.offset;
  placePed(state, p);
  p.speed = 0;
}

// The nearest street prop ahead of a walker that its circle would touch on
// its line, as the side step (in the route offset frame) that clears it and
// the distance ahead; null when no prop is in the way.
const propWay = { fwd: 0, need: 0, target: 0 };
function propAhead(state, p) {
  const rx = -p.fz;
  const rz = p.fx;
  const ix = Math.floor(p.x / 8);
  const iz = Math.floor(p.z / 8);
  let nearest = Infinity;
  for (let a = ix - 1; a <= ix + 1; a += 1) {
    for (let b = iz - 1; b <= iz + 1; b += 1) {
      for (const o of state.props.get(`${a},${b}`) ?? []) {
        const dx = o.x - p.x;
        const dz = o.z - p.z;
        const fwd = dx * p.fx + dz * p.fz;
        const lat = dx * rx + dz * rz;
        const need = PEDS.radius + o.r + PEDS.margin;
        if (fwd < -need * 0.5 || fwd > PEDS.look || Math.abs(lat) >= need || fwd >= nearest) continue;
        nearest = fwd;
        const side = lat > 0 ? -1 : lat < 0 ? 1 : -p.dir;
        propWay.fwd = fwd;
        propWay.need = need;
        propWay.target = p.offset + p.dir * side * (need - Math.abs(lat) + 0.05);
      }
    }
  }
  return nearest < Infinity ? propWay : null;
}

// True when a walker at (x, z) would overlap a street prop that it does not
// overlap at (fx, fz) already, or overlap it more (so a walker that is in a
// prop can still walk out).
function hitsProp(state, x, z, fx, fz) {
  const ix = Math.floor(x / 8);
  const iz = Math.floor(z / 8);
  for (let a = ix - 1; a <= ix + 1; a += 1) {
    for (let b = iz - 1; b <= iz + 1; b += 1) {
      for (const o of state.props.get(`${a},${b}`) ?? []) {
        const need = PEDS.radius + o.r;
        const d2 = (o.x - x) ** 2 + (o.z - z) ** 2;
        if (d2 < need * need && d2 < (o.x - fx) ** 2 + (o.z - fz) ** 2) return true;
      }
    }
  }
  return false;
}

// A group member: it keeps its slot beside or behind the leader. A street
// prop in the way moves it out of its slot (it steps around the prop as a
// walker does); a member held still too long leaves the group.
function stepMember(state, p, lead, dt) {
  const route = state.routes[p.route];
  p.dir = lead.dir;
  if (lead.pause > 0 || lead.talk > 0 || lead.speed < 0.05) {
    p.speed = Math.max(0, p.speed - PEDS.accel * dt);
    if (p.speed === 0) {
      p.fx = lead.fx;
      p.fz = lead.fz;
    }
    p.pose = POSE.walk;
    return;
  }
  const room = roomAt(route, p.s);
  const slot = groupSlot(lead, p.k, lead.side, room);
  const ds = (slot.s - p.s) * lead.dir;
  if (Math.abs(ds) + Math.abs(slot.offset - p.offset) > ACT.groupLeave) {
    leaveGroup(state, p);
    return;
  }
  let want = clamp(lead.speed + ds * 1.2, 0, p.cruise * 1.4);
  let target = slot.offset;
  const prop = propAhead(state, p);
  if (prop) {
    target = prop.target;
    const k = clamp((prop.fwd - prop.need * 0.6) / PEDS.look, 0, 1);
    want = Math.min(want, p.cruise * (prop.fwd < prop.need * 0.6 ? 0 : 0.35 + 0.65 * k));
  }
  p.speed = want > p.speed ? Math.min(want, p.speed + PEDS.accel * 2 * dt) : Math.max(want, p.speed - PEDS.accel * 2 * dt);
  const step = PEDS.asideSpeed * 1.5 * dt;
  const offset = clamp(p.offset + clamp(target - p.offset, -step, step), -room, room);
  const s = clamp(p.s + p.dir * p.speed * dt, 0.5, route.path.length - 0.5);
  const [nx, nz] = pathOffsetPoint(route.path, s, offset);
  if (!routeOpen(state.built, route, s + p.dir * PEDS.radius) || overlapsPed(state, p, nx, nz) || touchesMover(state.movers, nx, nz, [p.x, p.z]) || hitsProp(state, nx, nz, p.x, p.z)) {
    p.speed = 0;
    p.stuck += dt;
    if (p.stuck > PEDS.stuck) leaveGroup(state, p);
    return;
  }
  const moved = Math.abs(s - p.s);
  p.s = s;
  p.offset = offset;
  p.stuck = 0;
  p.phase = (p.phase + (moved / PEDS.stride) * Math.PI * 2) % (Math.PI * 200);
  placePed(state, p);
  if (Math.abs(p.s - p.ySampled) >= PEDS.heightStep) sampleHeight(state, p);
  p.pose = POSE.walk;
}

// Steps the pool by dt. `focus` is the pool center [x, z] (the camera),
// `nia` the skater position [x, y, z] or null, `others` the crowd and the
// NPC skaters ({ x, z, radius }). `banked`: the points of a combo that
// banked on this step (0 if none); a big one makes the walkers near Nia
// cheer (ped-activity.js). Mutates and returns the state.
export function stepPeds(state, dt, { focus = null, nia = null, others = [], banked = 0 } = {}) {
  state.time += dt;
  state.tick += 1;
  state.movers = moverGrid(others, nia);
  if (focus) {
    const jumped = Math.hypot(focus[0] - state.focus[0], focus[1] - state.focus[1]) > PEDS.jump;
    state.focus = [focus[0], focus[1]];
    if (jumped) scatter(state);
  }
  const [fx, fz] = state.focus;
  const r2 = state.radius * state.radius;
  const rand = state.rand;
  if (banked > 0 && nia) {
    for (const id of cheerIds(state.peds, nia, banked)) {
      const p = state.peds[id];
      p.cheer = lerp(rand(), ACT.cheer.time);
      state.cheers += 1;
    }
  }
  const viewers = nia ? [state.focus, [nia[0], nia[2]]] : [state.focus];
  const full = dt;
  for (const p of state.peds) {
    if (!p.live || (p.x - fx) ** 2 + (p.z - fz) ** 2 > r2) {
      p.live = false;
      spawn(state, p, state.radius * 0.75, state.radius);
      continue;
    }
    // Far from the camera and Nia: a longer step on fewer ticks.
    const stride = farStride(viewerDistance(p.x, p.z, viewers), PEDS.far);
    if (!stepsOnTick(state.tick, p.id, stride)) continue;
    dt = full * stride;
    const route = state.routes[p.route];
    // A cheer: stop, turn to Nia, and cheer (a place stays held).
    if (p.cheer > 0) {
      p.cheer -= dt;
      p.speed = 0;
      if (nia) face(p, nia[0], nia[2]);
      p.phase = (p.phase + dt * 7) % (Math.PI * 200);
      p.pose = p.cheer > 0 ? POSE.cheer : p.leg === "stay" && p.goal?.kind === "bench" ? POSE.sit : POSE.walk;
      continue;
    }
    if (p.goal) {
      stepGoal(state, p, dt);
      continue;
    }
    // A talk: stand and face the partner.
    if (p.talk > 0) {
      p.talk -= dt;
      p.speed = 0;
      const o = boundTo(state, p.with, p.withSpawns);
      if (o) face(p, o.x, o.z);
      else p.talk = 0;
      p.phase = (p.phase + dt * 3) % (Math.PI * 200);
      p.pose = p.talk > 0 ? POSE.talk : POSE.walk;
      if (p.talk <= 0) {
        p.with = -1;
        p.role = "walk";
        // Walk on the way the route goes (face it again).
        placePed(state, p);
      }
      continue;
    }
    if (p.lead >= 0) {
      const lead = boundTo(state, p.lead, p.leadSpawns);
      if (lead && !lead.goal && lead.route === p.route) {
        stepMember(state, p, lead, dt);
        continue;
      }
      leaveGroup(state, p);
    }
    p.pose = p.role === "jog" ? POSE.jog : POSE.walk;
    // Nia close by: give way, even while paused.
    const niaNear = nia && Math.hypot(nia[0] - p.x, nia[2] - p.z) < PEDS.giveWay;
    if (p.pause > 0 && !niaNear) {
      p.pause -= dt;
      p.speed = Math.max(0, p.speed - PEDS.accel * dt);
      continue;
    }
    if (p.pause > 0) p.pause = 0;
    // What is in the way: the nearest thing ahead that the walker's circle
    // would touch on its line.
    const rx = -p.fz;
    const rz = p.fx;
    let want = p.cruise;
    let target = p.dir * route.lane;
    let nearest = Infinity;
    let meet = null;
    const free = p.role === "walk" && p.members === 0;
    forEachNear(state, p, niaNear ? nia : null, (ox, oz, or, o) => {
      // The members of its own group walk beside it.
      if (o && o.lead === p.id) return;
      const dx = ox - p.x;
      const dz = oz - p.z;
      // Two walkers who pass each other close by may stop to talk.
      if (free && !meet && o && o !== "nia" && o.id !== p.met && o.dir !== p.dir && o.route === p.route && dx * dx + dz * dz < ACT.chatMeet ** 2) meet = o;
      const fwd = dx * p.fx + dz * p.fz;
      const lat = dx * rx + dz * rz;
      const need = PEDS.radius + or + PEDS.margin;
      const look = o === "nia" ? PEDS.giveWay : PEDS.look;
      if (fwd < -need * 0.5 || fwd > look || Math.abs(lat) >= need) return;
      // A walker ahead going the same way: follow it.
      if (o && o !== "nia" && o.fx * p.fx + o.fz * p.fz > 0.5 && o.speed > 0.2) {
        if (fwd > 0) want = Math.min(want, fwd > need + 0.6 ? p.cruise : o.speed * 0.9);
        return;
      }
      if (fwd < nearest) {
        nearest = fwd;
        // Step to the side away from it (in the route offset frame).
        const side = lat > 0 ? -1 : lat < 0 ? 1 : -p.dir;
        target = p.offset + p.dir * side * (need - Math.abs(lat) + 0.05);
      }
      const k = clamp((fwd - need * 0.6) / PEDS.look, 0, 1);
      want = Math.min(want, p.cruise * (fwd < need * 0.6 ? 0 : 0.35 + 0.65 * k));
    });
    if (meet && meet.role === "walk" && meet.members === 0 && meet.lead < 0 && !meet.goal && meet.talk <= 0 && meet.cheer <= 0 && !niaNear) {
      p.met = meet.id;
      meet.met = p.id;
      const hub = Math.min(1, p.hub);
      if (hub > 0 && rand() < ACT.chatMeetChance * (1 + hub)) {
        const t = lerp(rand(), ACT.chat);
        startTalk(p, meet, t);
        startTalk(meet, p, t);
        continue;
      }
    }
    const room = roomAt(route, p.s);
    target = clamp(target, -room, room);
    const step = PEDS.asideSpeed * dt;
    const offset = p.offset + clamp(target - p.offset, -step, step);
    p.speed = want > p.speed ? Math.min(want, p.speed + PEDS.accel * dt) : Math.max(want, p.speed - PEDS.accel * 2 * dt);
    let s = p.s + p.dir * p.speed * dt;
    // A closed piece of the walk ahead (routeOpen()) is a route end.
    const closed = !routeOpen(state.built, route, s + p.dir * PEDS.radius);
    const end = closed || s < 0.5 || s > route.path.length - 0.5;
    if (closed) s = p.s;
    else if (end) s = clamp(s, 0.5, route.path.length - 0.5);
    const [nx, nz] = pathOffsetPoint(route.path, s, offset);
    const s0 = p.s;
    if (overlapsPed(state, p, nx, nz) || touchesMover(state.movers, nx, nz, [p.x, p.z])) {
      p.speed = 0;
      p.stuck = (p.stuck ?? 0) + dt;
    } else {
      const ds = Math.abs(s - p.s);
      p.s = s;
      p.offset = offset;
      p.phase = (p.phase + (ds / p.strideLen) * Math.PI * 2) % (Math.PI * 200);
      p.stuck = 0;
      placePed(state, p);
      if (Math.abs(p.s - p.ySampled) >= PEDS.heightStep) sampleHeight(state, p);
    }
    if (end || p.stuck > PEDS.stuck) {
      // Turn around; the side step takes the walker to the right side again
      // (a jump across would land on another walker).
      p.dir = -p.dir;
      p.stuck = 0;
      p.speed = 0;
      p.pause = p.members > 0 ? 0 : lerp(rand(), PEDS.endPause);
      placePed(state, p);
      continue;
    }
    // A place on the way (a shop door, a bench, a bus stop): go there and
    // stay a while.
    if (free && !niaNear) {
      const pl = placePassed(state.places.byRoute, p.route, s0, p.s);
      if (pl && takesGoal(rand(), pl.kind)) {
        pl.user = p.id;
        p.goal = pl;
        p.leg = "to";
        p.home = { s: p.s, offset: p.offset };
        p.stuck = 0;
        continue;
      }
    }
    if (p.hub > 0 && rand() < PEDS.pauseRate * Math.min(3, p.hub) * dt) p.pause = lerp(rand(), PEDS.pause);
  }
  return state;
}

// The count of live walkers in each activity: { walk, jog, group, talk,
// sit, shop, bus, cheer } (for the tests and window.__atl).
export function pedActivities(state) {
  const out = { walk: 0, jog: 0, group: 0, talk: 0, sit: 0, shop: 0, bus: 0, cheer: 0, toPlace: 0 };
  for (const p of state.peds) {
    if (!p.live) continue;
    if (p.cheer > 0) out.cheer += 1;
    else if (p.goal && p.leg === "stay") out[p.goal.kind === "bench" ? "sit" : p.goal.kind] += 1;
    else if (p.goal) out.toPlace += 1;
    else if (p.talk > 0) out.talk += 1;
    else if (p.lead >= 0 || p.members > 0) out.group += 1;
    else if (p.role === "jog") out.jog += 1;
    else out.walk += 1;
  }
  return out;
}

// The smallest gap between two live walkers (m); negative means overlap.
export function pedMinGap(state) {
  let best = Infinity;
  const live = state.peds.filter((p) => p.live);
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) best = Math.min(best, Math.hypot(live[i].x - live[j].x, live[i].z - live[j].z) - 2 * PEDS.radius);
  }
  return best;
}
