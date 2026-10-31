// Every tuning knob for the skate controller, in one file, in SI units.
// Each line carries min | typical | max: the range an agent or William may
// move it through without the feel falling apart. Anything outside the range
// is a design change, not a tune.

export const SKATE = {
  // --- speed -------------------------------------------------------------
  // Top rolling speed. 11 m/s is about 40 km/h: quick for roller skates, and
  // slow enough that a 64 m greybox block takes a few seconds to cross. At 14
  // the skater ran out of block before a scripted line finished.
  maxSpeed: 11, // m/s        min 8 | typical 11 | max 18
  // One push adds this much. Big enough that pushing feels like a decision.
  pushImpulse: 3.4, // m/s    min 1.5 | typical 3.4 | max 5
  // Time before the next push lands. The cooldown is what makes speed a skill.
  pushCooldown: 0.4, // s     min 0.2 | typical 0.4 | max 0.8
  // Rolling resistance while coasting. Momentum is king, so keep it low.
  coastDecay: 0.6, // m/s^2   min 0.2 | typical 0.6 | max 2.0
  // Braking. v^2/2a, so about 6.7 m from top speed at the typical value.
  brakeDecel: 9, // m/s^2     min 4 | typical 9 | max 18
  // Below this the skater is treated as stopped.
  stopSpeed: 0.12, // m/s     min 0.02 | typical 0.12 | max 0.4

  // --- carving -----------------------------------------------------------
  // Turn rate at a standstill and at top speed. Turning tightens as you slow,
  // which is what makes a fast line feel committed.
  carveRateSlow: 3.2, // rad/s  min 1.5 | typical 3.2 | max 5
  carveRateFast: 1.05, // rad/s min 0.4 | typical 1.05 | max 2.5
  // Air steer, as a fraction of the ground carve rate.
  airSteerScale: 0.4, //        min 0 | typical 0.4 | max 0.8

  // --- jumping -----------------------------------------------------------
  // Take-off speed. Apex is v^2/2g, about 0.75 m at the typical values.
  jumpSpeed: 5.2, // m/s      min 3 | typical 5.2 | max 8
  gravity: 18, // m/s^2       min 9.81 | typical 18 | max 30
  // Crouch-and-go is not modelled yet; a jump is a fixed arc (M0-03 spec).
  // How long the landing pose holds before the skater is coasting again.
  landingTime: 0.12, // s     min 0 | typical 0.12 | max 0.3
  // Speed kept through a landing. Under 1 so a big drop costs a little.
  landingSpeedKeep: 0.92, //  min 0.6 | typical 0.92 | max 1

  // --- ground contact ----------------------------------------------------
  // How far above a surface still counts as standing on it. Covers the step
  // up a curb and the stair treads.
  groundSnap: 0.35, // m      min 0.05 | typical 0.35 | max 0.6
  // The skater capsule, for rendering and for the camera.
  height: 1.8, // m
  radius: 0.34, // m

  // --- safety net --------------------------------------------------------
  // Pillar 1: the game never kills the player. Fall off the block and you are
  // put back at the spawn, with no score penalty and no death.
  respawnBelowY: -12, // m    min -40 | typical -12 | max -4
};

// Carve rate at a given speed, easing from carveRateSlow to carveRateFast.
export function carveRateAt(speed, tuning = SKATE) {
  const t = Math.min(Math.abs(speed) / tuning.maxSpeed, 1);
  return tuning.carveRateSlow + (tuning.carveRateFast - tuning.carveRateSlow) * t;
}
