// Far-step (#189): an agent far from the camera and the skater steps less
// often, with a longer step, so the sim spends its time near the player.
// Pure: no Three.js here.
//
// `bands` is a list of [distance m, stride], from near to far. An agent at
// distance d steps every `stride` ticks, with dt * stride. The ticks of
// the agents are staggered by their id, so the cost spreads over the ticks.

// The stride at distance d (m): 1 inside the first band, else the stride
// of the farthest band that d is past.
export function farStride(d, bands) {
  let stride = 1;
  for (const [at, n] of bands) if (d >= at) stride = n;
  return stride;
}

// True when an agent with whole number `id` steps on tick `tick` with
// stride `stride`. With stride 1 it steps on every tick.
export function stepsOnTick(tick, id, stride) {
  return stride <= 1 || (tick + id) % stride === 0;
}

// The distance (m) from (x, z) to the nearest viewer: a list of [x, z]
// points (the camera and the skater). Infinity with no viewer.
export function viewerDistance(x, z, viewers) {
  let best = Infinity;
  for (const v of viewers) {
    const d = Math.hypot(x - v[0], z - v[1]);
    if (d < best) best = d;
  }
  return best;
}
