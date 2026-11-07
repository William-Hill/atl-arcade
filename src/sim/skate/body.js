// The body of each playable skater, from the dossiers in docs/characters/,
// and the skate constants that follow from it. Pure: no Three.js.
//
// The renderer scales the model to the dossier height, and the controller
// skates with the constants of skateFor(). A skater with no body entry (the
// capsule, the tests) uses SKATE as it is.

import { SKATE } from "./constants.js";

// height: m, barefoot. weight: kg. meshHeight: m, the GLB from the wheels to
// the top of the head (assets/skaters/<name>/provenance.json).
export const SKATER_BODIES = {
  nia: { height: 1.68, weight: 61, meshHeight: 1.7, stance: "regular", build: "athletic, a strong lower body" },
  marcus: { height: 1.88, weight: 79, meshHeight: 1.78, stance: "goofy", build: "tall and lean, long legs" },
};

// The reference body: SKATE (src/sim/skate/constants.js) is tuned for it.
export const BODY_REF = { height: 1.75, weight: 70 };

// m. The quad skate under the foot: the boot sole, the plate, and a 58 mm
// wheel. A skater on skates stands this much taller than barefoot.
export const SKATE_STACK = 0.1;

export const bodyFor = (name) => SKATER_BODIES[name] ?? null;

// The model scale that makes the skater stand at the dossier height on skates.
export function modelScale(body) {
  if (!body) return 1;
  return (body.height + SKATE_STACK) / body.meshHeight;
}

// The limits of each tuned constant (the min and max in constants.js).
const LIMITS = {
  maxSpeed: [8, 16],
  pushAccel: [5, 12],
  pushCooldown: [0.25, 0.7],
  coastDrag: [0.01, 0.04],
  brakeDecel: [4, 14],
  carveRate: [1.5, 3.5],
  jumpSpeed: [3.5, 7],
  bodyRadius: [0.2, 0.4],
};

const clamp = (key, v) => Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], v));

// The skate constants for a body. h and m are the height and the weight
// against BODY_REF. The rules are simple scaling laws, kept small:
// - Longer legs give a longer stroke: the top speed and the stroke time go
//   up with sqrt(h).
// - Muscle force goes up with m^(2/3), so the push acceleration (force per
//   mass) goes down with m^(-1/3), and up with sqrt(h) for the longer stroke.
// - Air drag: the front area goes with sqrt(m h), so the drag per mass goes
//   with sqrt(h / m). A heavier skater coasts further.
// - The roll friction does not change: it is the same per mass.
// - A heavier skater stops a little slower (m^(-1/3)) and jumps a little
//   lower (m^(-1/6) h^(1/4)).
// - A taller, heavier skater turns a little wider: h^(-1/2) m^(-1/6).
// - The collision radius goes with the shoulder width, sqrt(m / h).
export function skateFor(body, base = SKATE) {
  if (!body) return base;
  const h = body.height / BODY_REF.height;
  const m = body.weight / BODY_REF.weight;
  return {
    ...base,
    maxSpeed: clamp("maxSpeed", base.maxSpeed * Math.sqrt(h)),
    pushAccel: clamp("pushAccel", base.pushAccel * m ** (-1 / 3) * Math.sqrt(h)),
    pushCooldown: clamp("pushCooldown", base.pushCooldown * Math.sqrt(h)),
    coastDrag: clamp("coastDrag", base.coastDrag * Math.sqrt(h / m)),
    brakeDecel: clamp("brakeDecel", base.brakeDecel * m ** (-1 / 3)),
    carveRate: clamp("carveRate", base.carveRate * h ** (-1 / 2) * m ** (-1 / 6)),
    jumpSpeed: clamp("jumpSpeed", base.jumpSpeed * m ** (-1 / 6) * h ** (1 / 4)),
    bodyRadius: clamp("bodyRadius", base.bodyRadius * Math.sqrt(m / h)),
  };
}
