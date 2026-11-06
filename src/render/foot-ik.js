// Foot IK (#107): the skates touch stairs and ramps. Pure: no Three.js.
// Points are [x, y, z] arrays in world space.
//
// The renderer does this each frame, after the clips:
// 1. planFeet() samples the ground under each skate (the ankle and the toe)
//    and gives the height offset of each foot from the ground under the
//    skater center, and the pelvis offset.
// 2. It moves the hips by the pelvis offset, so the lower foot can reach.
// 3. solveTwoBone() bends each leg (thigh and shin) so the ankle reaches
//    its target. The knee stays in the plane of the clip pose.
// 4. It tilts each foot toward the ground normal.
//
// The rig bones are found by name (legBoneNames), not by the bone data of
// the current clips, so new clip GLBs (#170) work the same way.

export const FOOT_IK = {
  maxDrop: 0.3, // m the pelvis can go down.
  maxRise: 0.3, // m a foot can go up.
  maxTilt: 0.6, // rad (34 degrees) of foot tilt toward the ground normal.
  fadeIn: 0.15, // s for the IK weight 0 -> 1 (after a landing).
  fadeOut: 0.06, // s for the IK weight 1 -> 0 (a jump, a rail).
  probeUp: 0.6, // m above the skater for the ground probe (bridges).
};

// The leg bones of a rig, by name. Mixamo names match with any prefix
// (GLTFLoader makes "mixamorig:LeftUpLeg" into "mixamorigLeftUpLeg"), and
// Blender names ("thigh.L", "thighL") match too.
const PATTERNS = {
  hips: [/hips$/i, /pelvis$/i],
  upLeg: [/(left|right)upleg$/i, /thigh[._]?[lr]$/i],
  leg: [/(left|right)leg$/i, /(shin|calf)[._]?[lr]$/i],
  foot: [/(left|right)foot$/i, /foot[._]?[lr]$/i],
  toe: [/(left|right)toebase$/i, /toe[._]?[lr]$/i],
};

function sideOf(name) {
  const m = /(left|right)[a-z]*$/i.exec(name);
  if (m) return m[1].toLowerCase();
  if (/l$/i.test(name)) return "left";
  if (/r$/i.test(name)) return "right";
  return null;
}

// Pure: from a list of bone names, the names of the hips and of each leg
// chain, or null when a part is missing.
export function legBoneNames(names) {
  const find = (kind, side) =>
    names.find((n) => PATTERNS[kind].some((p) => p.test(n)) && (side === null || sideOf(n) === side)) ?? null;
  const hips = find("hips", null);
  const legs = {};
  for (const side of ["left", "right"]) {
    const leg = { upLeg: find("upLeg", side), leg: find("leg", side), foot: find("foot", side), toe: find("toe", side) };
    if (!leg.upLeg || !leg.leg || !leg.foot) return null;
    legs[side] = leg;
  }
  return hips ? { hips, left: legs.left, right: legs.right } : null;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : [0, 0, 0];
};
export const distance = (a, b) => len(sub(a, b));

// Two-bone IK. hip, knee, ankle: the current joint positions. target: where
// the ankle must go. pole: a point on the side of the knee bend (the current
// knee keeps the bend plane of the clip). Returns the new knee and ankle.
// The bone lengths do not change. A target out of reach gives a straight
// leg toward it.
export function solveTwoBone(hip, knee, ankle, target, pole = knee) {
  const l1 = distance(hip, knee);
  const l2 = distance(knee, ankle);
  const toT = sub(target, hip);
  let d = len(toT);
  const dir = d > 1e-9 ? mul(toT, 1 / d) : norm(sub(ankle, hip));
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-6), (l1 + l2) * 0.9999);
  const newAnkle = add(hip, mul(dir, d));
  // The knee: x along the hip-ankle line, h off it toward the pole.
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - x * x, 0));
  const p = sub(pole, hip);
  let side = sub(p, mul(dir, dot(p, dir)));
  if (len(side) < 1e-6) {
    // The pole is on the line: bend forward of any axis.
    side = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    side = sub(side, mul(dir, dot(side, dir)));
  }
  const newKnee = add(add(hip, mul(dir, x)), mul(norm(side), h));
  return { knee: newKnee, ankle: newAnkle };
}

// The ground under one skate: the higher of the ankle and toe samples, so a
// skate across a stair edge sits on the step nose.
function footGround(foot, sample, probeY) {
  let best = null;
  for (const p of [foot.ankle, foot.toe ?? foot.ankle]) {
    const g = sample(p[0], p[2], probeY);
    if (g && Number.isFinite(g.height) && (!best || g.height > best.height)) best = g;
  }
  return best;
}

// The foot plan for one frame.
// rootY: the ground height under the skater center (the controller
// position). feet: { left: { ankle, toe }, right: { ankle, toe } } from the
// clip pose. sample(x, z, y): the level ground sampler. weight: the IK
// weight (0 to 1).
// Returns { pelvis, left, right }: the pelvis y offset, and for each foot
// its ankle target, its ground normal, and its tilt (footTilt).
export function planFeet({ rootY, feet, sample, weight = 1 }, k = FOOT_IK) {
  const out = { pelvis: 0 };
  const offsets = {};
  for (const side of ["left", "right"]) {
    const f = feet[side];
    const g = sample ? footGround(f, sample, rootY + k.probeUp) : null;
    const raw = g ? g.height - rootY : 0;
    offsets[side] = Math.max(-k.maxDrop, Math.min(k.maxRise, raw)) * weight;
    out[side] = { offset: offsets[side], normal: g?.normal ?? [0, 1, 0], ankle: f.ankle };
  }
  // The pelvis goes down with the lower foot, so that leg can reach. It does
  // not go up: a foot above the center bends its knee.
  out.pelvis = Math.min(0, offsets.left, offsets.right);
  for (const side of ["left", "right"]) {
    const a = out[side].ankle;
    // A skate tilted on a slope (angle t) holds its ankle h / cos(t) above
    // the ground under the ankle, not h.
    const tilt = footTilt(out[side].normal, weight, k);
    const h = Math.max(0, a[1] - rootY);
    const lift = h * (1 / Math.cos(tilt.angle) - 1);
    out[side].tilt = tilt;
    out[side].target = [a[0], a[1] + offsets[side] + lift, a[2]];
  }
  return out;
}

// The foot tilt toward the ground normal: the angle (rad) and the axis of
// the rotation from up to the normal, scaled by the weight and limited.
export function footTilt(normal, weight = 1, k = FOOT_IK) {
  const n = norm(normal);
  const angle = Math.min(Math.acos(Math.max(-1, Math.min(1, n[1]))), k.maxTilt) * weight;
  // axis = up x n = (n.z, 0, -n.x)
  const axis = norm([n[2], 0, -n[0]]);
  return len(axis) > 0 ? { angle, axis } : { angle: 0, axis: [1, 0, 0] };
}

// True when the skates are on the ground: IK on. Air, rails, and bails turn
// it off.
export function ikWanted(state, clip) {
  if (!state || state.state !== "rolling") return false;
  return clip !== "bail" && clip !== "jump";
}

// Moves the IK weight toward 0 or 1 at the fade rates.
export function stepIkWeight(current, wanted, dt, k = FOOT_IK) {
  if (!(dt > 0)) return current;
  if (wanted) return Math.min(1, current + dt / k.fadeIn);
  return Math.max(0, current - dt / k.fadeOut);
}
