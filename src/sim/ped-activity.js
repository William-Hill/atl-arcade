// What the walkers do besides a walk (#133): a jog, a group that walks
// together, two people who stop and talk, a goal (a shop door, a bench, a
// bus stop) where a walker stays and then walks on, and a cheer for a big
// combo. Pure and seeded: no Three.js and no Math.random here. The walker
// sim (src/sim/peds.js) calls these functions; the views read `pose`.
//
// A place is one spot where one person stays: a bench seat, a slot at a
// bus stop, or a slot at a shop door. Each place has an anchor on a walker
// route (route, s). A walker that passes the anchor can take the place: it
// walks in a straight line from the route to the place, stays, and walks
// back to the route. The line is checked when the places are made, so a
// walker never crosses a street or a building on the way.

import { pathOffsetPoint, pathTangent } from "./npc/path.js";
import { projectOnLine } from "../playtest/trail-script.js";
import { MAIN } from "../level/geo/lanes.js";

// The poses for the views (peds-view.js, ped-models.js, ped-crowd.js).
export const POSE = { walk: 0, sit: 1, cheer: 2, talk: 3, jog: 4 };

export const ACT = {
  // The role of a new walker, by route kind: the chance of each role. The
  // rest walk. A group leader recruits the next 1 or 2 walkers that spawn.
  role: {
    trail: { jog: 0.14, group: 0.12, chat: 0.05 },
    sidewalk: { jog: 0.04, group: 0.1, chat: 0.08 },
    edge: { jog: 0.1, group: 0.04, chat: 0 },
  },
  // A hub (a shop, a landmark, a park) makes a talk more likely, up to x2.
  chatHub: 1,
  jogSpeed: [2.4, 3.2], // m/s
  jogStride: 2.2, // m per run cycle
  groupSize: [2, 3],
  groupGap: 0.7, // m between two walkers side by side
  groupBack: 0.9, // m, the third walker of a group walks this far behind
  groupLeave: 4, // m from its slot: a member leaves the group
  recruit: 3, // s: a leader takes members for this long after its spawn
  chat: [6, 16], // s, a talk
  chatGap: 1.1, // m between two people who talk
  chatMeet: 1.6, // m: two walkers who pass this close can stop to talk
  chatMeetChance: 0.12, // per pass near a hub (x hub, up to x2)
  // A goal: the chance that a walker who passes the anchor takes the place,
  // and how long it stays (s).
  goalChance: { shop: 0.45, bench: 0.5, bus: 0.6 },
  stay: { shop: [4, 10], bench: [15, 35], bus: [10, 25] },
  goalSpeed: 0.85, // x the cruise speed, on the way to a place and back
  // The share of new walkers that start at a free place within `placeNear`
  // m of their spawn point, part way into their stay.
  placeSpawn: 0.3,
  placeNear: 30,
  arrive: 0.12, // m
  reach: 12, // m: a place farther than this from a route has no anchor
  lineStep: 0.4, // m between two checks of the line to a place
  // Bus stops: on the sidewalks of the main streets (the level has no bus
  // stop data), one each `every` m of sidewalk, with `slots` places.
  bus: { every: 240, slots: 3, slotGap: 0.8, probe: [1.5, 3, 4.5, 6] },
  shopSlots: 2,
  shopOut: 0.8, // m in front of the shop wall
  benchSeat: 0.42, // m from the bench center to a seat, along the bench
  // A cheer: a banked combo of at least `min` points makes the walkers
  // within `radius` m of Nia stop, turn to her, and cheer for `time` s.
  cheer: { min: 1000, radius: 22, time: [2.2, 3.4] },
};

const lerp = (u, [a, b]) => a + u * (b - a);

// Pure: the role of a new walker from one random number `u` (0..1). `kind`
// is the route kind, `hub` the hub density at the spawn point.
export function pickRole(u, kind, hub = 0) {
  const r = ACT.role[kind] ?? ACT.role.sidewalk;
  const chat = r.chat * (1 + Math.min(1, hub) * ACT.chatHub);
  let at = 0;
  for (const [role, p] of [
    ["jog", r.jog],
    ["group", r.group],
    ["chat", chat],
  ]) {
    at += p;
    if (u < at) return role;
  }
  return "walk";
}

// Pure: the group size for a leader from one random number.
export function groupSize(u) {
  const [a, b] = ACT.groupSize;
  return Math.min(b, a + Math.floor(u * (b - a + 1)));
}

// Pure: the route spot ({ s, offset }) of group member `k` (1 or 2) of a
// leader at (s, offset, dir), on a route with the room `room`. Member 1
// walks beside the leader on the side `side` (+1 or -1, in the route offset
// frame), or on the other side when there is no room. Member 2 walks
// behind, between the two. With no room on either side, the members walk
// in a line behind.
export function groupSlot({ s, offset, dir }, k, side, room) {
  const gap = ACT.groupGap;
  const fits = (o) => Math.abs(o) <= room;
  let beside = null;
  if (fits(offset + side * gap)) beside = offset + side * gap;
  else if (fits(offset - side * gap)) beside = offset - side * gap;
  if (k === 1) return beside == null ? { s: s - dir * ACT.groupBack, offset } : { s, offset: beside };
  if (beside == null) return { s: s - dir * ACT.groupBack * 2, offset };
  return { s: s - dir * ACT.groupBack, offset: (offset + beside) / 2 };
}

// Pure: true when a walker that went from s0 to s1 on its route passed the
// anchor `s` of a place.
export function passes(s0, s1, s) {
  return (s0 - s) * (s1 - s) <= 0 && s0 !== s1;
}

// Pure: the free place on route `ri` whose anchor the walker passed in this
// step, or null. `byRoute` is places.byRoute; a place is free when no
// walker uses it.
export function placePassed(byRoute, ri, s0, s1) {
  const list = byRoute.get(ri);
  if (!list) return null;
  const lo = Math.min(s0, s1);
  const hi = Math.max(s0, s1);
  // The list is sorted by s; it is short (a few places per route).
  for (const pl of list) {
    if (pl.s < lo) continue;
    if (pl.s > hi) break;
    if (pl.user < 0 && passes(s0, s1, pl.s)) return pl;
  }
  return null;
}

// Pure: true when a walker takes a place of `kind`, from one random number.
export function takesGoal(u, kind) {
  return u < (ACT.goalChance[kind] ?? 0);
}

// Pure: the stay time (s) at a place of `kind`.
export function stayTime(u, kind) {
  return lerp(u, ACT.stay[kind] ?? [3, 6]);
}

// Pure: true when a banked combo is big enough for a cheer.
export function bigCombo(banked) {
  return banked >= ACT.cheer.min;
}

// Pure: the ids of the walkers that cheer for a combo banked at Nia's
// position `nia` ([x, y, z]): the live walkers within ACT.cheer.radius m.
export function cheerIds(peds, nia, banked) {
  if (!nia || !bigCombo(banked)) return [];
  const r2 = ACT.cheer.radius ** 2;
  return peds.filter((p) => p.live && (p.x - nia[0]) ** 2 + (p.z - nia[2]) ** 2 <= r2).map((p) => p.id);
}

// Pure: one step of `dt` s from (x, z) to (tx, tz) at `speed` m/s. Returns
// [x, z, arrived].
export function stepToward(x, z, tx, tz, speed, dt) {
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.hypot(dx, dz);
  const step = speed * dt;
  if (d <= Math.max(step, ACT.arrive)) return [tx, tz, true];
  return [x + (dx / d) * step, z + (dz / d) * step, false];
}

// --- The places ----------------------------------------------------------

// The nearest route point to (x, z): { route, s, d, side } (side: the sign
// of the offset of the point from the route), or null. `candidates` is
// pedRoutes().candidates (a point every 4 m of each route, in a grid).
function nearestRoute(built, x, z, reach) {
  const { grid } = built.candidates;
  const cell = 32;
  let best = null;
  const ix = Math.floor(x / cell);
  const iz = Math.floor(z / cell);
  for (let a = ix - 1; a <= ix + 1; a += 1) {
    for (let b = iz - 1; b <= iz + 1; b += 1) {
      for (const p of grid.get(`${a},${b}`) ?? []) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d <= reach + 4 && (!best || d < best.d)) best = { route: p.route, d };
      }
    }
  }
  if (!best) return null;
  const r = built.routes[best.route];
  const pr = projectOnLine(r.path.points, x, z);
  const s = Math.max(1, Math.min(r.path.length - 1, pr.s));
  const [ax, az] = pathOffsetPoint(r.path, s, 0);
  const [tx, tz] = pathTangent(r.path, s);
  const d = Math.hypot(x - ax, z - az);
  if (d > reach) return null;
  // The right of +s is (-tz, tx).
  const side = (x - ax) * -tz + (z - az) * tx >= 0 ? 1 : -1;
  return { route: best.route, s, d, side };
}

// True when every point of the line from a to b is walkable. The last
// `skip` m (the place itself: a bench, a shop step) are not checked.
function lineClear(walkable, a, b, skip = 0) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(d / ACT.lineStep));
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    if (t * d > d - skip) break;
    if (!walkable(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false;
  }
  return true;
}

// A place: anchor it to the nearest route and check the lines from the
// route (its center and both room edges) to the place. Returns the place
// or null.
function anchored(built, walkable, kind, x, z, fx, fz, skip) {
  const near = nearestRoute(built, x, z, ACT.reach);
  if (!near) return null;
  const r = built.routes[near.route];
  for (const off of [-r.room, 0, r.room]) {
    const a = pathOffsetPoint(r.path, near.s, off);
    if (!lineClear(walkable, a, [x, z], skip)) return null;
  }
  return { kind, x, z, fx, fz, route: near.route, s: near.s, user: -1 };
}

// Pure: the bus stops of a level: { x, z, fx, fz, route, s } (fx, fz: the
// way the people face, to the street). One each ACT.bus.every m of a
// sidewalk route that runs beside a main street (trunk to tertiary).
// `streetAt(x, z)` gives the highway class of the street at a point, or
// null.
export function busStops(built, streetAt) {
  const out = [];
  built.routes.forEach((r, ri) => {
    if (r.kind !== "sidewalk") return;
    for (let s = ACT.bus.every / 2; s < r.path.length - ACT.bus.every / 4; s += ACT.bus.every) {
      const [tx, tz] = pathTangent(r.path, s);
      let side = 0;
      for (const d of ACT.bus.probe) {
        for (const sd of [1, -1]) {
          if (side) break;
          const [x, z] = pathOffsetPoint(r.path, s, sd * d);
          if (MAIN.has(streetAt(x, z))) side = sd;
        }
        if (side) break;
      }
      if (!side) continue;
      // The people stand at the curb side of the sidewalk and face the street.
      const [x, z] = pathOffsetPoint(r.path, s, side * (r.room - 0.05));
      out.push({ x, z, fx: -tz * side, fz: tx * side, route: ri, s, side });
    }
  });
  return out;
}

// The places of a level: the bench seats (from the street props), the
// bus stop slots, and the shop door slots. `walkable(x, z)` is false on a
// street and in a building. `props` are the level env props ({ kind, x, z,
// yaw }); `stops` are busStops(); `hubs` are pedHubs() (the shop fronts).
// Returns { list, byRoute } (byRoute: route index -> places sorted by s).
export function pedPlaces(built, { walkable, props = [], stops = [], hubs = [] }) {
  const list = [];
  const add = (p) => {
    if (p) list.push({ ...p, id: list.length });
  };
  for (const b of props) {
    if (b.kind !== "bench" && b.kind !== "bench_painted") continue;
    // The bench front is +z of the template: (sin yaw, cos yaw). The seats
    // are along the bench, (cos yaw, -sin yaw).
    const fx = Math.sin(b.yaw ?? 0);
    const fz = Math.cos(b.yaw ?? 0);
    for (const k of [-1, 1]) {
      const x = b.x + Math.cos(b.yaw ?? 0) * ACT.benchSeat * k;
      const z = b.z - Math.sin(b.yaw ?? 0) * ACT.benchSeat * k;
      // The bench itself is not walkable ground for the check: skip 1 m.
      add(anchored(built, walkable, "bench", x, z, fx, fz, 1));
    }
  }
  for (const st of stops) {
    const r = built.routes[st.route];
    const [tx, tz] = pathTangent(r.path, st.s);
    for (let k = 0; k < ACT.bus.slots; k += 1) {
      const along = (k - (ACT.bus.slots - 1) / 2) * ACT.bus.slotGap;
      add({ kind: "bus", x: st.x + tx * along, z: st.z + tz * along, fx: st.fx, fz: st.fz, route: st.route, s: st.s + along, user: -1 });
    }
  }
  for (const h of hubs) {
    if (h.kind !== "shop" && h.kind !== "storefront") continue;
    // The door: the middle of the front wall, ACT.shopOut m out, on the side
    // of the nearest route. The people face the wall.
    const near = nearestRoute(built, h.x, h.z, ACT.reach + 2);
    if (!near) continue;
    const r = built.routes[near.route];
    const [ax, az] = pathOffsetPoint(r.path, near.s, 0);
    const d = Math.hypot(ax - h.x, az - h.z) || 1;
    const ox = (ax - h.x) / d;
    const oz = (az - h.z) / d;
    for (let k = 0; k < ACT.shopSlots; k += 1) {
      const along = (k - (ACT.shopSlots - 1) / 2) * 0.7;
      const x = h.x + ox * ACT.shopOut - oz * along;
      const z = h.z + oz * ACT.shopOut + ox * along;
      if (!walkable(x, z)) continue;
      add(anchored(built, walkable, "shop", x, z, -ox, -oz, 0));
    }
  }
  const grid = new Map();
  for (const p of list) {
    const k = `${Math.floor(p.x / PLACE_CELL)},${Math.floor(p.z / PLACE_CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const byRoute = new Map();
  for (const p of list) {
    if (!byRoute.has(p.route)) byRoute.set(p.route, []);
    byRoute.get(p.route).push(p);
  }
  for (const l of byRoute.values()) l.sort((a, b) => a.s - b.s || a.id - b.id);
  return { list, byRoute, grid };
}

const PLACE_CELL = 32;

// Pure: the nearest free place within `r` m of (x, z), or null. `open(pl)`
// (optional) can refuse a place.
export function nearestFreePlace(places, x, z, r, open = null) {
  let best = null;
  let bd = r;
  const reach = Math.ceil(r / PLACE_CELL);
  const ix = Math.floor(x / PLACE_CELL);
  const iz = Math.floor(z / PLACE_CELL);
  for (let a = ix - reach; a <= ix + reach; a += 1) {
    for (let b = iz - reach; b <= iz + reach; b += 1) {
      for (const pl of places.grid.get(`${a},${b}`) ?? []) {
        if (pl.user >= 0) continue;
        const d = Math.hypot(pl.x - x, pl.z - z);
        if (d < bd || (d === bd && best && pl.id < best.id)) {
          if (open && !open(pl)) continue;
          best = pl;
          bd = d;
        }
      }
    }
  }
  return best;
}

// Pure: a walkable test from the ground sampler of the level: false on a
// street (a junction patch too), a median, or a building, and off the
// level. `kindOf` maps a shape id to its kind (geoShapes() in geo-ground.js).
// With `y` (the walker's feet), a bridge deck over the walker does not count.
export const NOT_WALKABLE = new Set(["street", "median", "building"]);
export function walkableAt(sample, kindOf) {
  return (x, z, y = null) => {
    const id = sample(x, z, y == null ? Infinity : y + 0.5)?.id;
    if (id == null) return false;
    return !NOT_WALKABLE.has(kindOf.get(id));
  };
}
