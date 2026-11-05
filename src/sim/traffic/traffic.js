// Calm traffic on the main streets (issue #132). Pure and seeded: the same
// level and seed give the same cars, step for step. No Three.js here.
//
// Political rules (AGENTS.md): a car never hits, chases, or threatens the
// skater. A car slows and stops when the skater is in its lane ahead, waits,
// and then goes on. A move that would bring a car body nearer than
// TRAFFIC.safeRadius to the skater does not happen. There are no police cars
// and no emergency vehicles.
//
// Lanes: each main street is a chain of street strips. A chain with an
// opposite carriageway parallel to it (a divided road, such as Freedom
// Parkway) is one-way, and the opposite carriageway is on the left of the
// driver (right-hand traffic). Every other chain is two-way. Each travel
// direction gets the lanes of the street layout (laneLayout() in
// src/level/geo/lanes.js, from the OSM lanes tags), at the lane centers
// that the lane markings show. A car keeps its lane. At the end of a
// two-way chain a car turns (a U-turn, with the left signal) into the lane
// back; at the end of a one-way chain it goes on at the start of the same
// lane.
//
// Car following: the Intelligent Driver Model (src/sim/cars.js). The car
// ahead, a stop line, a crosswalk with the skater on it, and the skater in
// the lane are each a leader for the IDM, and the car takes the lowest
// acceleration. The acceleration also drives the brake lights, and the lane
// heading ahead drives the turn signals.
//
// Stop rules: a car stops at the stop line before each intersection with a
// named street (src/level/geo/signs.js), waits TRAFFIC.stopWait, and goes
// when no other car is in the intersection and there is room past it. Thus
// cars from two streets never meet in an intersection, and a queue never
// blocks one.

import { chainStrips, projectOnLine } from "../../playtest/trail-script.js";
import { createPath, pathOffsetPoint, pathTangent } from "../npc/path.js";
import { streetIntersections } from "../../level/geo/signs.js";
import { hash32, seededRandom } from "../../level/geo/styles.js";
import { MARKING_SIZES, crosswalksOf, laneLayout } from "../../level/geo/lanes.js";
import { angleDelta, brakeLevel, idmAccel, idmStopAccel, onCrosswalk, runLaneOffsets, turnSignal } from "../cars.js";

export const TRAFFIC = {
  // A car body never comes nearer to the skater than this (m), when the
  // skater is less than skaterHeight above or below the car.
  safeRadius: 2,
  // A skater more than this above or below a car (on a bridge, or under
  // one) is not in its way (m).
  skaterHeight: 3,
  // Cruise speed by highway class (m/s). Calm: 7.5 m/s is 17 mph.
  cruise: { trunk: 9, secondary: 7.5, default: 7 },
  accel: 1.5, // m/s^2. min 1 / typical 1.5 / max 2.5.
  brake: 2.5, // m/s^2, the planned stop. min 2 / typical 2.5 / max 4.
  hardBrake: 6, // m/s^2, the largest speed drop in one step.
  gap: 3, // m kept bumper to bumper.
  stopWait: 1.2, // s at a stop line.
  yieldWait: 1.5, // s a car waits after the skater leaves its lane.
  // The car looks this far ahead for the skater (m).
  lookAhead: 30,
  // The car stops this far (m) past safeRadius from the skater.
  yieldMargin: 2,
  // The skater is in the lane when the side distance from the car axis is
  // under width / 2 + safeRadius + laneMargin (m).
  laneMargin: 0.75,
  // Cars per km of lane (perKm * multiLane on a street with two or more
  // lanes in the direction).
  perKm: 6,
  multiLane: 0.7,
  // The turn signal looks this far ahead along the lane (m): 100 ft.
  signalAhead: 30,
  // A skater on a crosswalk ahead (or at its ends) stops the car this far
  // (m) before the crosswalk (the stop bar gap, lanes.js stopGap).
  crossingStop: 1,
  // The speed (m/s) of the U-turn at the end of a two-way street.
  turnSpeed: 3,
  // The largest height change of a car in one step on the same lane (m).
  // A step in the street (a bridge joint) becomes a short ramp.
  maxClimb: 0.06,
};

// Car sizes (m): length along +x, width along z, height. The car kit
// (src/render/car-kit.js) builds each body to these sizes, and the skater
// collides with the same box.
export const CAR_SIZE = {
  sedan: { length: 4.6, width: 1.8, height: 1.45 },
  hatchback: { length: 4.1, width: 1.75, height: 1.55 },
  pickup: { length: 5.4, width: 2.0, height: 1.85 },
  van: { length: 5.2, width: 2.4, height: 3.1 },
  taxi: { length: 4.9, width: 1.95, height: 1.65 },
  box_truck: { length: 7.5, width: 2.5, height: 3.9 },
  bus: { length: 12, width: 2.55, height: 3.1 },
};

export const CAR_KINDS = Object.keys(CAR_SIZE);

// The body colors (sRGB hex). A bright Atlanta palette with the usual
// whites, silvers, and navies. No black and white two-tone (a police look).
export const CAR_COLORS = [0xf4f1ea, 0xc9ccd1, 0x2b3a67, 0xe63946, 0x2ec4b6, 0xff8c42, 0x3a86ff, 0xffd23f, 0x8ac926, 0x9b5de5, 0xd8a47f, 0x5e8c61];

// The main streets with traffic. One group is one chain of lanes: Highland
// Avenue goes on as North Highland Avenue.
export const MAIN_STREETS = [
  ["John Lewis Freedom Parkway Northeast"],
  ["Ponce de Leon Avenue Northeast"],
  ["North Avenue Northeast"],
  ["Highland Avenue Northeast", "North Highland Avenue Northeast"],
];

const MIN_CHAIN = 60; // m. A shorter chain gets no lane.
const CURB_CLEAR = 1.3; // m from a lane center to the curb band: half a wide car and a margin.

function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i += 1) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return len;
}

// The side of the opposite carriageway, from samples along the chain:
// "left", "right", or null (no parallel carriageway in the opposite direction).
export function oppositeSide(chain, others, { step = 25, minGap = 5, maxGap = 50 } = {}) {
  const path = createPath(chain);
  const otherPaths = others.map(createPath);
  let left = 0;
  let right = 0;
  let samples = 0;
  for (let s = step / 2; s < path.length; s += step) {
    samples += 1;
    const [x, z] = pathOffsetPoint(path, s, 0);
    const [tx, tz] = pathTangent(path, s);
    let best = null;
    for (const o of otherPaths) {
      const p = projectOnLine(o.points, x, z);
      if (p.d < minGap || p.d > maxGap || (best && p.d >= best.d)) continue;
      best = { d: p.d, path: o, s: p.s };
    }
    if (!best) continue;
    const [ox, oz] = pathOffsetPoint(best.path, best.s, 0);
    const [ux, uz] = pathTangent(best.path, best.s);
    if (tx * ux + tz * uz > -0.7) continue;
    // The right of (tx, tz) is (-tz, tx) (src/sim/npc/path.js).
    if (-tz * (ox - x) + tx * (oz - z) > 0) right += 1;
    else left += 1;
  }
  if (samples === 0 || left + right < samples * 0.4) return null;
  return right > left ? "right" : "left";
}

// The strip of a chain that sets its lane layout: of the strips along the
// chain, the lane layout (lane counts and width) that covers the most
// length, so the cars follow the lane markings on most of the street. A
// two-way chain leaves out the oneway-tagged strips (a one-way stretch of a
// two-way street). Returns { strip, sign, minWidth } with sign +1 when the
// chain runs the strip direction, or null.
function chainLayoutStrip(chain, strips, oneway) {
  const path = createPath(chain);
  const byKey = new Map();
  let minWidth = Infinity;
  for (const s of strips) {
    const i = Math.floor((s.points.length - 1) / 2);
    const [ax, az] = s.points[i];
    const [bx, bz] = s.points[i + 1];
    const p = projectOnLine(chain, (ax + bx) / 2, (az + bz) / 2);
    if (p.d > 0.5) continue;
    minWidth = Math.min(minWidth, s.width);
    if (!oneway && s.oneway) continue;
    const L = laneLayout(s, oneway);
    const key = `${L.forward}/${L.backward}/${s.width}`;
    const [tx, tz] = pathTangent(path, p.s);
    const e = byKey.get(key) ?? { strip: s, sign: tx * (bx - ax) + tz * (bz - az) >= 0 ? 1 : -1, length: 0 };
    e.length += pathLength(s.points);
    byKey.set(key, e);
  }
  let best = null;
  for (const e of byKey.values()) if (!best || e.length > best.length || (e.length === best.length && e.strip.width < best.strip.width)) best = e;
  return best ? { ...best, minWidth } : null;
}

// The lane offsets (curb lane first) of a run of a chain. `along` is +1 when
// the run goes the chain direction. A lane stays inside the curbs of the
// narrowest strip of the chain.
function laneOffsetsOf(ref, along, oneway, width) {
  const fallback = [oneway ? width / 4 : Math.min(width / 4, 3.5)];
  if (!ref) return fallback;
  const offsets = runLaneOffsets(laneLayout(ref.strip, oneway), ref.sign * along);
  const max = ref.minWidth / 2 - MARKING_SIZES.curb - CURB_CLEAR;
  return offsets.length ? offsets.map((o) => Math.max(-max, Math.min(max, o))) : fallback;
}

// The lanes of the level: [{ id, name, path, offset, laneIndex, laneCount,
// length, speed, oneway, next, stops: [{ sStop, sExit, box }], crossings:
// [{ s, x, z, dx, dz, depth, w }] }]. laneIndex 0 is the curb lane of its
// travel direction. `boxes` lists the intersections that have a stop line.
export function trafficLanes(level, { streets = MAIN_STREETS } = {}) {
  const lanes = [];
  const all = streetIntersections(level);
  const walks = crosswalksOf(level);
  const boxIndex = new Map();
  const boxes = [];
  for (const group of streets) {
    const strips = (level.strips ?? []).filter((s) => s.kind === "street" && group.includes(s.name));
    if (!strips.length) continue;
    const signNames = new Set(strips.map((s) => s.signName ?? s.name));
    const stripIds = new Set(strips.map((s) => s.id));
    const width = Math.max(8, Math.min(...strips.map((s) => s.width)));
    const highway = strips.some((s) => s.highway === "trunk") ? "trunk" : strips.some((s) => s.highway === "secondary") ? "secondary" : "default";
    const speed = TRAFFIC.cruise[highway];
    const chains = chainStrips(strips, "street").filter((c) => pathLength(c) >= MIN_CHAIN);
    const sides = chains.map((c, i) => oppositeSide(c, chains.filter((_, j) => j !== i)));
    const divided = sides.some(Boolean);
    const crossings = all.filter((ix) => ix.names.some((n) => signNames.has(n)) && !ix.names.every((n) => signNames.has(n)));
    chains.forEach((chain, ci) => {
      const side = sides[ci];
      // A divided road without a partner here has no known direction: no lane.
      if (divided && !side) return;
      const runs = side ? [side === "right" ? chain.slice().reverse() : chain] : [chain, chain.slice().reverse()];
      const alongs = side ? [side === "right" ? -1 : 1] : [1, -1];
      const ref = chainLayoutStrip(chain, strips, Boolean(side));
      const runLanes = [];
      runs.forEach((points, ri) => {
        const path = createPath(points);
        const stops = [];
        for (const ix of crossings) {
          const p = projectOnLine(points, ix.x, ix.z);
          if (p.d > width) continue;
          const sStop = p.s - (ix.halfWidth + 3);
          const sExit = p.s + ix.halfWidth + 3;
          if (sStop < 5 || sExit > path.length - 1) continue;
          const key = `${ix.x},${ix.z}`;
          if (!boxIndex.has(key)) {
            boxIndex.set(key, boxes.length);
            boxes.push({ x: ix.x, z: ix.z, names: ix.names });
          }
          stops.push({ sStop, sExit, box: boxIndex.get(key) });
        }
        stops.sort((a, b) => a.sStop - b.sStop);
        // Two stop lines closer than 15 m are one (a divided cross street).
        const merged = [];
        for (const st of stops) {
          const last = merged[merged.length - 1];
          if (last && st.sStop - last.sStop < 15) last.sExit = Math.max(last.sExit, st.sExit);
          else merged.push({ ...st });
        }
        // The crosswalks over this street that the run passes.
        const walksOnRun = [];
        for (const c of walks) {
          if (!signNames.has(c.name)) continue;
          const x = c.x + c.dx * c.at;
          const z = c.z + c.dz * c.at;
          const p = projectOnLine(points, x, z);
          if (p.d > width / 2 + 2 || p.s < 1 || p.s > path.length - 1) continue;
          walksOnRun.push({ s: p.s, x, z, dx: c.dx, dz: c.dz, depth: MARKING_SIZES.crossDepth, w: c.w });
        }
        walksOnRun.sort((a, b) => a.s - b.s);
        const offsets = laneOffsetsOf(ref, alongs[ri], Boolean(side), width);
        runLanes.push(
          offsets.map((offset, k) => {
            const lane = { id: lanes.length, name: group[0], path, offset, laneIndex: k, laneCount: offsets.length, length: path.length, speed, oneway: Boolean(side), highway, next: lanes.length, nextS: 0, stops: merged, crossings: walksOnRun, stripIds };
            lanes.push(lane);
            return lane;
          }),
        );
      });
      // Two-way: the end of a lane turns into the same lane (or the nearest
      // one) of the run back.
      if (runLanes.length === 2) {
        runLanes.forEach((run, ri) => {
          const back = runLanes[1 - ri];
          for (const lane of run) lane.next = back[Math.min(lane.laneIndex, back.length - 1)].id;
        });
      }
    });
    linkOneWay(lanes.filter((l) => l.oneway && l.name === group[0]), level.bounds);
  }
  return { lanes, boxes };
}

const LINK_EDGE = 25; // m. A lane end this near the level bounds is at the edge.
const LINK_JUMP = 60; // m. The largest jump from a lane end at the edge to a lane start.

function edgeDistance([x, z], b) {
  return Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
}

// Links the end of each one-way lane: into a lane of the same street that
// goes on through the end point (a junction), else to the nearest lane
// start at the level edge (the far carriageway comes back), else to its own
// start.
function linkOneWay(group, bounds) {
  // A lane goes on in the lane of the same index (or the nearest one).
  const sameIndex = (lane, o) => o.laneIndex === Math.min(lane.laneIndex, o.laneCount - 1);
  for (const lane of group) {
    const end = lane.path.points[lane.path.points.length - 1];
    const [tx, tz] = pathTangent(lane.path, lane.length);
    let link = null;
    for (const o of group) {
      if (o === lane || o.path === lane.path || !sameIndex(lane, o)) continue;
      const p = projectOnLine(o.path.points, end[0], end[1]);
      if (p.d > 3 || p.s < 1 || p.s > o.length - 20) continue;
      const [ux, uz] = pathTangent(o.path, p.s);
      if (tx * ux + tz * uz > 0.3) link = { id: o.id, s: p.s };
    }
    if (!link && bounds && edgeDistance(end, bounds) < LINK_EDGE) {
      let best = LINK_JUMP;
      for (const o of group) {
        const start = o.path.points[0];
        const d = Math.hypot(start[0] - end[0], start[1] - end[1]);
        if (o !== lane && o.path !== lane.path && sameIndex(lane, o) && d < best && edgeDistance(start, bounds) < LINK_EDGE) {
          best = d;
          link = { id: o.id, s: 0 };
        }
      }
    }
    if (link) {
      lane.next = link.id;
      lane.nextS = link.s;
    }
  }
}

// The world pose of a car at arc length s on its lane.
export function lanePose(lane, s) {
  const [x, z] = pathOffsetPoint(lane.path, s, lane.offset);
  const [tx, tz] = pathTangent(lane.path, s, 3);
  // forward(yaw) = (cos yaw, -sin yaw), as for the skater.
  return { x, z, yaw: Math.atan2(-tz, tx) };
}

// The horizontal distance from (px, pz) to the car body box (0 inside).
export function carBodyDistance(car, px, pz) {
  const size = CAR_SIZE[car.kind];
  const fx = Math.cos(car.yaw);
  const fz = -Math.sin(car.yaw);
  const dx = px - car.x;
  const dz = pz - car.z;
  const along = Math.abs(dx * fx + dz * fz) - size.length / 2;
  const across = Math.abs(-dx * fz + dz * fx) - size.width / 2;
  return Math.hypot(Math.max(0, along), Math.max(0, across));
}

function pickKind(rand, busOk) {
  const r = rand();
  if (busOk && r < 0.12) return "bus";
  if (r < 0.45) return "sedan";
  if (r < 0.65) return "hatchback";
  if (r < 0.77) return "pickup";
  if (r < 0.87) return "van";
  if (r < 0.94) return "taxi";
  return "box_truck";
}

const flatHeight = () => 0;

function spawnSpeedLimit(lane, front) {
  const st = lane.stops.find((t) => t.sStop >= front);
  return st ? Math.sqrt(2 * TRAFFIC.brake * 0.5 * Math.max(0, st.sStop - front)) : Infinity;
}

// Creates the traffic. `heightAt(x, z, y)` gives the street height under a
// car (y is the last car height); the default is flat ground.
export function createTraffic(level, { seed = 1, heightAt = flatHeight, streets = MAIN_STREETS, perKm = TRAFFIC.perKm } = {}) {
  const { lanes, boxes } = trafficLanes(level, { streets });
  const cars = [];
  for (const lane of lanes) {
    const rand = seededRandom(hash32(`${lane.name}:${lane.id}:${seed}`));
    const count = Math.max(1, Math.round((lane.length / 1000) * perKm * (lane.laneCount > 1 ? TRAFFIC.multiLane : 1)));
    const spacing = lane.length / count;
    let bus = !lane.oneway && lane.length > 600;
    for (let i = 0; i < count; i += 1) {
      const kind = pickKind(rand, bus);
      if (kind === "bus") bus = false;
      const half = CAR_SIZE[kind].length / 2;
      let s = Math.min(lane.length - half - 1, Math.max(half + 1, (i + 0.25 + rand() * 0.5) * spacing));
      // A car does not start in an intersection or on a stop line.
      const st = lane.stops.find((t) => s + half > t.sStop - 1 && s - half < t.sExit);
      if (st) s = Math.max(half + 1, st.sStop - half - 2);
      if (cars.some((c) => c.lane === lane.id && Math.abs(c.s - s) < half + CAR_SIZE[c.kind].length / 2 + TRAFFIC.gap)) continue;
      const pose = lanePose(lane, s);
      const y = heightAt(pose.x, pose.z, -Infinity, lane);
      cars.push({
        id: cars.length,
        kind,
        color: Math.floor(rand() * CAR_COLORS.length),
        lane: lane.id,
        s,
        // No faster than a comfortable stop before the next stop line.
        speed: Math.min(lane.speed * (0.6 + rand() * 0.4), spawnSpeedLimit(lane, s + half)),
        ...pose,
        y,
        wait: 0,
        yieldTime: 0,
        next: nextStop(lane, s + half),
        box: -1,
        boxExit: 0,
        yielding: false,
        crossing: false,
        accel: 0,
        brake: 0,
        signal: 0,
      });
    }
  }
  return { lanes, boxes, occupant: boxes.map(() => -1), cars, tick: 0, heightAt, minSkaterGap: Infinity, closest: Infinity, yields: 0, crossingYields: 0 };
}

function nextStop(lane, front) {
  let i = 0;
  while (i < lane.stops.length && lane.stops[i].sStop < front - 0.5) i += 1;
  return i;
}

// The nearest car ahead, on the same lane or past its end on the next
// lane: { gap, speed }, gap the free distance (m) from the car front to its
// rear (Infinity with no car ahead).
function leader(state, car) {
  const lane = state.lanes[car.lane];
  const front = car.s + CAR_SIZE[car.kind].length / 2;
  let gap = Infinity;
  let speed = 0;
  for (const o of state.cars) {
    if (o === car) continue;
    const half = CAR_SIZE[o.kind].length / 2;
    let g = Infinity;
    if (o.lane === car.lane && o.s > car.s) g = o.s - half - front;
    else if (o.lane === lane.next && o.s >= lane.nextS && (o.lane !== car.lane || o.s < car.s)) g = lane.length - front + o.s - lane.nextS - half;
    if (g < gap) {
      gap = g;
      speed = o.speed;
    }
  }
  return { gap, speed };
}

// The crosswalks ahead of `front` (m) on a lane, within `range` m, with the
// skater on them (or at their ends). Returns the nearest one, or null.
function skaterCrossing(lane, front, until, skater, carY) {
  if (!skater || Math.abs(skater[1] - carY) > TRAFFIC.skaterHeight) return null;
  for (const cw of lane.crossings) {
    if (cw.s - cw.depth / 2 < front) continue;
    if (cw.s > until) break;
    if (onCrosswalk(cw, skater[0], skater[2])) return cw;
  }
  return null;
}

// Is the skater in the lane ahead of the car? Returns the distance (m) from
// the car front to the skater along the car heading, or Infinity.
function skaterAhead(car, skater) {
  if (!skater) return Infinity;
  if (Math.abs(skater[1] - car.y) > TRAFFIC.skaterHeight) return Infinity;
  const size = CAR_SIZE[car.kind];
  const fx = Math.cos(car.yaw);
  const fz = -Math.sin(car.yaw);
  const dx = skater[0] - car.x;
  const dz = skater[2] - car.z;
  const along = dx * fx + dz * fz - size.length / 2;
  const across = Math.abs(-dx * fz + dz * fx);
  if (across > size.width / 2 + TRAFFIC.safeRadius + TRAFFIC.laneMargin) return Infinity;
  if (along < -size.length || along > TRAFFIC.lookAhead) return Infinity;
  return along;
}

// The skater distance that a car must keep, or Infinity when the skater is
// not near in height.
function skaterGap(car, skater) {
  if (!skater || Math.abs(skater[1] - car.y) > TRAFFIC.skaterHeight) return Infinity;
  return carBodyDistance(car, skater[0], skater[2]);
}

// Moves a car to arc length s on a lane (the pose and the height). After a
// wrap past the lane end (to the next lane, or to the start of the same
// lane) the height starts again from the lane.
function place(state, car, laneId, s, wrapped = false) {
  const lane = state.lanes[laneId];
  const pose = lanePose(lane, s);
  const same = !wrapped;
  const target = state.heightAt(pose.x, pose.z, same ? car.y : -Infinity, lane);
  car.lane = laneId;
  car.s = s;
  car.x = pose.x;
  car.z = pose.z;
  car.yaw = pose.yaw;
  car.y = same ? car.y + Math.max(-TRAFFIC.maxClimb, Math.min(TRAFFIC.maxClimb, target - car.y)) : target;
}

// The level with only its street strips: no buildings, parks, sidewalks,
// paths, or trail. A sampler of it gives the street surface (a bridge deck
// or the street over the terrain), so a car never climbs a building
// footprint or a curb that overlaps its lane in the map data.
export function streetsOnly(level) {
  return { ...level, buildings: [], areas: [], strips: (level.strips ?? []).filter((s) => s.kind === "street") };
}

// The street height for the traffic, from a ground sampler of the streets
// (see streetsOnly) and the terrain height. heightAt(x, z, y, lane): with a
// known last height y, the highest surface up to a step over y, so a car
// rolls up a bridge ramp and stays under a bridge over its street. With no
// last height, the top surface when it is a strip of the lane street (a car
// on its own bridge), else the surface at the terrain.
export function streetHeightSampler(sampleGround, groundHeight = () => 0) {
  return (x, z, y, lane) => {
    if (Number.isFinite(y)) return sampleGround(x, z, y + 1)?.height ?? y;
    const top = sampleGround(x, z);
    if (top && lane?.stripIds?.has(top.id)) return top.height;
    return sampleGround(x, z, groundHeight(x, z))?.height ?? groundHeight(x, z);
  };
}

// The car pose after a move of ds, without a change to the car.
function poseAfter(state, car, ds) {
  const lane = state.lanes[car.lane];
  let laneId = car.lane;
  let s = car.s + ds;
  if (s > lane.length) {
    laneId = lane.next;
    s += lane.nextS - lane.length;
  }
  const p = lanePose(state.lanes[laneId], s);
  return { kind: car.kind, x: p.x, z: p.z, yaw: p.yaw, y: car.y, lane: laneId, s };
}

// Steps the traffic by dt. `skater` is the skater position [x, y, z] (or
// null). Mutates and returns the state.
export function stepTraffic(state, dt, skater = null) {
  const T = TRAFFIC;
  let minGap = Infinity;
  for (const car of state.cars) {
    const lane = state.lanes[car.lane];
    const size = CAR_SIZE[car.kind];
    const half = size.length / 2;
    const front = car.s + half;
    const v = car.speed;
    const v0 = lane.speed;
    // hold: the car is at a stop point and stays at rest.
    let hold = false;
    // A fixed stop point `dist` m ahead of the front.
    const stopAt = (dist) => {
      if (dist < 0.6 && v < 0.2) hold = true;
      else acc = Math.min(acc, idmStopAccel(v, v0, dist));
    };

    // The car ahead (the IDM leader).
    const lead = leader(state, car);
    let acc = idmAccel(v, v0, lead.gap, v - lead.speed);
    if (lead.speed < 0.1 && lead.gap - T.gap < 0.6 && v < 0.2) hold = true;

    // The stop line, and the intersection.
    const st = lane.stops[car.next];
    if (st) {
      const dist = st.sStop - front;
      if (dist < 0.6 && v < 0.2) {
        // The wait counts from the full stop.
        if (v === 0) car.wait += dt;
        const free = state.occupant[st.box] === -1 || state.occupant[st.box] === car.id;
        // Room past the intersection, so a queue never blocks it.
        const room = lead.gap >= st.sExit - st.sStop + size.length + T.gap;
        // No skater on a crosswalk on the far side.
        const clear = !skaterCrossing(lane, front, st.sExit + 4, skater, car.y);
        if (car.wait >= T.stopWait && free && room && clear) {
          state.occupant[st.box] = car.id;
          car.box = st.box;
          car.boxExit = st.sExit;
          car.next += 1;
          car.wait = 0;
        } else hold = true;
      } else stopAt(dist);
    }

    // Slow to turnSpeed for the U-turn at the end of a two-way street.
    if (!lane.oneway) {
      const toEnd = lane.length - car.s;
      const need = (v * v - T.turnSpeed * T.turnSpeed) / (2 * Math.max(1, toEnd));
      if (need > 0.2) acc = Math.min(acc, -Math.min(T.hardBrake, need));
    }

    // The skater on a crosswalk ahead: stop before it and wait.
    const cw = skaterCrossing(lane, front, front + T.lookAhead, skater, car.y);
    // The skater in the lane ahead: slow, stop, wait, then go on.
    const ahead = skaterAhead(car, skater);
    if (cw || ahead < Infinity) {
      if (cw) stopAt(Math.max(0, cw.s - cw.depth / 2 - T.crossingStop - front));
      if (ahead < Infinity) stopAt(ahead - T.safeRadius - T.yieldMargin);
      if (!car.yielding) {
        state.yields += 1;
        if (cw) state.crossingYields += 1;
      }
      car.yielding = true;
      car.crossing = Boolean(cw) || (car.crossing && car.yielding);
      car.yieldTime = T.yieldWait;
    } else if (car.yieldTime > 0) {
      car.yieldTime = Math.max(0, car.yieldTime - dt);
      if (v < 0.5) hold = true;
      if (car.yieldTime === 0) car.yielding = false;
    } else car.yielding = false;
    if (!car.yielding) car.crossing = false;

    if (hold) acc = -T.hardBrake;
    car.speed = Math.max(0, Math.min(v0, v + acc * dt));
    if (hold && car.speed < 0.3) car.speed = 0;
    car.accel = (car.speed - v) / dt;
    car.brake = brakeLevel(car.accel, car.speed);

    // Never into the car ahead.
    let ds = Math.min(car.speed * dt, Math.max(0, lead.gap - 0.5));

    // The next lane at the end of this one must be free at its start.
    if (car.s + ds > lane.length) {
      const nextLane = state.lanes[lane.next];
      const sNew = car.s + ds - lane.length + lane.nextS;
      const blocked = state.cars.some((o) => o !== car && o.lane === nextLane.id && o.s - CAR_SIZE[o.kind].length / 2 < sNew + half + T.gap && o.s + CAR_SIZE[o.kind].length / 2 > sNew - half - T.gap);
      if (blocked) {
        ds = Math.max(0, lane.length - car.s);
        car.speed = 0;
      }
    }

    // The hard rule: a move never brings the car body nearer than
    // safeRadius to the skater. A shorter move is tried, then none.
    const before = skaterGap(car, skater);
    if (ds > 0 && skater) {
      let ok = false;
      for (let k = 0; k < 4 && !ok; k += 1) {
        const p = poseAfter(state, car, ds);
        const after = skaterGap(p, skater);
        if (after >= T.safeRadius || after >= before) ok = true;
        else ds /= 2;
      }
      if (!ok) {
        ds = 0;
        car.speed = 0;
        car.yieldTime = T.yieldWait;
        car.yielding = true;
      }
    }

    if (ds > 0) {
      let s = car.s + ds;
      let laneId = car.lane;
      // A lane can link to its own start, so a wrap is not a lane change.
      const wrapped = s > lane.length;
      if (wrapped) {
        s += lane.nextS - lane.length;
        laneId = lane.next;
        if (car.box >= 0) {
          state.occupant[car.box] = -1;
          car.box = -1;
        }
      }
      place(state, car, laneId, s, wrapped);
      if (wrapped) car.next = nextStop(state.lanes[laneId], s + half);
    }

    // Out of the intersection: free it.
    if (car.box >= 0 && car.s - half > car.boxExit) {
      state.occupant[car.box] = -1;
      car.box = -1;
    }
    // The turn signal: the heading change over the next signalAhead m
    // (a U-turn at a lane end signals left, as in right-hand traffic).
    const ahead2 = poseAfter(state, car, Math.min(T.signalAhead, state.lanes[car.lane].length - 1));
    let dyaw = angleDelta(car.yaw, ahead2.yaw);
    if (Math.abs(dyaw) > 2.6) dyaw = Math.PI;
    car.signal = turnSignal(dyaw, car.signal);
    minGap = Math.min(minGap, skaterGap(car, skater));
  }
  state.tick += 1;
  state.minSkaterGap = minGap;
  state.closest = Math.min(state.closest, minGap);
  return state;
}

// The nose-up angle of a car (rad) from the street heights under its front
// and its back. heightAt(x, z) gives the street height.
export function carPitch(car, heightAt) {
  const half = CAR_SIZE[car.kind].length * 0.35;
  const fx = Math.cos(car.yaw) * half;
  const fz = -Math.sin(car.yaw) * half;
  const front = heightAt(car.x + fx, car.z + fz);
  const back = heightAt(car.x - fx, car.z - fz);
  return Math.atan2(front - back, 2 * half);
}

// A ground sampler with the cars as solid boxes. The controller treats a
// rise over SKATE.maxStep as a wall, so the skater bonks or slides on a car
// as on a wall. A car more than `headroom` over the skater height `y` (on a
// bridge) is left out. `parked` is a fixed list; `moving()` gives the
// moving cars now.
export function carGroundSampler(sampleGround, parked = [], moving = () => [], { cell = 16, headroom = 2.5 } = {}) {
  const UP = [0, 1, 0];
  const grid = new Map();
  for (const c of parked) {
    const size = CAR_SIZE[c.kind];
    const r = Math.hypot(size.length, size.width) / 2;
    for (let ix = Math.floor((c.x - r) / cell); ix <= Math.floor((c.x + r) / cell); ix += 1) {
      for (let iz = Math.floor((c.z - r) / cell); iz <= Math.floor((c.z + r) / cell); iz += 1) {
        const k = ix * 65536 + iz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(c);
      }
    }
  }
  function top(c, x, z, y) {
    if (c.y > y + headroom) return -Infinity;
    if (Math.abs(x - c.x) > 7 || Math.abs(z - c.z) > 7) return -Infinity;
    if (carBodyDistance(c, x, z) > 0) return -Infinity;
    return c.y + CAR_SIZE[c.kind].height;
  }
  const sample = (x, z, y = Infinity) => {
    const base = sampleGround(x, z, y);
    if (!base) return base;
    let best = base.height;
    let hit = null;
    for (const c of grid.get(Math.floor(x / cell) * 65536 + Math.floor(z / cell)) ?? []) {
      const h = top(c, x, z, y);
      if (h > best) {
        best = h;
        hit = c;
      }
    }
    for (const c of moving()) {
      const h = top(c, x, z, y);
      if (h > best) {
        best = h;
        hit = c;
      }
    }
    return hit ? { height: best, normal: UP, id: `car:${hit.kind}` } : base;
  };
  sample.cellCount = sampleGround.cellCount;
  sample.shapeCount = sampleGround.shapeCount;
  return sample;
}
