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

// Grind: rail snap, balance, exit.
export const GRIND = {
  snapRadius: 1.2, // m horizontal distance to the spline that allows a snap. min 0.6 / typical 1.2 / max 2.
  snapBelow: 0.35, // m the rail may sit below the feet (airborne approach). min 0.1 / typical 0.35 / max 1.
  snapAbove: 0.9, // m the rail may sit above the feet (rolling approach). min 0.4 / typical 0.9 / max 1.5.
  minAlongDot: 0.5, // |cos| between heading and tangent needed to snap. min 0.3 / typical 0.5 / max 0.8.
  minSpeed: 2.5, // m/s floor for the grind speed at snap. min 1 / typical 2.5 / max 4.
  friction: 0.6, // m/s^2 speed lost while grinding. min 0 / typical 0.6 / max 2.
  balanceDrift: 0.55, // 1/s constant lean push. min 0.2 / typical 0.55 / max 1.2.
  balanceGravity: 1.4, // 1/s lean growth proportional to the lean. min 0.5 / typical 1.4 / max 3.
  balanceCorrect: 2.2, // 1/s correction per unit of steer. min 1 / typical 2.2 / max 4.
  balanceLimit: 1.0, // lean magnitude that counts as a fall. Keep 1.
  fallSideSpeed: 1.5, // m/s sideways push on a fall. min 0.5 / typical 1.5 / max 3.
  fallSpeedKeep: 0.5, // fraction of speed kept after a fall. min 0 / typical 0.5 / max 1.
  resnapCooldown: 0.4, // s after an exit or fall before another snap. min 0.1 / typical 0.4 / max 1.
  endPop: 0.8, // m/s upward pop when the spline ends. min 0 / typical 0.8 / max 2.
};

// Style (dance) moves on the roll-out. Each has a duration and a score.
// `anim` names the placeholder capsule animation in the renderer.
export const STYLE = {
  minSpeed: 1.5, // m/s needed to start a style move. min 0.5 / typical 1.5 / max 3.
  moves: [
    { id: "shuffle", name: "Shuffle", duration: 0.5, points: 120, anim: "tilt" },
    { id: "spin", name: "Spin", duration: 0.7, points: 160, anim: "spin" },
  ],
};

// Combo scoring.
export const COMBO = {
  linkWindow: 0.8, // s after a move ends, rolling on flat, before the combo banks. min 0.3 / typical 0.8 / max 1.5.
  grindBase: 100, // points per grind. min 50 / typical 100 / max 200.
  grindPerSecond: 60, // extra points per second on the rail. min 20 / typical 60 / max 120.
  hopPoints: 50, // points for a jump that lands. min 20 / typical 50 / max 100.
  vertAirPoints: 200, // points for air off the quarter pipe. min 100 / typical 200 / max 400.
  manualPoints: 80, // points per manual (no input bound in M0). min 40 / typical 80 / max 150.
  minAirTime: 0.2, // s airborne needed for a hop to count. min 0.1 / typical 0.2 / max 0.4.
  styleGain: 0.25, // style meter fill per dance move (meter is 0..1). min 0.1 / typical 0.25 / max 0.5.
  bailStyleLoss: 0.5, // style meter lost on a bail. min 0 / typical 0.5 / max 1.
  beatBonus: 1.5, // multiplier for a move landed on the beat (M0-07). min 1 / typical 1.5 / max 2.
};

// Beat clock and the on-beat bonus. The beat never gates input.
export const BEAT = {
  bpm: 100, // beats per minute of the synthesized click. min 80 / typical 100 / max 140.
  perfectMs: 20, // |offset| for a PERFECT tag. min 10 / typical 20 / max 40.
  goodMs: 60, // |offset| for a GOOD tag and the bonus. min 40 / typical 60 / max 90.
  scheduleAheadSec: 0.15, // s of clicks scheduled ahead of the audio clock. min 0.1 / typical 0.15 / max 0.3.
  schedulerMs: 25, // ms between scheduler ticks. min 10 / typical 25 / max 50.
  startDelaySec: 0.25, // s between start() and beat 0. min 0.1 / typical 0.25 / max 0.5.
};
