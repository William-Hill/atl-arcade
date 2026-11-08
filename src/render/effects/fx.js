// Comic effects (#113): the pure part. No Three.js here.
//
// The effects read the flags of the pure skate controller (`speed`,
// `bonked`, `justLanded`, `justSnapped`) and the scored moves of the run
// (`onBeat`). They never change the controller, the materials or the grade
// (docs/art-direction-pbr.md section 11). effects-view.js draws them.
//
// Three effects:
// - speed lines: thin warm-white streaks at the frame edge at high speed,
//   never over the skater;
// - impact frame: 2 or 3 rendered frames of a radial burst in the district
//   accent on a bonk or a hard landing (no full-screen flash);
// - burst: small star and ring decals in the accent on a grind start and an
//   on-beat move. Only the hot core of a star blooms.
//
// The burst is a general particle (a position, a velocity, gravity, a
// shape, a color, a life), so other systems can spawn their own: the
// landmark claim (#221) spawns a star-and-ring burst and petals with
// `burst()`, and uses `pulse()` for the map icon.

// Tuning. Speeds in m/s, times in s.
export const FX = {
  // The speed lines start at `start` and are full at `full`. The controller
  // caps the push speed at 12 m/s; a downhill or a ramp goes over it.
  speed: { start: 9.5, full: 13, attack: 0.18, release: 0.35 },
  // A bonk needs this speed before the hit, so a skater who pushes into a
  // wall from rest does not flash on each tick. A hard landing: this air
  // time, or this fall speed at the touchdown.
  impact: { bonkSpeed: 3, hardAirTime: 0.9, hardFallSpeed: 7, cooldown: 0.35 },
  burst: { life: 0.45, size: 0.55, beatSize: 0.8, max: 48 },
  // The streak layout. Distances are fractions of the way from the skater
  // to the frame edge, along the streak ray; `clear` is the least distance
  // from the skater in NDC y units (clearRadius()).
  lines: { period: 0.26, inner: 0.7, length: [0.12, 0.24], clear: 0.32 },
  // The impact spikes, in NDC y units from the skater (1 = half the
  // screen height). They start outside the skater (clearRadius()).
  spikes: { inner: 0.2, length: [0.18, 0.42] },
  // Emissive values (linear, before tone mapping). The bloom threshold is
  // 0.92 at night and 2.4 by day (pbr-palette.js BLOOM_THRESHOLD): the body
  // of every effect stays under 0.92, and only the star core goes over 2.4.
  emissive: { body: 0.8, core: 3.2, line: 0.85 },
};

// The warm white of the speed lines (sRGB).
export const LINE_COLOR = "#fff1d6";

// What each tier keeps (docs/art-direction-pbr.md section 8): off on low,
// reduced on phone, full on high. `lines` is the streak count, `impact` the
// frame count, `burst` the shapes. Other effects (#221) add a row here.
export const EFFECT_TIERS = {
  lines: { low: 0, phone: 10, high: 18 },
  impact: { low: 0, phone: 2, high: 3 },
  spikes: { low: 0, phone: 10, high: 16 },
  burst: {
    low: null,
    phone: { star: false, ring: true, core: false },
    high: { star: true, ring: true, core: true },
  },
};

// Pure: the effects policy for a tier. `reducedMotion` (the
// prefers-reduced-motion media query) and `off` (?fx=0) turn every effect
// off on every tier. `enabled` is false when nothing draws, so the view adds
// no meshes.
export function effectsPolicy(tier, { reducedMotion = false, off = false } = {}, table = EFFECT_TIERS) {
  const pick = (row, none) => (off || reducedMotion || !row ? none : row[tier] ?? none);
  const policy = {
    lines: pick(table.lines, 0),
    impact: pick(table.impact, 0),
    spikes: pick(table.spikes, 0),
    burst: pick(table.burst, null),
  };
  for (const key of Object.keys(table)) if (!(key in policy)) policy[key] = pick(table[key], null);
  policy.enabled = Object.entries(policy).some(([, v]) => (typeof v === "number" ? v > 0 : Boolean(v)));
  return policy;
}

// Pure: the effects one simulation tick asks for, from the skater before
// and after the tick and the moves the run scored on it. Returns a list of
// { kind: "impact" | "burst", reason }.
export function effectTriggers(prev, next, moves = [], k = FX) {
  const out = [];
  if (!prev || !next) return out;
  if (next.bonked && Math.abs(prev.speed ?? 0) >= k.impact.bonkSpeed) out.push({ kind: "impact", reason: "bonk" });
  else if (next.justLanded) {
    const fall = -(prev.velocity?.[1] ?? 0);
    if ((prev.airTime ?? 0) >= k.impact.hardAirTime || fall >= k.impact.hardFallSpeed) out.push({ kind: "impact", reason: "land" });
  }
  if (next.justSnapped) out.push({ kind: "burst", reason: "grind" });
  if (moves.some((m) => m.onBeat)) out.push({ kind: "burst", reason: "beat" });
  return out;
}

// Pure: the effect state.
export function createFx() {
  return { time: 0, speed: 0, cooldown: 0, impact: { frames: 0, seq: 0, reason: null }, bursts: [], nextId: 1 };
}

// Pure: move the speed-line strength toward the target for the skater
// speed. A hold of 1 forces full lines (the screenshot hook).
export function speedTarget(speed, k = FX) {
  const t = (Math.abs(speed) - k.speed.start) / (k.speed.full - k.speed.start);
  return Math.min(1, Math.max(0, t));
}

// Pure: age the state by dt s. `speed` is the skater speed; `active` false
// (photo mode, a pause) fades the lines out.
export function stepFx(fx, dt, { speed = 0, active = true } = {}, k = FX) {
  const target = active ? speedTarget(speed, k) : 0;
  const rate = target > fx.speed ? 1 / k.speed.attack : 1 / k.speed.release;
  const step = rate * dt;
  const s = target > fx.speed ? Math.min(target, fx.speed + step) : Math.max(target, fx.speed - step);
  const bursts = [];
  for (const b of fx.bursts) {
    const t = b.t + dt;
    if (t >= b.life) continue;
    const v = b.velocity;
    const g = b.gravity ?? 0;
    const velocity = v ? [v[0], v[1] - g * dt, v[2]] : null;
    const position = velocity ? [b.position[0] + velocity[0] * dt, b.position[1] + velocity[1] * dt, b.position[2] + velocity[2] * dt] : b.position;
    bursts.push({ ...b, t, position, velocity });
  }
  return { ...fx, time: fx.time + dt, speed: s, cooldown: Math.max(0, fx.cooldown - dt), bursts };
}

// Pure: start an impact frame, unless one ran in the last `cooldown` s or
// the policy has none.
export function startImpact(fx, reason, policy, k = FX) {
  if (!policy.impact || fx.cooldown > 0) return fx;
  return { ...fx, cooldown: k.impact.cooldown, impact: { frames: policy.impact, seq: fx.impact.seq + 1, reason } };
}

// Pure: one rendered frame of the impact went by. The impact counts frames,
// not seconds, as a comic impact frame does.
export function impactFrameDone(fx) {
  if (fx.impact.frames <= 0) return fx;
  return { ...fx, impact: { ...fx.impact, frames: fx.impact.frames - 1 } };
}

// Pure: add a burst particle. `spec` is { position, color, shape: "star" |
// "ring" | "petal", size, life, core, velocity, gravity, spin, rotation,
// flat }. A flat particle lies on the ground (a decal); the others face the
// camera. The oldest particle goes when the pool is full.
export function addBurst(fx, spec, k = FX) {
  const b = {
    id: fx.nextId,
    t: 0,
    life: spec.life ?? k.burst.life,
    position: [...spec.position],
    velocity: spec.velocity ? [...spec.velocity] : null,
    gravity: spec.gravity ?? 0,
    shape: spec.shape ?? "star",
    color: spec.color,
    size: spec.size ?? k.burst.size,
    core: Boolean(spec.core),
    spin: spec.spin ?? 0,
    rotation: spec.rotation ?? 0,
    flat: Boolean(spec.flat),
  };
  const bursts = [...fx.bursts, b];
  while (bursts.length > k.burst.max) bursts.shift();
  return { ...fx, bursts, nextId: fx.nextId + 1 };
}

// Pure: the particles of a grind or beat burst for the policy. A grind
// start gets a star (high) and a ring; an on-beat move gets a bigger pair.
export function burstSpecs(reason, position, color, policy, k = FX) {
  const shapes = policy.burst;
  if (!shapes) return [];
  const size = reason === "beat" ? k.burst.beatSize : k.burst.size;
  const out = [];
  if (shapes.ring) out.push({ position, color, shape: "ring", size: size * 1.4, core: false });
  if (shapes.star) out.push({ position, color, shape: "star", size, core: shapes.core, rotation: reason === "beat" ? Math.PI / 5 : 0 });
  return out;
}

// Pure: the look of a burst at age fraction u (0..1): the scale grows fast
// and eases out, the alpha holds and then fades.
export function burstEnvelope(u) {
  const t = Math.min(1, Math.max(0, u));
  const scale = 0.35 + 0.65 * (1 - (1 - t) ** 3);
  const alpha = t < 0.4 ? 1 : Math.max(0, 1 - (t - 0.4) / 0.6);
  return { scale, alpha };
}

// Pure: a single pulse (0..1..0) over `duration` s, for a map icon (#221).
export function pulse(t, duration) {
  if (t <= 0 || t >= duration) return 0;
  return Math.sin((Math.PI * t) / duration);
}

// A small integer hash to [0, 1), so the streaks are the same for the same
// time (a screenshot is stable).
export function hash01(a, b = 0) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Pure: the distance from (ax, ay) to the edge of the frame along the
// direction (dx, dy), in a space where the frame is [-aspect, aspect] x
// [-1, 1].
export function edgeDistance(ax, ay, dx, dy, aspect) {
  let d = Infinity;
  if (dx > 1e-9) d = Math.min(d, (aspect - ax) / dx);
  if (dx < -1e-9) d = Math.min(d, (-aspect - ax) / dx);
  if (dy > 1e-9) d = Math.min(d, (1 - ay) / dy);
  if (dy < -1e-9) d = Math.min(d, (-1 - ay) / dy);
  return Math.max(0, d);
}

// The radius around the anchor that an effect keeps clear: the skater's
// half height on the screen (anchor.r, NDC y units) with a margin, and at
// least `min`.
export function clearRadius(anchor, min) {
  return Math.max(min, (anchor?.r ?? 0) * 1.3);
}

// Clamp the anchor (the skater on the screen, NDC) inside the frame.
function anchorIn(anchor, aspect) {
  const x = Math.min(0.8, Math.max(-0.8, anchor?.x ?? 0)) * aspect;
  const y = Math.min(0.8, Math.max(-0.8, anchor?.y ?? 0));
  return [x, y];
}

// Pure: the speed-line streaks for `count` lines at `time` s and strength
// `strength` (0..1). `anchor` is the skater in NDC { x, y, r } (r: the
// skater's half height on the screen). Each streak lies on a
// ray from the skater, in the outer band of the frame (from `inner` of the
// way to the edge), and drifts out over its period. No streak comes nearer
// to the skater than clearRadius(). Returns NDC segments
// { ax, ay, bx, by, alpha }; a is the inner end.
export function speedLineSegments(count, time, anchor, aspect, strength, k = FX) {
  const out = [];
  if (count <= 0 || strength <= 0) return out;
  const [cx, cy] = anchorIn(anchor, aspect);
  const L = k.lines;
  const clear = clearRadius(anchor, L.clear);
  for (let i = 0; i < count; i += 1) {
    const offset = hash01(i, 7) * L.period;
    const cycle = Math.floor((time + offset) / L.period);
    const u = (time + offset) / L.period - cycle;
    // Spread the angles: slot i of `count`, with a jitter in the slot.
    const angle = ((i + 0.15 + 0.7 * hash01(i, cycle)) / count) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const edge = edgeDistance(cx, cy, dx, dy, aspect);
    const len = (L.length[0] + (L.length[1] - L.length[0]) * hash01(cycle, i + 101)) * (0.6 + 0.4 * strength);
    const start = Math.max(clear, edge * (L.inner + (1 - L.inner) * 0.5 * u));
    const end = Math.min(edge * 1.02, start + len * edge);
    if (end <= start) continue;
    // Fade in and out over the period.
    const alpha = strength * Math.sin(Math.PI * u);
    out.push({ ax: (cx + dx * start) / aspect, ay: cy + dy * start, bx: (cx + dx * end) / aspect, by: cy + dy * end, alpha });
  }
  return out;
}

// Pure: the impact spikes for an impact `seq` on frame `frame` of the
// impact. Spikes go out from a ring around the skater; each frame turns the
// burst, so it reads as a hit and not as a still sticker. Returns NDC
// segments { ax, ay, bx, by, alpha }.
export function impactSpikes(count, seq, frame, anchor, aspect, k = FX) {
  const out = [];
  if (count <= 0) return out;
  const [cx, cy] = anchorIn(anchor, aspect);
  const S = k.spikes;
  const base = clearRadius(anchor, S.inner);
  for (let i = 0; i < count; i += 1) {
    const angle = ((i + 0.5 * hash01(seq * 31 + frame, i)) / count) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const inner = base * (1 + 0.2 * frame);
    const len = S.length[0] + (S.length[1] - S.length[0]) * hash01(i, seq * 7 + frame);
    const edge = edgeDistance(cx, cy, dx, dy, aspect);
    const end = Math.min(edge, inner + len);
    if (end <= inner) continue;
    out.push({ ax: (cx + dx * inner) / aspect, ay: cy + dy * inner, bx: (cx + dx * end) / aspect, by: cy + dy * end, alpha: 1 });
  }
  return out;
}

// Pure: the effect color for a district look: its brightest accent, so a
// dark accent (oxblood, navy, deep green) does not read as a dark stain.
// The color is scaled to the `body` emissive value (max channel), linear.
export function accentEmissive(accentsLinear, k = FX) {
  let best = [1, 0.8, 0.4];
  let bestLuma = -1;
  for (const c of accentsLinear ?? []) {
    const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    if (luma > bestLuma) {
      best = c;
      bestLuma = luma;
    }
  }
  const m = Math.max(best[0], best[1], best[2], 1e-4);
  return best.map((v) => (v / m) * k.emissive.body);
}
