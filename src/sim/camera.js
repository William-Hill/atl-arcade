// Follow camera math. Pure: plain arrays, no Three.js.
//
// `cameraGoal` gives the ideal camera pose for a skater pose: behind the
// skater along its heading, above it, looking at a point ahead of it.
// `stepCamera` chases that goal with exponential smoothing on the orbit yaw,
// the position, and the look-at point. The renderer casts a ray from the
// `cameraPivot` (off the surface, never inside geometry) toward the camera;
// `resolveClip` snaps the camera in front of a blocker and eases it back out,
// and `placeCamera` puts it on that ray.
//
// The player look offset (`look`: yaw and pitch, from `stepLook`) turns the
// camera about the skater. After `lookHold` s with no look input, the offset
// goes back to zero, and the camera goes back behind the skater.
//
// On vert (a steep transition, or the air above one) the orbit yaw holds, so
// the camera stays on the street side while the skater flips at the top.

import { CAMERA, SKATE } from "./skate/constants.js";
import { heading } from "./skate/controller.js";
import { TREE_SPECIES, isTreeKind, treeKindFor } from "../level/geo/trees.js";
import { CANOPY_FIT } from "./canopy-fit.js";

export const NO_LOOK = Object.freeze({ yaw: 0, pitch: 0 });

export function createLook() {
  return { yaw: 0, pitch: 0, idle: Infinity };
}

// One frame of the look offset. `delta` is { yaw, pitch } in rad for this
// frame (from mapLook). A zero delta starts the hold, then the return.
export function stepLook(look, delta, dt, k = CAMERA) {
  const dy = delta?.yaw ?? 0;
  const dp = delta?.pitch ?? 0;
  if (dy !== 0 || dp !== 0) {
    const pitch = Math.max(k.minPitch, Math.min(k.maxPitch, look.pitch + dp));
    return { yaw: wrap(look.yaw + dy), pitch, idle: 0 };
  }
  const idle = look.idle + dt;
  if (idle < k.lookHold) return { ...look, idle };
  const f = 1 - smoothFactor(k.lookReturn, dt);
  const yaw = Math.abs(look.yaw * f) < 1e-4 ? 0 : look.yaw * f;
  const pitch = Math.abs(look.pitch * f) < 1e-4 ? 0 : look.pitch * f;
  return { yaw, pitch, idle };
}

// Mouse drag pixels and the right stick to a look delta in rad. Drag or push
// right to look right; drag or push down to raise the camera and look down.
export function mapLook({ dx = 0, dy = 0, stick = [0, 0] } = {}, dt = 0, k = CAMERA) {
  const dead = (v) => {
    if (!Number.isFinite(v) || Math.abs(v) < k.stickDeadzone) return 0;
    return Math.sign(v) * ((Math.abs(v) - k.stickDeadzone) / (1 - k.stickDeadzone));
  };
  const yaw = -dx * k.mouseLookRate - dead(stick[0]) * k.stickLookRate * dt;
  const pitch = dy * k.mouseLookRate + dead(stick[1]) * k.stickLookRate * dt;
  return { yaw: yaw || 0, pitch: pitch || 0 };
}

export function createCameraState(skater, k = CAMERA) {
  const goal = cameraGoal(skater, skater.yaw, k);
  return { yaw: skater.yaw, position: [...goal.position], lookAt: [...goal.lookAt] };
}

function wrap(a) {
  let y = a;
  while (y > Math.PI) y -= 2 * Math.PI;
  while (y < -Math.PI) y += 2 * Math.PI;
  return y;
}

function lerp(a, b, f) {
  return a + (b - a) * f;
}

// Exponential smoothing factor for rate `rate` over `dt`.
// m the camera always keeps in front of a ray hit.
const CLIP_EPSILON = 0.05;

export function smoothFactor(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

export function isVert(skater, k = CAMERA) {
  return Boolean(skater.groundNormal) && skater.groundNormal[1] < k.vertNormalY;
}

// The point the wall ray starts from: lookHeight off the surface along the
// ground normal. On a ramp wall that is a meter out from the wall, not inside it.
export function cameraPivot(skater, k = CAMERA) {
  const n = skater.groundNormal ?? [0, 1, 0];
  const p = skater.position;
  return [p[0] + n[0] * k.lookHeight, p[1] + n[1] * k.lookHeight, p[2] + n[2] * k.lookHeight];
}

// Ideal pose for a skater, using orbit yaw `yaw` (normally the skater yaw).
// The look-ahead leads only by the horizontal velocity along the orbit
// heading, so it never leads into a ramp wall or backward toward the camera.
// `look` turns the camera about the skater: yaw about the vertical, pitch up
// or down from the rest angle at the same range. The look-ahead stays on the
// orbit heading.
export function cameraGoal(skater, yaw, k = CAMERA, look = NO_LOOK) {
  const h = heading(yaw);
  const pullback = Math.min(Math.abs(skater.speed) * k.speedPullback, k.maxPullback);
  const dist = k.distance + pullback;
  const p = skater.position;
  let position;
  if (look.yaw === 0 && look.pitch === 0) {
    position = [p[0] - h[0] * dist, p[1] + k.height, p[2] - h[2] * dist];
  } else {
    const hv = heading(yaw + look.yaw);
    const range = Math.hypot(dist, k.height);
    // Never below the skater's horizon: a full look down keeps the camera
    // at the skater's height, not under the ground.
    const angle = Math.max(0, Math.atan2(k.height, dist) + look.pitch);
    const back = range * Math.cos(angle);
    position = [p[0] - hv[0] * back, p[1] + range * Math.sin(angle), p[2] - hv[2] * back];
  }
  const v = skater.velocity ?? [0, 0, 0];
  const forward = Math.max(0, v[0] * h[0] + v[2] * h[2]);
  const ahead = k.lookAhead * Math.min(forward / SKATE.maxSpeed, 1);
  // The look-ahead leads along the orbit heading (the skater heading plus the
  // look yaw), so a look to the side keeps the skater in the middle.
  const lead = look.yaw === 0 ? h : heading(yaw + look.yaw);
  const lookAt = [p[0] + lead[0] * ahead, p[1] + k.lookHeight, p[2] + lead[2] * ahead];
  return { position, lookAt, distance: dist };
}

export function stepCamera(cam, skater, dt, k = CAMERA, look = NO_LOOK) {
  // Chase the skater yaw by the shortest turn, except on vert, where it holds.
  // The swing is capped at maxYawRate.
  const yawF = isVert(skater, k) ? 0 : smoothFactor(k.yawSmoothing, dt);
  const maxStep = k.maxYawRate * dt;
  const turn = Math.max(-maxStep, Math.min(maxStep, wrap(skater.yaw - cam.yaw) * yawF));
  const yaw = wrap(cam.yaw + turn);
  const goal = cameraGoal(skater, yaw, k, look);
  const pF = smoothFactor(k.positionSmoothing, dt);
  const lF = smoothFactor(k.lookSmoothing, dt);
  return {
    yaw,
    position: [0, 1, 2].map((i) => lerp(cam.position[i], goal.position[i], pF)),
    lookAt: [0, 1, 2].map((i) => lerp(cam.lookAt[i], goal.lookAt[i], lF)),
  };
}

// The allowed camera distance from the pivot this frame. `prevAllowed` is
// last frame's value (Infinity at start), `fullLength` the unclipped pivot
// to camera distance, `hitDistance` the ray hit (Infinity for none). A new
// blocker snaps the camera in at once so it never shows through a wall; a
// cleared blocker lets it ease back out at `clipRelease`.
// The wall always wins over the preferred `minDistance`: the camera never
// goes past the hit point.
export function resolveClip(prevAllowed, fullLength, hitDistance, dt, k = CAMERA) {
  const inFront = Math.max(0, hitDistance - CLIP_EPSILON);
  const target = hitDistance < fullLength ? Math.min(inFront, Math.max(k.minDistance, hitDistance - k.clipMargin)) : fullLength;
  if (!Number.isFinite(prevAllowed) || target <= prevAllowed) return target;
  return prevAllowed + (target - prevAllowed) * smoothFactor(k.clipRelease, dt);
}

// The camera on the ray from `pivot` toward the smoothed position, at most
// `allowed` meters from the pivot.
export function placeCamera(cam, pivot, allowed) {
  const d = [0, 1, 2].map((i) => cam.position[i] - pivot[i]);
  const len = Math.hypot(d[0], d[1], d[2]);
  if (!(allowed < len) || len < 1e-9) return cam;
  const f = allowed / len;
  return { ...cam, position: [0, 1, 2].map((i) => pivot[i] + d[i] * f) };
}

// --- Tree canopies (#230) -----------------------------------------------
//
// The wall ray hits the Rapier colliders, and the trees have none (a skater
// rides under a crown). So the camera also casts its ray against a simple
// volume for each tree: an ellipsoid around the crown and an upright
// cylinder around the trunk. A volume on the ray from the pivot to the
// camera counts as a wall hit, so `resolveClip` pulls the camera in front of
// the crown and eases it back out after the tree. The tree meshes do not
// change.
//
// The crown sizes come from CANOPY_FIT (src/sim/canopy-fit.js): for each
// species and variant, the smallest crown ellipsoid that holds both tree
// meshes of that variant, the procedural tree (src/level/geo/trees.js, with
// its `grow` scale and crown offset) and the Blender GLB tree of the pbr look
// (assets/trees). scripts/canopy-fit.mjs makes the table with fitCrown().
// The ellipsoid is round about the trunk, so the placement yaw does not
// change it. The size is times the placement scale. A pivot inside a volume
// ignores that volume: the camera cannot help there, and a hit at 0 would
// put the camera on the skater.


// The species and variant of a tree placement, as the render picks them.
function speciesOf(p) {
  const [, species, variant] = treeKindFor(p).split(":");
  return { species: p.species && TREE_SPECIES[p.species] ? p.species : species, variant: Number(variant) };
}

// Pure: the smallest upright crown ellipsoid, round about the trunk axis,
// that holds every point at or over `bottom`. `meshes`: flat [x, y, z, ...]
// position arrays in the template space. The ellipsoid bottom stays at most
// `drop` m under `bottom`. `pad` makes it a little larger. Returns
// { y, h, reach } in m: the center height, the half height and the radius,
// or null when no point is at or over `bottom`.
export function fitCrown(meshes, bottom, { drop = 1, pad = 0.02, steps = 48 } = {}) {
  const ys = [];
  const rs = [];
  let top = -Infinity;
  for (const P of meshes) {
    for (let i = 0; i < P.length; i += 3) {
      if (P[i + 1] < bottom) continue;
      ys.push(P[i + 1]);
      rs.push(Math.hypot(P[i], P[i + 2]));
      top = Math.max(top, P[i + 1]);
    }
  }
  if (!ys.length) return null;
  let best = null;
  for (let a = 0; a <= steps; a += 1) {
    const y = bottom + ((top - bottom) * a) / steps;
    const need = Math.max(top - y, y - bottom, 1e-3);
    for (let b = 1; b <= steps; b += 1) {
      const h = need * (1 + (b / steps) * 1.5);
      if (y - h < bottom - drop) break;
      let reach = 0;
      for (let i = 0; i < ys.length; i += 1) {
        const t = (ys[i] - y) / h;
        reach = Math.max(reach, rs[i] / Math.sqrt(1 - t * t));
      }
      const cost = reach * reach * h;
      if (!best || cost < best.cost) best = { y, h, reach, cost };
    }
  }
  if (!best) {
    // No ellipsoid fits over `bottom - drop`: a sphere around the points.
    const y = (top + bottom) / 2;
    const h = (top - bottom) / 2 + drop;
    best = { y, h, reach: Math.max(...rs.map((r, i) => r / Math.sqrt(1 - ((ys[i] - y) / h) ** 2))) };
  }
  const k = 1 + pad;
  return { y: best.y, h: best.h * k, reach: best.reach * k };
}

// Pure: the canopy volume of one tree at a placement, or null for a prop
// that is not a tree. { crown: { center, radii }, trunk: { x, z, r, y0, y1 } }
// in world meters.
export function treeVolume(p) {
  if (!isTreeKind(p.kind) && !p.species) return null;
  const { species, variant } = speciesOf(p);
  const sp = TREE_SPECIES[species];
  const fit = CANOPY_FIT[species]?.[variant];
  if (!sp || !fit) return null;
  const s = p.scale ?? 1;
  const y = p.y ?? 0;
  const reach = fit.reach * s;
  const half = fit.h * s;
  const center = y + fit.y * s;
  // A leaning trunk (the crape myrtle) gets a wider cylinder.
  const trunkR = (sp.trunk.radius + sp.trunk.lean * sp.trunk.height * 0.5) * s;
  return {
    crown: { center: [p.x, center, p.z], radii: [reach, half, reach] },
    trunk: { x: p.x, z: p.z, r: trunkR, y0: y, y1: center },
  };
}

// Pure: the canopy volumes of a level's props.
export function canopyVolumes(props) {
  const out = [];
  for (const p of props ?? []) {
    const v = treeVolume(p);
    if (v) out.push(v);
  }
  return out;
}

function insideCrown(c, q) {
  const dx = (q[0] - c.center[0]) / c.radii[0];
  const dy = (q[1] - c.center[1]) / c.radii[1];
  const dz = (q[2] - c.center[2]) / c.radii[2];
  return dx * dx + dy * dy + dz * dz < 1;
}

function insideTrunk(t, q) {
  return q[1] >= t.y0 && q[1] <= t.y1 && Math.hypot(q[0] - t.x, q[2] - t.z) < t.r;
}

// Pure: is the point `q` inside the crown or the trunk of a volume.
export function insideVolume(v, q) {
  return insideCrown(v.crown, q) || insideTrunk(v.trunk, q);
}

// Entry distance along the unit ray (o, d) into the crown ellipsoid, or
// Infinity. Scaled to a unit sphere.
function crownEntry(c, o, d) {
  const ox = (o[0] - c.center[0]) / c.radii[0];
  const oy = (o[1] - c.center[1]) / c.radii[1];
  const oz = (o[2] - c.center[2]) / c.radii[2];
  const dx = d[0] / c.radii[0];
  const dy = d[1] / c.radii[1];
  const dz = d[2] / c.radii[2];
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const cc = ox * ox + oy * oy + oz * oz - 1;
  const disc = b * b - 4 * a * cc;
  if (disc < 0 || a < 1e-12) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 ? t : Infinity;
}

// Entry distance along the unit ray (o, d) into the trunk cylinder, or
// Infinity: the side wall, or the top cap from above.
function trunkEntry(t, o, d) {
  let best = Infinity;
  const ox = o[0] - t.x;
  const oz = o[2] - t.z;
  const a = d[0] * d[0] + d[2] * d[2];
  if (a > 1e-12) {
    const b = 2 * (ox * d[0] + oz * d[2]);
    const c = ox * ox + oz * oz - t.r * t.r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = (-b - Math.sqrt(disc)) / (2 * a);
      const y = o[1] + d[1] * s;
      if (s >= 0 && y >= t.y0 && y <= t.y1) best = s;
    }
  }
  if (Math.abs(d[1]) > 1e-12) {
    for (let k = 0; k < 2; k += 1) {
      const s = ((k === 0 ? t.y0 : t.y1) - o[1]) / d[1];
      if (s >= 0 && s < best && Math.hypot(ox + d[0] * s, oz + d[2] * s) <= t.r) best = s;
    }
  }
  return best;
}

// The unit ray direction of canopyDistance, reused each call.
const RAY_DIR = [0, 0, 0];

// Pure: the distance from `from` toward `to` to the first canopy volume on
// the segment, or Infinity. Like the wall ray's hit distance. A volume
// that holds `from` is skipped.
export function canopyDistance(from, to, volumes) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return Infinity;
  // A reused unit vector: this runs each frame.
  const u = RAY_DIR;
  u[0] = dx / len;
  u[1] = dy / len;
  u[2] = dz / len;
  let best = Infinity;
  for (let i = 0; i < volumes.length; i += 1) {
    const v = volumes[i];
    if (insideVolume(v, from)) continue;
    const t = Math.min(crownEntry(v.crown, from, u), trunkEntry(v.trunk, from, u));
    if (t < best) best = t;
  }
  return best <= len ? best : Infinity;
}

// Pure: a grid of canopy volumes for fast segment queries. `cell` in m.
// `distance(from, to)` is canopyDistance over the volumes near the segment;
// `inside(q)` says if a point is in any volume. `near()` gives a new array
// (for tests and debug). `distance` and `inside` run each frame, so they
// use numeric cell keys and reuse one list and one stamp per volume: no
// new Set, array or string per query.
export function createCanopyIndex(volumes, cell = 16) {
  const grid = new Map();
  // A numeric key for a cell. The 2^21 span holds +/- 16,000 km of 16 m cells.
  const SPAN = 2097152;
  const keyOf = (ix, iz) => (ix + SPAN / 2) * SPAN + (iz + SPAN / 2);
  volumes.forEach((v, i) => {
    const r = Math.max(v.crown.radii[0], v.crown.radii[2], v.trunk.r);
    for (let ix = Math.floor((v.crown.center[0] - r) / cell); ix <= Math.floor((v.crown.center[0] + r) / cell); ix += 1) {
      for (let iz = Math.floor((v.crown.center[2] - r) / cell); iz <= Math.floor((v.crown.center[2] + r) / cell); iz += 1) {
        const k = keyOf(ix, iz);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(i);
      }
    }
  });
  // The query stamp of each volume: a volume is in the list once per query.
  const stamps = new Uint32Array(volumes.length);
  let stamp = 0;
  const found = [];
  // Fills `found` with the volumes in the cells of the box. Returns its length.
  function collect(minX, minZ, maxX, maxZ) {
    found.length = 0;
    stamp += 1;
    if (stamp === 0xffffffff) {
      stamps.fill(0);
      stamp = 1;
    }
    const x1 = Math.floor(maxX / cell);
    const z0 = Math.floor(minZ / cell);
    const z1 = Math.floor(maxZ / cell);
    for (let ix = Math.floor(minX / cell); ix <= x1; ix += 1) {
      for (let iz = z0; iz <= z1; iz += 1) {
        const list = grid.get(keyOf(ix, iz));
        if (!list) continue;
        for (let j = 0; j < list.length; j += 1) {
          const i = list[j];
          if (stamps[i] === stamp) continue;
          stamps[i] = stamp;
          found.push(volumes[i]);
        }
      }
    }
    return found.length;
  }
  return {
    count: volumes.length,
    near(minX, minZ, maxX, maxZ) {
      collect(minX, minZ, maxX, maxZ);
      return found.slice();
    },
    distance(from, to) {
      if (!collect(Math.min(from[0], to[0]), Math.min(from[2], to[2]), Math.max(from[0], to[0]), Math.max(from[2], to[2]))) return Infinity;
      return canopyDistance(from, to, found);
    },
    inside(q) {
      collect(q[0], q[2], q[0], q[2]);
      for (let i = 0; i < found.length; i += 1) if (insideVolume(found[i], q)) return true;
      return false;
    },
  };
}
