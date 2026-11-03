// A polyline with its arc lengths, for fast lookups by arc length. Pure.
// pointAt() gives the same points as pointAt() in src/playtest/trail-script.js,
// but it uses a binary search, so a long trail costs O(log n) per call.

export function createPath(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return { points, cum, length: cum[cum.length - 1] };
}

function segmentAt(path, s) {
  const { cum } = path;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function pathPoint(path, s) {
  const { points, cum } = path;
  if (s <= 0) return points[0];
  if (s >= path.length) return points[points.length - 1];
  const i = segmentAt(path, s);
  const len = cum[i + 1] - cum[i];
  const t = len > 0 ? (s - cum[i]) / len : 0;
  const [ax, az] = points[i];
  const [bx, bz] = points[i + 1];
  return [ax + t * (bx - ax), az + t * (bz - az)];
}

// The unit tangent at s, from two points `span` m apart. The span smooths
// the corners, so an offset from the center line does not jump.
export function pathTangent(path, s, span = 2) {
  const a = pathPoint(path, Math.max(0, s - span));
  const b = pathPoint(path, Math.min(path.length, s + span));
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, dz / len];
}

// The world point at arc length s and a side offset. A positive offset is
// on the right of the path direction (+s), seen from above with +z south.
export function pathOffsetPoint(path, s, offset) {
  const [x, z] = pathPoint(path, s);
  const [tx, tz] = pathTangent(path, s);
  // Right of (tx, tz) in the x-z plane, with -z north: (-tz, tx).
  return [x - tz * offset, z + tx * offset];
}
