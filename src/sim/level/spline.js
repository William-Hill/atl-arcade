// Grind splines are polylines: an ordered list of {x, y, z} points. A straight
// rail is two points, a kinked rail three, a curved rail a sampled arc. The
// grind system (M0-05) asks these functions where the skater is on a rail.
//
// Pure. Parameter `t` is normalized arc length over the whole polyline, 0..1.

import { add, clamp, distance, lerp, normalize, scale, sub } from "../math/vec3.js";

export function segmentLengths(points) {
  assertPolyline(points);
  const lengths = [];
  for (let i = 1; i < points.length; i += 1) lengths.push(distance(points[i - 1], points[i]));
  return lengths;
}

export function polylineLength(points) {
  return segmentLengths(points).reduce((a, b) => a + b, 0);
}

// Point at normalized arc length t.
export function pointAt(points, t) {
  const { index, local } = locate(points, t);
  return lerp(points[index], points[index + 1], local);
}

// Unit direction of travel at t, pointing from the start of the spline to its
// end. At a kink this is the direction of the segment t falls in.
export function tangentAt(points, t) {
  const { index } = locate(points, t);
  return normalize(sub(points[index + 1], points[index]));
}

// Nearest point on the polyline to p. Returns the point, its t, the distance,
// the tangent there and which segment it landed on. This is the one the grind
// snap test calls every frame.
export function closestPointOnPolyline(points, p) {
  assertPolyline(points);
  const lengths = segmentLengths(points);
  const total = lengths.reduce((a, b) => a + b, 0);

  let best = null;
  let travelled = 0;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const segment = sub(b, a);
    const segmentLength = lengths[i - 1];

    let local = 0;
    if (segmentLength > 1e-9) {
      const toP = sub(p, a);
      local = clamp(
        (toP.x * segment.x + toP.y * segment.y + toP.z * segment.z) / (segmentLength * segmentLength),
        0,
        1,
      );
    }

    const point = add(a, scale(segment, local));
    const dist = distance(p, point);
    if (!best || dist < best.distance) {
      best = {
        point,
        distance: dist,
        segment: i - 1,
        t: total > 1e-9 ? (travelled + local * segmentLength) / total : 0,
        tangent: segmentLength > 1e-9 ? scale(segment, 1 / segmentLength) : { x: 0, y: 0, z: 0 },
      };
    }
    travelled += segmentLength;
  }

  return best;
}

// Sample an arc in the XZ plane. Curved rails are built with this so the data
// stays readable and the sampling stays in one place.
export function arcPoints({ center, radius, startAngle, endAngle, y = 0, segments = 8 }) {
  if (!(segments >= 1)) throw new Error("spline: arc needs at least one segment");
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = startAngle + ((endAngle - startAngle) * i) / segments;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + y,
      z: center.z + Math.sin(angle) * radius,
    });
  }
  return points;
}

function locate(points, t) {
  assertPolyline(points);
  const lengths = segmentLengths(points);
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 1e-9) return { index: 0, local: 0 };

  let target = clamp(t, 0, 1) * total;
  for (let i = 0; i < lengths.length; i += 1) {
    if (target <= lengths[i] || i === lengths.length - 1) {
      return { index: i, local: lengths[i] > 1e-9 ? clamp(target / lengths[i], 0, 1) : 0 };
    }
    target -= lengths[i];
  }
  return { index: lengths.length - 1, local: 1 };
}

function assertPolyline(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error("spline: a polyline needs at least two points");
  }
}
