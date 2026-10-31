// Plain {x, y, z} vector helpers. Pure, allocation-returning, no Three.js, so
// the simulation runs unchanged in Vitest and in the browser.

export const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const clone = (a) => ({ x: a.x, y: a.y, z: a.z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const lengthSq = (a) => dot(a, a);
export const length = (a) => Math.sqrt(lengthSq(a));
export const distance = (a, b) => length(sub(a, b));

export function normalize(a) {
  const len = length(a);
  return len > 1e-9 ? scale(a, 1 / len) : v3();
}

export const lerp = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

// Horizontal plane only. Skate feel is mostly a 2D problem with a height
// channel, so the controller leans on these a lot.
export const flatLength = (a) => Math.hypot(a.x, a.z);
export const flatDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const yawOf = (a) => Math.atan2(a.x, a.z);
export const fromYaw = (yaw, speed = 1) => ({ x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed });

export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

// Shortest signed angle from a to b, in radians, always within -PI..PI.
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
