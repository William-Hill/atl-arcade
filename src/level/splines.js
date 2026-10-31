// Grind spline math. Pure: arrays of [x, y, z], no Three.js.
//
// A spline is either { points: [...] } (a polyline) or
// { start, control, end } (a quadratic Bezier). `sampleSpline` turns either
// into a polyline, and the rest of this file works on polylines.

export function sampleSpline(spline, samples = 12) {
  if (spline.points) return spline.points.map((p) => [p[0], p[1], p[2]]);
  if (!spline.start || !spline.control || !spline.end) {
    throw new Error("splines: a spline needs `points` or `start`, `control`, `end`");
  }
  const out = [];
  for (let i = 0; i <= samples; i += 1) {
    out.push(bezierPoint(spline.start, spline.control, spline.end, i / samples));
  }
  return out;
}

export function bezierPoint(a, c, b, t) {
  const u = 1 - t;
  return [0, 1, 2].map((k) => u * u * a[k] + 2 * u * t * c[k] + t * t * b[k]);
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a) {
  const n = length(a);
  return n > 0 ? scale(a, 1 / n) : [0, 0, 0];
}

export function cumulativeLengths(points) {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) {
    out.push(out[i - 1] + length(sub(points[i], points[i - 1])));
  }
  return out;
}

export function polylineLength(points) {
  const c = cumulativeLengths(points);
  return c[c.length - 1];
}

// Point and unit tangent at arc-length distance `s` along the polyline.
// `s` is clamped to [0, length].
export function pointAtDistance(points, s) {
  const cum = cumulativeLengths(points);
  const total = cum[cum.length - 1];
  const d = Math.min(Math.max(s, 0), total);
  let i = 0;
  while (i < points.length - 2 && cum[i + 1] < d) i += 1;
  const segLen = cum[i + 1] - cum[i];
  const t = segLen > 0 ? (d - cum[i]) / segLen : 0;
  const tangent = normalize(sub(points[i + 1], points[i]));
  const point = add(points[i], scale(sub(points[i + 1], points[i]), t));
  return { point, tangent, segment: i, s: d, total };
}

// Nearest point on the polyline to `p`. Returns the point, the distance,
// the arc-length position `s`, the unit tangent of that segment, and the
// segment index.
export function nearestOnPolyline(points, p) {
  const cum = cumulativeLengths(points);
  let best = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const ab = sub(points[i + 1], a);
    const len2 = dot(ab, ab);
    const t = len2 > 0 ? Math.min(Math.max(dot(sub(p, a), ab) / len2, 0), 1) : 0;
    const point = add(a, scale(ab, t));
    const distance = length(sub(p, point));
    if (!best || distance < best.distance) {
      best = { point, distance, s: cum[i] + t * Math.sqrt(len2), tangent: normalize(ab), segment: i, total: cum[cum.length - 1] };
    }
  }
  return best;
}
