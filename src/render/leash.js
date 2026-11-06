// A leash between two moving points (a walker's hand and a dog's collar):
// the straight segment from a to b, sagging down by 4 s t (1 - t). The sag s
// is solved (bisection) so the curve's arc is the leash length, with the
// ends at any heights; taut (ends at least length apart) it is a straight
// line.

// Arc length of the curve with horizontal span h, rise v and sag s
// (Simpson's rule; the speed |(h, v - 4 s (1 - 2t))| is smooth).
function arcLength(h, v, s, n = 32) {
  const speed = (t) => Math.hypot(h, v - 4 * s * (1 - 2 * t));
  let sum = speed(0) + speed(1);
  for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * speed(i / n);
  return sum / (3 * n);
}

export function leashSag(h, v, length) {
  const d = Math.hypot(h, v);
  if (d >= length) return 0;
  let lo = 0;
  let hi = length;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (arcLength(h, v, mid) < length) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// n + 1 points from a to b ({x, y, z}), written into out (reused objects).
export function leashPoints(a, b, length, n = 12, out = []) {
  const s = leashSag(Math.hypot(b.x - a.x, b.z - a.z), b.y - a.y, length);
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
