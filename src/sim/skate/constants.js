// Tuning knobs for the roller skate controller. One place, every number.
// Comments give min / typical / max so a tuner knows the safe range.
// Units: meters, seconds, radians. Yaw 0 faces +x; positive yaw turns left.

export const SKATE = {
  // Speed
  maxSpeed: 12, // m/s. min 8 / typical 12 / max 16. Cap after pushes.
  pushImpulse: 2.4, // m/s added per push. min 1.5 / typical 2.4 / max 4.
  pushCooldown: 0.4, // s between pushes while the button is held. min 0.25 / typical 0.4 / max 0.7.
  coastDecel: 0.5, // m/s^2 linear roll friction. min 0.2 / typical 0.5 / max 1.2.
  coastDrag: 0.012, // 1/m quadratic drag, times speed^2. min 0.005 / typical 0.012 / max 0.03.
  brakeDecel: 8, // m/s^2 toe-stop brake. min 4 / typical 8 / max 14.
  stopSpeed: 0.05, // m/s under which the skater counts as stopped. Keep small.

  // Carve
  carveRate: 2.4, // rad/s yaw rate at full carve speed. min 1.5 / typical 2.4 / max 3.5.
  carveFullSpeed: 6, // m/s where the carve reaches carveRate. min 3 / typical 6 / max 9.
  carveMinFactor: 0.3, // fraction of carveRate at a crawl. min 0.1 / typical 0.3 / max 0.6.
  airTurnRate: 3.0, // rad/s yaw spin while airborne. min 1 / typical 3 / max 6.

  // Jump and air
  jumpSpeed: 5, // m/s vertical. min 3.5 / typical 5 / max 7. Arc height = v^2 / (2 g).
  gravity: 20, // m/s^2 arcade gravity. min 12 / typical 20 / max 30.
  dropThreshold: 0.3, // m drop under the feet that turns a roll into a fall. min 0.15 / typical 0.3 / max 0.6.

  // Ground contact
  maxStep: 0.25, // m rise the skater rolls over (curbs, stairs). min 0.15 / typical 0.25 / max 0.4.
  launchNormalY: 0.15, // ramp surface normal y under which the skater leaves the lip. min 0.05 / typical 0.15 / max 0.3.
  bonkSpeedKeep: 0, // fraction of speed kept after a wall hit. min 0 / typical 0 / max 0.3.
  fallFloor: -3, // m height under which a falling skater respawns. min -10 / typical -3 / max -1.
  boundsMargin: 1, // m past the level bounds at which a skater respawns. min 0.5 / typical 1 / max 5.
  sideSlope: 0.0, // reserved.
};

export const SKATER_BODY = {
  radius: 0.35, // m capsule radius (render only).
  height: 1.6, // m total capsule height (render only).
};

// Follow camera, THPS style: behind and above, leads the travel direction,
// pulls back with speed, smooths through turns.
export const CAMERA = {
  distance: 6.5, // m behind the skater at rest. min 4 / typical 6.5 / max 10.
  height: 2.8, // m above the skater's feet. min 1.5 / typical 2.8 / max 5.
  lookAhead: 3.0, // m ahead of the skater that the camera looks at, at full speed. min 0 / typical 3 / max 6.
  lookHeight: 1.0, // m above the feet for the look-at point. min 0.5 / typical 1 / max 1.6.
  speedPullback: 0.22, // extra m of distance per m/s. min 0 / typical 0.22 / max 0.5.
  maxPullback: 3.0, // m cap on the speed pullback. min 0 / typical 3 / max 6.
  yawSmoothing: 5.0, // 1/s rate the camera yaw chases the skater yaw. min 2 / typical 5 / max 12.
  maxYawRate: 3.0, // rad/s cap on the camera swing, so a turnaround takes about 1 s. min 1.5 / typical 3 / max 6.
  positionSmoothing: 10.0, // 1/s rate the camera position chases its target. min 4 / typical 10 / max 25.
  lookSmoothing: 12.0, // 1/s rate the look-at point chases its target. min 4 / typical 12 / max 30.
  clipMargin: 0.3, // m kept between the camera and a wall it would clip. min 0.1 / typical 0.3 / max 0.6.
  minDistance: 1.2, // m closest the camera comes to the pivot when a wall pushes it in. min 0.5 / typical 1.2 / max 3.
  clipRelease: 4.0, // 1/s rate the camera eases back out after a wall clears. min 2 / typical 4 / max 10.
  vertNormalY: 0.9, // ground normal y under which the skater is on vert and the camera holds its yaw. min 0.7 / typical 0.9 / max 0.97.
};
