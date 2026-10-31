// A quarter-pipe transition as a 2D profile in local X (along the roll-in)
// and Y (up). The skater rolls in at the origin and the surface steepens to a
// vertical lip at x = radius, y = radius.
//
// Pure. Both the render geometry and the Rapier collider are built from this,
// so what you see is what you hit.

export function quarterPipeProfile(radius, segments = 12) {
  if (!(radius > 0)) throw new Error("quarter-pipe: radius must be positive");
  if (!Number.isInteger(segments) || segments < 2) {
    throw new Error("quarter-pipe: segments must be an integer of at least 2");
  }
  const surface = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (Math.PI / 2) * (i / segments);
    surface.push({ x: radius * Math.sin(angle), y: radius * (1 - Math.cos(angle)) });
  }
  return surface;
}

// The closed outline of the solid wedge: the transition surface, then down the
// back of the lip, then along the ground back to the roll-in.
export function quarterPipeOutline(radius, segments = 12) {
  const surface = quarterPipeProfile(radius, segments);
  return [...surface, { x: radius, y: 0 }];
}

// Height of the transition at a distance along the roll-in. Flat before the
// ramp, the lip height past it. Used by the skater's surface probe.
export function quarterPipeHeightAt(radius, x) {
  if (x <= 0) return 0;
  if (x >= radius) return radius;
  // y = r - sqrt(r^2 - x^2) is the same curve as the profile above.
  return radius - Math.sqrt(Math.max(0, radius * radius - x * x));
}
