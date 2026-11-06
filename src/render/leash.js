// A leash between two moving points (a walker's hand and a dog's collar):
// a parabola that hangs by its slack. The sag is solved (bisection) so the
// parabola's arc is the leash length; taut (ends at least length apart) it
// is a straight line.

function arcLength(d, s) {
  if (s < 1e-9) return d;
  const r = Math.sqrt(d * d + 16 * s * s);
  return r / 2 + ((d * d) / (8 * s)) * Math.log((4 * s + r) / d);
}

export function leashSag(d, length) {
  if (d <= 1e-6) return length / 2;
  if (d >= length) return 0;
  let lo = 0;
  let hi = length;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (arcLength(d, mid) < length) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// n + 1 points from a to b ({x, y, z}), written into out (reused objects).
export function leashPoints(a, b, length, n = 12, out = []) {
  const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const s = leashSag(d, length);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = out[i] ?? (out[i] = { x: 0, y: 0, z: 0 });
    p.x = a.x + (b.x - a.x) * t;
    p.y = a.y + (b.y - a.y) * t - 4 * s * t * (1 - t);
    p.z = a.z + (b.z - a.z) * t;
  }
  out.length = n + 1;
  return out;
}
