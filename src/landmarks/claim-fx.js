// The landmark claim effects (#221). Pure: no DOM, no Three.js.
//
// Design: design/gdd/landmark-discovery.md ("The Found and Claimed moments",
// "Extra effects", R-1) and docs/art-direction-pbr.md section 11.
//
// - Claim burst: a star-and-ring decal at the skater's feet for 0.4 s in the
//   district accent. Only the star core blooms. Phone: the ring only (no
//   star, no bloom). Low: off, as every effect (art direction section 11);
//   the challenge ring still turns gold and fades there.
// - Dogwood petals (#c98fa6) fall over the skater for 1 s. High: 16
//   petals, phone: 8, low: none.
// - A faint warm rim on Found buildings at golden hour, high tier only.
//
// The burst and the petals are particles of the effects layer
// (src/render/effects/effects-view.js burst()), gated by the `claim` and
// `petals` rows of EFFECT_TIERS (src/render/effects/fx.js), so
// prefers-reduced-motion and ?fx=0 turn them off. With reduced motion the
// challenge ring fades in 0.3 s in its place (src/render/landmark-rings-math.js
// claimFade()). The map icon pulse is src/ui/landmark-icons.js pulseAt().
// Every effect is an emissive overlay: it never changes a material or the
// grade.

import { FX } from "../render/effects/fx.js";

export const CLAIM_FX = {
  burst: {
    life: 0.4, // s (GDD)
    ring: 1.6, // m, the half size of the ring decal
    star: 1.0, // m, the half size of the star decal
    lift: 0.06, // m over the ground, so the decals do not fight the ground
  },
  petals: {
    color: "#c98fa6", // dogwood pink (GDD)
    life: 1.0, // s (GDD)
    top: [2.2, 3.0], // m over the feet: the start height of a petal
    radius: 1.1, // m: the start spread around the skater
    drift: 0.5, // m/s: the side drift
    fall: 1.1, // m/s: the start fall speed
    gravity: 0.8, // m/s²: a light fall
    size: [0.12, 0.18], // m, the half size
    spin: 4, // rad/s at most
  },
  rim: {
    color: "#ffb36b", // a warm sun orange
    alpha: 0.35, // faint
    offset: 0.15, // m out from the walls
    // Golden hour by the sun elevation in degrees (the grade of
    // src/render/pbr-palette.js is golden from 0 to 14 degrees): the rim
    // fades in from `start` to `full`, holds, and fades out from `fade` to `end`.
    golden: { start: -1, full: 3, fade: 10, end: 16 },
  },
};

// The tier rows of the burst (`claim`) and the petals (`petals`) are in
// EFFECT_TIERS (src/render/effects/fx.js), so effectsPolicy() gates them.
// The rim is not a particle: claimRim() gates it.

// The rim draws on the high tier only, and not with ?fx=0.
export function claimRim(tier, { off = false } = {}) {
  return !off && tier === "high";
}

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

// A hex color as linear RGB, scaled so its largest channel is `max`.
export function linearColor(hex, max = 1) {
  const rgb = [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const m = Math.max(...rgb, 1e-4);
  return rgb.map((v) => (v / m) * max);
}

// A small hash to [0, 1): the same claim gives the same petals.
function rand(seed, i) {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// The burst particles of a claim at `position` (the skater's feet), for the
// `claim` row of the policy. `accent` is the linear accent color of the
// district (effects.accentAt()). Both decals lie flat on the ground.
export function claimBurstSpecs(position, accent, shapes, k = CLAIM_FX) {
  if (!shapes) return [];
  const [x, y, z] = position;
  const at = [x, y + k.burst.lift, z];
  const out = [];
  if (shapes.ring) out.push({ position: at, color: accent, shape: "ring", size: k.burst.ring, life: k.burst.life, core: false, flat: true });
  if (shapes.star) out.push({ position: [x, y + k.burst.lift + 0.01, z], color: accent, shape: "star", size: k.burst.star, life: k.burst.life, core: Boolean(shapes.core), flat: true });
  return out;
}

// The petals of a claim: `count` billboards that start over the skater and
// fall for 1 s. The color stays under the night bloom threshold, so the
// petals never bloom.
export function petalSpecs(position, count, seed = 0, k = CLAIM_FX) {
  const n = Math.max(0, Math.floor(count ?? 0));
  if (n === 0) return [];
  const p = k.petals;
  const color = linearColor(p.color, FX.emissive.body);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + rand(seed, i) * 0.8;
    const r = p.radius * (0.3 + 0.7 * rand(seed, i + 101));
    const h = p.top[0] + (p.top[1] - p.top[0]) * rand(seed, i + 202);
    const d = p.drift * (rand(seed, i + 303) * 2 - 1);
    out.push({
      position: [position[0] + Math.cos(a) * r, position[1] + h, position[2] + Math.sin(a) * r],
      velocity: [Math.cos(a + Math.PI / 2) * d, -p.fall, Math.sin(a + Math.PI / 2) * d],
      gravity: p.gravity,
      color,
      shape: "petal",
      size: p.size[0] + (p.size[1] - p.size[0]) * rand(seed, i + 404),
      life: p.life,
      core: false,
      spin: p.spin * (rand(seed, i + 505) * 2 - 1),
      rotation: rand(seed, i + 606) * Math.PI,
      flat: false,
    });
  }
  return out;
}

// All the particles of one claim for the effects policy (effectsPolicy()):
// none when the policy has no `claim` and no `petals` (low tier petals,
// reduced motion, ?fx=0).
export function claimSpecs(position, accent, policy, seed = 0, k = CLAIM_FX) {
  if (!policy) return [];
  return [...claimBurstSpecs(position, accent, policy.claim, k), ...petalSpecs(position, policy.petals, seed, k)];
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The golden-hour factor (0..1) for a sun elevation in degrees.
export function goldenFactor(elevation, k = CLAIM_FX) {
  if (!Number.isFinite(elevation)) return 0;
  const g = k.rim.golden;
  return smooth(g.start, g.full, elevation) * (1 - smooth(g.fade, g.end, elevation));
}

// The rim opacity now.
export function rimAlpha(elevation, k = CLAIM_FX) {
  return Math.round(goldenFactor(elevation, k) * k.rim.alpha * 1000) / 1000;
}

// The ids of the buildings that get the rim: the building spots that are
// Found (not yet claimed). `view` is landmarkView().
export function rimBuildings(view) {
  return (view?.spots ?? []).filter((s) => s.kind === "building" && s.state === "found").map((s) => s.id);
}

// The rim walls of a footprint: a band of quads `offset` m outside each
// edge of the outer ring (x, z points), from the ground `base` to `base +
// height`. Returns { positions, normals } as flat arrays (2 triangles per
// edge, 6 vertices). The normal points out, for the rim shader.
export function rimWalls(ring, base, height, offset = CLAIM_FX.rim.offset) {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  const n = pts.length;
  // The signed area: positive is counterclockwise in (x, z).
  let area = 0;
  for (let i = 0; i < n; i += 1) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % n];
    area += ax * bz - bx * az;
  }
  const sign = area >= 0 ? 1 : -1;
  const positions = [];
  const normals = [];
  for (let i = 0; i < n; i += 1) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % n];
    const ex = bx - ax;
    const ez = bz - az;
    const len = Math.hypot(ex, ez);
    if (len < 1e-6) continue;
    // The outward normal of the edge.
    const nx = (ez / len) * sign;
    const nz = (-ex / len) * sign;
    const a0 = [ax + nx * offset, base, az + nz * offset];
    const b0 = [bx + nx * offset, base, bz + nz * offset];
    const a1 = [a0[0], base + height, a0[2]];
    const b1 = [b0[0], base + height, b0[2]];
    for (const v of [a0, b0, b1, a0, b1, a1]) {
      positions.push(...v);
      normals.push(nx, 0, nz);
    }
  }
  return { positions, normals };
}
