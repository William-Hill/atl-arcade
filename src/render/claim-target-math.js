// The grind claim target (#264): the pure part. No Three.js, no DOM.
//
// A Found grind claim names one rail or curb (`challenge.feature`), but its
// ring only shows a circle on the ground. Near the zone, the game now draws a
// gold line on the part of that rail or curb that counts, with a post at each
// end, so the player sees which curb it is and which way it runs. The line is
// brighter while the skater grinds it.
//
// The render layer is src/render/claim-target.js.

export const TARGET = {
  near: 30, // m past the zone radius: the line shows when the skater is this close. min 15 / typical 30 / max 60.
  step: 0.5, // m between the samples of the clip
  lift: 0.06, // m over the grind line, so the line sits on the top edge
  radius: 0.07, // m, the gold tube
  ink: 0.035, // m, the ink around it (toon look)
  post: { height: 1.4, radius: 0.06 }, // m, the post at each end
  gold: "#ffd166", // the landmark gold (RINGS.gold)
  inkColor: "#0b0b12",
  // The gain of the gold: at rest, and while the skater grinds the feature.
  // The pbr look keeps the rest under the day bloom threshold, as the rings.
  gain: { rest: 0.85, active: 1.25 },
  pulse: { period: 1.6, amp: 0.15 }, // the slow brightness pulse; off with reduced motion
};

const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// The part of a polyline ([[x, y, z]]) within `r` m (on the ground plane) of
// (cx, cz): the run of samples that comes nearest to the center, as
// [[x, y, z]]. Empty when no part is that close.
export function clipNear(points, cx, cz, r, step = TARGET.step) {
  if (!points.length) return [];
  const samples = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, ay, az] = points[i];
    const [bx, by, bz] = points[i + 1];
    const n = Math.max(1, Math.ceil(d2(ax, az, bx, bz) / step));
    for (let j = 0; j < n; j += 1) {
      const t = j / n;
      samples.push([ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t]);
    }
  }
  samples.push([...points[points.length - 1]]);
  let best = -1;
  let bestD = Infinity;
  samples.forEach(([x, , z], i) => {
    const d = d2(x, z, cx, cz);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (bestD > r) return [];
  const inside = (i) => d2(samples[i][0], samples[i][2], cx, cz) <= r;
  let a = best;
  let b = best;
  while (a > 0 && inside(a - 1)) a -= 1;
  while (b < samples.length - 1 && inside(b + 1)) b += 1;
  return samples.slice(a, b + 1);
}

// The length of a polyline, in m.
export function pathLength(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1], points[i + 1][2] - points[i][2]);
  return total;
}

// The targets to draw, from landmarkView().spots and the grindables of the
// level ({ id, points }). A target shows for a Found grind claim (`ring`), in
// a mode with claims (`timed`), while the skater at `position` is within
// zone.r + near of the zone. Its line is the part of the feature within
// zone.r + meters of the zone center: every grind that touches the zone
// and is long enough runs there. Each target is
// { id, feature, points, length, active }.
export function grindTargets(spots, grindables, position, { timed = true } = {}, k = TARGET) {
  if (!timed || !position) return [];
  const out = [];
  for (const s of spots) {
    const c = s.challenge;
    if (!s.ring || !c || c.type !== "grind") continue;
    if (d2(position[0], position[2], c.zone.x, c.zone.z) > c.zone.r + k.near) continue;
    const g = grindables.find((x) => x.id === c.feature);
    if (!g) continue;
    const points = clipNear(g.points, c.zone.x, c.zone.z, c.zone.r + c.meters, k.step);
    if (points.length < 2) continue;
    out.push({ id: s.id, feature: c.feature, points, length: pathLength(points), active: Boolean(s.active) });
  }
  return out;
}

// The gain of the gold at time `t` (s). While the skater grinds the feature
// the line is at its brightest and does not pulse.
export function targetGain(active, t, reducedMotion = false, k = TARGET) {
  if (active) return k.gain.active;
  if (reducedMotion) return k.gain.rest;
  return k.gain.rest * (1 + k.pulse.amp * Math.sin((2 * Math.PI * t) / k.pulse.period));
}
