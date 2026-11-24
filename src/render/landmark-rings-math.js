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
  // An area zone (#365, the skatepark pad plus its margin) draws as a
  // rounded rectangle: the zone edge itself (the corner radius is the margin,
  // at least `rectCorner`). The inner line of the double outline is `rectInset`
  // m inside it.
  rectCorner: 0.5, // m
  rectInset: 1.0, // m
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

// The rectangle of an area zone (#365): the outline `outer` ([[x, z]], a
// rectangle such as a skatepark pad) plus `margin` m. The long axis is the
// direction of the longest edge. Returns { x, z, angle, hu, hv, corner }:
// the center, the turn about +y (three.js makeRotationY: local +x goes to
// (cos, -sin)), the half length and half width with the margin, and the
// corner radius (the margin).
export function areaRect(outer, margin = 0, k = RINGS) {
  let best = null;
  for (let i = 0; i < outer.length; i += 1) {
    const [ax, az] = outer[i];
    const [bx, bz] = outer[(i + 1) % outer.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (!best || len > best.len + 1e-9) best = { len, ux: (bx - ax) / len, uz: (bz - az) / len };
  }
  const { ux, uz } = best;
  // Local +z goes to (sin, cos) = (-uz, ux).
  const vx = -uz;
  const vz = ux;
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const [x, z] of outer) {
    const u = x * ux + z * uz;
    const v = x * vx + z * vz;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  return { x: uc * ux + vc * vx, z: uc * uz + vc * vz, angle: Math.atan2(-uz, ux), hu: (u1 - u0) / 2 + margin, hv: (v1 - v0) / 2 + margin, corner: Math.max(k.rectCorner, margin) };
}

// A point of a rounded rectangle (half size hu x hv, corner radius c) at
// t (0 to 1) of its length, in local meters: [x, z, nx, nz] with the outward
// normal. t = 0 is (hu, 0), and t grows toward +z, as the angle of a circle
// ring. The shader has the same function (rectPoint in landmark-rings.js).
export function rectPoint(hu, hv, c, t) {
  const a = Math.max(0, hu - c);
  const b = Math.max(0, hv - c);
  const arc = (Math.PI * c) / 2;
  const total = 4 * a + 4 * b + 4 * arc;
  let d = (((t % 1) + 1) % 1) * total;
  const corner = (cx, cz, from) => (s) => {
    const ang = from + s / c;
    return [cx + Math.cos(ang) * c, cz + Math.sin(ang) * c, Math.cos(ang), Math.sin(ang)];
  };
  const parts = [
    [b, (s) => [hu, s, 1, 0]],
    [arc, corner(a, b, 0)],
    [2 * a, (s) => [a - s, hv, 0, 1]],
    [arc, corner(-a, b, Math.PI / 2)],
    [2 * b, (s) => [-hu, b - s, -1, 0]],
    [arc, corner(-a, -b, Math.PI)],
    [2 * a, (s) => [-a + s, -hv, 0, -1]],
    [arc, corner(a, -b, (3 * Math.PI) / 2)],
    [b, (s) => [hu, -b + s, 1, 0]],
  ];
  for (const [len, at] of parts) {
    if (d <= len) return at(d);
    d -= len;
  }
  return [hu, 0, 1, 0];
}

// A ring point in world [x, z] at t (0 to 1): the circle, or the rounded
// rectangle of an area ring.
export function ringPoint(ring, t) {
  if (ring.rect) {
    const { hu, hv, corner, angle } = ring.rect;
    const [lx, lz] = rectPoint(hu, hv, corner, t);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [ring.x + lx * c + lz * s, ring.z - lx * s + lz * c];
  }
  const a = t * 2 * Math.PI;
  return [ring.x + Math.cos(a) * ring.r, ring.z + Math.sin(a) * ring.r];
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
      const ring = { key: s.id, id: s.id, shape, x: c.zone.x, z: c.zone.z, r: c.zone.r, digit: 0, dashes: c.type === "grind" ? dashCount(c.zone.r, k) : 1, alpha: 1 };
      // An area zone (#365): the rounded rectangle of the area plus its margin.
      if (c.zone.shapes) {
        const rect = areaRect(c.zone.shapes[0][0], c.zone.margin ?? 0, k);
        out.push({ ...ring, x: rect.x, z: rect.z, rect: { hu: rect.hu, hv: rect.hv, corner: rect.corner, angle: rect.angle } });
      } else out.push(ring);
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
export function ringGround(ring, center, groundAt, k = RINGS) {
  const n = k.samples;
  const raw = [];
  for (let i = 0; i < n; i += 1) {
    const [px, pz] = ringPoint(ring, i / n);
    const h = groundAt(px, pz, center + k.reach);
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
