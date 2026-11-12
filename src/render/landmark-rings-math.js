// Challenge rings (#219): the pure part. No Three.js, no DOM.
//
// Design: design/gdd/landmark-discovery.md, "Visual/Audio Requirements",
// World markers. A Found spot that is not Claimed gets a flat ring on the
// ground at its challenge zone. The type reads by SHAPE, not by color:
//   gap   = a full circle
//   grind = a dashed circle
//   line  = a numbered ring at each checkpoint (1, 2, 3)
//   combo = a double ring
// Every ring has the landmark gold and an ink outline. No red, no stripes.

export const RINGS = {
  width: 0.15, // m, the gold band (GDD)
  ink: 0.04, // m, the ink line on each side of the band
  farWidth: 0.007, // m of band (with its ink) per meter of distance: past 33 m the band grows, to 4 times at most
  gold: "#ffd166", // the landmark gold
  inkColor: "#0b0b12",
  lift: 0.1, // m over the ground
  samples: 16, // ground heights around a ring
  reach: 1.2, // m: a ground sample this far over or under the center is off the zone's level (a roof, a road under a bridge)
  dash: 1.4, // m, the length of a dash; the space after it is 40% of the pair
  inner: 0.78, // the inner ring of the double ring, as a share of the radius
  digit: { size: 0.9, lift: 1.7 }, // m: the half height of a checkpoint number, and its center over the ground
  passed: 0.35, // the alpha of a checkpoint the skater has passed in this attempt
  // The pbr look: the ring is an emissive overlay. By day 0.8, under the day
  // bloom threshold (2.4). At night the core is 1.6 (over the night
  // threshold, 0.92) and the rest stays at 0.8, on the high tier only: it is
  // the only tier with bloom.
  emissive: { rest: 0.8, nightCore: 1.6 },
  // The slow scale pulse: off on the low tier and with reduced motion.
  pulse: { low: null, phone: { amp: 0.02, period: 3.2 }, high: { amp: 0.03, period: 2.4 } },
  // A claim: the ring turns all gold (no ink, no dashes), grows a little and
  // fades. With reduced motion it only fades, in 0.3 s.
  claim: { time: 0.5, grow: 0.12, reducedTime: 0.3 },
  // The fade cone over a ring, high tier only (1 more draw call).
  cone: { height: 3, alpha: 0.2 },
  // The atlas: 6 square cells in a row.
  cells: { solid: 0, dash: 1, digit: 2, cone: 5, count: 6 },
};

export const RING_SHAPES = { gap: 0, grind: 1, line: 2, combo: 3 };

const clamp01 = (t) => Math.min(1, Math.max(0, t));

// The emissive values of the ring material: { rest, core }. The toon look
// is flat and unlit (1 and 1). `night` is 0 by day and 1 at night.
export function ringEmissive({ look = "toon", night = 0, tier = "high" } = {}, k = RINGS) {
  if (look !== "pbr") return { rest: 1, core: 1 };
  const core = tier === "high" ? k.emissive.rest + (k.emissive.nightCore - k.emissive.rest) * clamp01(night) : k.emissive.rest;
  return { rest: k.emissive.rest, core };
}

// The radius factor of the pulse at time `t` (s).
export function ringPulse(tier, t, reducedMotion = false, k = RINGS) {
  const p = k.pulse[tier];
  if (!p || reducedMotion) return 1;
  return 1 + p.amp * Math.sin((2 * Math.PI * t) / p.period);
}

// The ring of a claimed spot, `age` seconds after the claim:
// { alpha, fill, scale, done }.
export function claimFade(age, reducedMotion = false, k = RINGS) {
  const time = reducedMotion ? k.claim.reducedTime : k.claim.time;
  const t = clamp01(age / time);
  return { alpha: 1 - t, fill: reducedMotion ? 0 : 1, scale: reducedMotion ? 1 : 1 + k.claim.grow * t, done: age >= time };
}

// The count of dashes on a ring of radius `r`: a whole number, 8 or more.
export function dashCount(r, k = RINGS) {
  return Math.max(8, Math.round((2 * Math.PI * r) / (k.dash / 0.6)));
}

// The rings to draw, from landmarkView().spots. A spot has rings when it is
// Found and not Claimed (`ring`), in a timed run only: a free run has no
// claims and shows no ring. Each ring is
// { key, id, shape, x, z, r, digit, dashes, alpha }.
export function ringList(spots, { timed = true } = {}, k = RINGS) {
  if (!timed) return [];
  const out = [];
  for (const s of spots) {
    if (!s.ring || !s.challenge) continue;
    const c = s.challenge;
    const shape = RING_SHAPES[c.type];
    if (shape === undefined) continue;
    if (c.type === "line") {
      c.checkpoints.forEach(([x, z], i) => {
        const passed = s.attempt ? i < s.attempt.next : false;
        out.push({ key: `${s.id}:${i}`, id: s.id, shape, x, z, r: c.r, digit: i, dashes: 1, alpha: passed ? k.passed : 1 });
      });
    } else {
      out.push({ key: s.id, id: s.id, shape, x: c.zone.x, z: c.zone.z, r: c.zone.r, digit: 0, dashes: c.type === "grind" ? dashCount(c.zone.r, k) : 1, alpha: 1 });
    }
  }
  return out;
}

// The most rings a spot list can show at once (the instance capacity).
export function ringCapacity(spots) {
  return spots.reduce((n, s) => n + (s.challenge ? (s.challenge.type === "line" ? s.challenge.checkpoints.length : 1) : 0), 0);
}

// The ground under a ring: the center height and `samples` heights around
// the circle, relative to the center. `groundAt(x, z, y)` gives the ground
// height near the height y, or null. A sample that is off the level of the
// zone (more than `reach` from the center height) or missing takes the mean
// of its 2 nearest good neighbors, so the ring does not climb a wall or
// drop off a bridge.
export function ringGround({ x, z, r }, center, groundAt, k = RINGS) {
  const n = k.samples;
  const raw = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * 2 * Math.PI;
    const h = groundAt(x + Math.cos(a) * r, z + Math.sin(a) * r, center + k.reach);
    raw.push(h != null && Number.isFinite(h) && Math.abs(h - center) <= k.reach ? h - center : null);
  }
  if (raw.every((h) => h === null)) return { y: center, heights: raw.map(() => 0) };
  const heights = raw.map((h, i) => {
    if (h !== null) return h;
    let before = null;
    let after = null;
    for (let d = 1; d < n && (before === null || after === null); d += 1) {
      if (before === null && raw[(i - d + n) % n] !== null) before = raw[(i - d + n) % n];
      if (after === null && raw[(i + d) % n] !== null) after = raw[(i + d) % n];
    }
    return ((before ?? after) + (after ?? before)) / 2;
  });
  return { y: center, heights };
}

// True for a color that reads as red or as a warning: a hue within 20
// degrees of red, with a strong saturation. For the checks of the ring and
// banner colors (GDD, Political rules; S-4). r, g, b are 0 to 255.
export function isRed(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (max < 90 || d / max < 0.5) return false;
  let hue;
  if (max === r) hue = ((g - b) / d) * 60;
  else if (max === g) hue = 120 + ((b - r) / d) * 60;
  else hue = 240 + ((r - g) / d) * 60;
  if (hue < 0) hue += 360;
  return hue <= 20 || hue >= 340;
}
