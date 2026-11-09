// Game feel (#105): the pure part. No Three.js and no Web Audio here.
//
// The feedback reads the flags of the pure skate controller (`bonked`,
// `wallSlide`, `justLanded`, `speed`, `velocity`, `airTime`). It never
// changes the controller. The comic effects (fx.js, #113) already give the
// speed lines, the impact frames and the grind and beat bursts; this module
// adds:
// - a short camera shake on a bonk (follow-camera.js);
// - a wider camera field of view at high speed (follow-camera.js);
// - a dust puff on a landing, bigger for a higher fall (effects-view.js);
// - sparks while the skater slides along a wall (effects-view.js);
// - the sound levels for the bonk, the landing and the scrape
//   (src/audio/sfx.js reads them).
//
// Real skaters must review all of this tuning (AGENTS.md).

// Speeds in m/s, times in s, angles in rad, the field of view in degrees.
export const FEEL = {
  // The controller's arcade gravity (src/sim/skate/constants.js), for the
  // fall height from the fall speed.
  gravity: 20,
  // A bonk under `minSpeed` (a push into a wall from rest) gives no shake.
  // The shake is full at `fullSpeed`. `amp` is the peak rotation.
  shake: { minSpeed: 1.5, fullSpeed: 11, amp: 0.022, duration: 0.3, freq: 23 },
  // The field of view opens by up to `boost` degrees between `start` and
  // `full` (the speed lines start at 9.5 and are full at 13).
  fov: { start: 8, full: 13, boost: 7, attack: 0.5, release: 0.9 },
  // A landing from a fall under `minFall` m/s makes no dust; the puff is
  // full at `fullFall` m/s (about 2 m of fall at gravity 20).
  dust: { minFall: 2.5, fullFall: 9, life: 0.65, size: [0.32, 0.75], spread: [0.8, 2.8], opacity: 0.8 },
  // A slide under `minSpeed` makes no sparks.
  sparks: { minSpeed: 2, life: 0.28, size: 0.2, speed: [2.5, 5], gravity: 9 },
};

// The dust color (linear, under the night bloom threshold of 0.92): a warm
// light concrete. The spark color: a hot orange, also under 0.92, so it does
// not bloom on its own.
export const DUST_COLOR = [0.58, 0.54, 0.49];
export const SPARK_COLOR = [0.91, 0.55, 0.08];

const clamp01 = (t) => Math.min(1, Math.max(0, t));

// Pure: the policy of the camera motion (shake and field of view).
// prefers-reduced-motion and ?fx=0 turn it off on every tier. It has no
// render cost, so the low tier keeps it.
export function motionPolicy({ reducedMotion = false, off = false } = {}) {
  const on = !reducedMotion && !off;
  return { shake: on, fov: on };
}

// Pure: the fall at a touchdown, from the skater before the landing tick.
// Returns the fall speed (m/s) and the height of a free fall at that speed.
export function landFall(prev, k = FEEL) {
  const speed = Math.max(0, -(prev?.velocity?.[1] ?? 0));
  return { speed, height: (speed * speed) / (2 * k.gravity) };
}

// Pure: the feedback one simulation tick asks for, from the skater before
// and after the tick. Returns { bonk, land, slide }:
// - bonk: the strength 0..1 of the hit (0: no bonk or too slow);
// - land: null, or { speed, height, strength } of the fall (strength 0..1
//   for the dust; a soft landing has strength 0 but still has a sound);
// - slide: null, or { speed, strength } while the skater slides on a wall.
export function feelTriggers(prev, next, k = FEEL) {
  const out = { bonk: 0, land: null, slide: null };
  if (!prev || !next) return out;
  if (next.bonked) {
    const v = Math.abs(prev.speed ?? 0);
    if (v >= k.shake.minSpeed) out.bonk = clamp01(0.35 + (0.65 * (v - k.shake.minSpeed)) / (k.shake.fullSpeed - k.shake.minSpeed));
  }
  if (next.justLanded) {
    const f = landFall(prev, k);
    out.land = { ...f, strength: clamp01((f.speed - k.dust.minFall) / (k.dust.fullFall - k.dust.minFall)) };
  }
  if (next.wallSlide) {
    const v = Math.abs(next.speed ?? 0);
    out.slide = { speed: v, strength: clamp01((v - k.sparks.minSpeed) / 8) };
  }
  return out;
}

// Pure: the shake state. `amp` is the start amplitude (rad), `t` the age.
export function createShake() {
  return { t: 0, amp: 0, seq: 0 };
}

// Pure: start a shake of strength 0..1. A weaker hit during a stronger
// shake does not cut it.
export function startShake(shake, strength, k = FEEL) {
  if (strength <= 0) return shake;
  const left = shakeEnvelope(shake, k) * shake.amp;
  const amp = k.shake.amp * clamp01(strength);
  if (amp <= left) return shake;
  return { t: 0, amp, seq: shake.seq + 1 };
}

// Pure: age the shake. A finished shake goes back to amplitude 0, so an
// idle camera makes no new state each frame.
export function stepShake(shake, dt, k = FEEL) {
  if (shake.amp <= 0) return shake;
  const t = shake.t + dt;
  return t >= k.shake.duration ? { t: 0, amp: 0, seq: shake.seq } : { ...shake, t };
}

// Pure: the decay of the shake, 1 at the start and 0 at the end.
export function shakeEnvelope(shake, k = FEEL) {
  if (shake.amp <= 0) return 0;
  const u = shake.t / k.shake.duration;
  return u >= 1 ? 0 : (1 - u) * (1 - u);
}

const NO_SHAKE = Object.freeze({ pitch: 0, yaw: 0, roll: 0 });

// Pure: the camera rotation of the shake now, in rad: { pitch, yaw, roll }.
// Three sines at unrelated rates, so the motion does not read as a wobble.
// The same state gives the same angles (a screenshot is stable).
export function shakeAngles(shake, k = FEEL) {
  const e = shakeEnvelope(shake, k) * shake.amp;
  if (e === 0) return NO_SHAKE;
  const w = 2 * Math.PI * k.shake.freq * shake.t;
  // Each new shake starts at another phase; the first at phase 0.
  const p = Math.max(0, shake.seq - 1) * 1.7;
  return { pitch: e * Math.sin(w + p), yaw: 0.6 * e * Math.sin(1.37 * w + 2.1 + p), roll: 0.8 * e * Math.sin(0.71 * w + 4.2 + p) };
}

// Pure: the field-of-view boost (deg) for a skater speed.
export function fovTarget(speed, k = FEEL) {
  return k.fov.boost * clamp01((Math.abs(speed) - k.fov.start) / (k.fov.full - k.fov.start));
}

// Pure: move the boost toward the target. The boost opens over `attack` s
// and closes over `release` s (from 0 to the full boost).
export function stepFov(boost, target, dt, k = FEEL) {
  const rate = (target > boost ? k.fov.boost / k.fov.attack : k.fov.boost / k.fov.release) * dt;
  return target > boost ? Math.min(target, boost + rate) : Math.max(target, boost - rate);
}

// A small hash to [0, 1), so the particles are the same for the same tick.
function rand(a, b) {
  let h = Math.imul((a | 0) ^ 0x2545f491, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// Pure: the dust puff of a landing. `count` is the tier's puff count;
// `strength` 0..1 from feelTriggers(). Returns particle specs for
// fx.js addBurst(): soft puffs that go out along the ground and slow down.
export function dustSpecs(position, strength, count, seed = 0, k = FEEL) {
  if (!count || strength <= 0) return [];
  const n = Math.max(2, Math.round(count * (0.4 + 0.6 * strength)));
  const D = k.dust;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = ((i + 0.6 * rand(seed, i)) / n) * Math.PI * 2;
    const v = D.spread[0] + (D.spread[1] - D.spread[0]) * strength * (0.6 + 0.4 * rand(seed, i + 50));
    out.push({
      position: [position[0] + Math.cos(a) * 0.25, position[1] + 0.12, position[2] + Math.sin(a) * 0.25],
      velocity: [Math.cos(a) * v, 0.5 + 0.6 * strength, Math.sin(a) * v],
      // A small upward drag in place of air drag: the puffs rise and stop.
      gravity: 1.5,
      shape: "puff",
      color: DUST_COLOR,
      size: D.size[0] + (D.size[1] - D.size[0]) * strength,
      life: D.life * (0.8 + 0.4 * rand(seed, i + 90)),
      opacity: D.opacity,
      rotation: rand(seed, i + 7) * Math.PI,
    });
  }
  return out;
}

// Pure: the sparks of one slide tick. `count` is the tier's sparks per
// tick, `heading` the skater's motion direction [x, z] (unit). The sparks
// leave the skates backward and up, with a spread to the sides.
export function sparkSpecs(position, heading, strength, count, tick = 0, k = FEEL) {
  if (!count || strength <= 0) return [];
  const S = k.sparks;
  const out = [];
  const [hx, hz] = heading;
  for (let i = 0; i < count; i += 1) {
    const side = rand(tick, i) * 2 - 1;
    const v = S.speed[0] + (S.speed[1] - S.speed[0]) * rand(tick, i + 31) * (0.5 + 0.5 * strength);
    // Back along the heading, a side part, and up.
    const bx = -hx + -hz * side * 0.8;
    const bz = -hz + hx * side * 0.8;
    const n = Math.hypot(bx, bz) || 1;
    out.push({
      position: [position[0] + hz * side * 0.15, position[1] + 0.08, position[2] - hx * side * 0.15],
      velocity: [(bx / n) * v, 1.2 + 2.2 * rand(tick, i + 63), (bz / n) * v],
      gravity: S.gravity,
      shape: "spark",
      color: SPARK_COLOR,
      size: S.size * (0.7 + 0.6 * rand(tick, i + 17)),
      life: S.life * (0.7 + 0.6 * rand(tick, i + 5)),
      rotation: rand(tick, i + 11) * Math.PI,
    });
  }
  return out;
}
