// Tuning knobs for the roller skate controller. One place, every number.
// Comments give min / typical / max so a tuner knows the safe range.
// Units: meters, seconds, radians. Yaw 0 faces +x; positive yaw turns left.

export const SKATE = {
  // Speed
  maxSpeed: 12, // m/s. min 8 / typical 12 / max 16. Cap after pushes.
  pushAccel: 8, // m/s^2 mean thrust while the push button is held. 0 to 10 m/s in about 1.8 s. min 5 / typical 8 / max 12.
  pushCooldown: 0.4, // s for one stroke. The thrust rises and falls over each stroke. min 0.25 / typical 0.4 / max 0.7.
  coastDecel: 1.2, // m/s^2 linear roll friction. From full speed, half speed in about 1.9 s and a stop in about 6 s. min 0.5 / typical 1.2 / max 2.
  coastDrag: 0.025, // 1/m quadratic drag, times speed^2. min 0.01 / typical 0.025 / max 0.04.
  rampFriction: 0.2, // fraction of the roll friction and drag on a ramp (ground normal y under rampNormalY). Skaters pump transitions. min 0 / typical 0.2 / max 1.
  rampNormalY: 0.97, // ground normal y under which the ground counts as a ramp. min 0.9 / typical 0.97 / max 0.995.
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
  jumpBuffer: 0.1, // s a jump press waits for the skater to reach the ground. min 0.05 / typical 0.1 / max 0.2.
  coyoteTime: 0.12, // s after a roll off an edge in which a jump press still jumps. min 0.06 / typical 0.12 / max 0.2.
  dropThreshold: 0.3, // m drop under the feet that turns a roll into a fall. min 0.15 / typical 0.3 / max 0.6.

  // Ground contact
  bodyRadius: 0.3, // m. The skater stops this far from a wall, so the body does not go into it. min 0.2 / typical 0.3 / max 0.4.
  maxStep: 0.25, // m rise the skater rolls over (curbs, stairs). min 0.15 / typical 0.25 / max 0.4.
  launchNormalY: 0.15, // ramp surface normal y under which the skater leaves the lip. min 0.05 / typical 0.15 / max 0.3.
  bonkSpeedKeep: 0, // fraction of speed kept after a head-on wall hit (a bonk). min 0 / typical 0 / max 0.3.
  wallBonkAngle: 1.05, // rad between the travel direction and a wall face above which a hit is head-on and the skater bonks. Under it the skater slides. min 0.7 / typical 1.05 / max 1.4.
  wallSlideKeep: 0.8, // fraction of the along-wall speed kept on a slide just under wallBonkAngle. A shallower hit keeps more; a graze keeps all. min 0.5 / typical 0.8 / max 1.
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
  // Player look control (mouse drag, right stick). The look offset turns the camera about the skater.
  mouseLookRate: 0.006, // rad of look per pixel of mouse drag. min 0.002 / typical 0.006 / max 0.012.
  stickLookRate: 2.8, // rad/s of look at full right stick. min 1.5 / typical 2.8 / max 5.
  stickDeadzone: 0.15, // right stick deadzone. min 0.05 / typical 0.15 / max 0.3.
  minPitch: -0.3, // rad the player can lower the camera from its rest angle. min -0.4 / typical -0.3 / max 0.
  maxPitch: 0.75, // rad the player can raise the camera above its rest angle. min 0.3 / typical 0.75 / max 1.0.
  lookHold: 1.0, // s with no look input before the camera goes back behind the skater. min 0.3 / typical 1 / max 3.
  lookReturn: 2.5, // 1/s rate the look offset goes back to zero after the hold. min 1 / typical 2.5 / max 6.
};

// Grind: rail snap, balance, exit.
export const GRIND = {
  buffer: 0.15, // s a grind press (a tap) still snaps to a rail that comes in range. min 0.05 / typical 0.15 / max 0.3.
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

// Style (dance) moves on the roll-out. Each button has a list of dances.
// A press starts the next dance in the list; a held button repeats the dance.
// `beats` sets the length on the game beat clock (BEAT.bpm). `clip` names
// the skater clip, and `anim` names the placeholder capsule animation.
// The sources for the dances are in docs/characters/atl-dance-references.md.
// A dance with `skaters` plays only for those skaters (their GLB has the clip).
export const STYLE = {
  minSpeed: 1.5, // m/s needed to start a style move. min 0.5 / typical 1.5 / max 3.
  moves: [
    {
      id: "groove",
      beats: 2,
      points: 150,
      anim: "tilt",
      dances: [
        // Marcus' own dances (#107 follow-up): a retargeted Tripo motion and
        // two Meshy text to motion clips. Real skaters review them before release.
        { clip: "dance_jamgroove", name: "Jam Groove", skaters: ["marcus"] },
        { clip: "dance_drumline", name: "Drumline Count", skaters: ["marcus"] },
        { clip: "dance_jamstep", name: "Jam Step", skaters: ["marcus"] },
        { clip: "dance_bankhead", name: "Bankhead Bounce" },
        { clip: "dance_walkitout", name: "Walk It Out" },
        { clip: "dance_prep", name: "The Prep" },
        { clip: "dance_swagsurf", name: "Swag Surf" },
        { clip: "dance_snaplean", name: "Snap Lean" },
        { clip: "dance_crisscross", name: "Crisscross" },
        { clip: "dance_smoothquad", name: "Smooth Quad" },
      ],
    },
    {
      id: "spin",
      beats: 1,
      points: 160,
      anim: "spin",
      dances: [
        { clip: "dance_spin", name: "Toe Spin" },
        { clip: "dance_sitspin", name: "Sit Spin" },
      ],
    },
  ],
};

// The dances of a move for one skater. A dance with no `skaters` list is for every skater.
export const dancesFor = (move, skater) => move.dances.filter((d) => !d.skaters || d.skaters.includes(skater));

// The length of a style move in seconds at `bpm`.
export const styleDuration = (move, bpm = BEAT.bpm) => (move.beats * 60) / bpm;

// Combo scoring.
export const COMBO = {
  linkWindow: 0.8, // s after a move ends, rolling on flat, before the combo banks. min 0.3 / typical 0.8 / max 1.5.
  grindBase: 100, // points per grind. min 50 / typical 100 / max 200.
  grindPerSecond: 300, // extra points per second on the rail. Keep it above the best dance rate (spin: 160 points in 0.6 s = 267/s), so a grind earns more per second than any dance (#75). min 280 / typical 300 / max 400.
  hopPoints: 50, // points for a jump that lands. min 20 / typical 50 / max 100.
  vertAirPoints: 200, // points for air off the quarter pipe. min 100 / typical 200 / max 400.
  manualPoints: 80, // points per manual (no input bound in M0). min 40 / typical 80 / max 150.
  minAirTime: 0.2, // s airborne needed for a hop to count. min 0.1 / typical 0.2 / max 0.4.
  styleGain: 0.25, // style meter fill per dance move (meter is 0..1). min 0.1 / typical 0.25 / max 0.5.
  bailStyleLoss: 0.5, // style meter lost on a bail. min 0 / typical 0.5 / max 1.
  beatBonus: 1.5, // multiplier for a move landed on the beat (M0-07). min 1 / typical 1.5 / max 2.
  // Repeat decay (#75). Entry n is the fraction of the points that the
  // n-th repeat of the same move name in one combo earns (entry 0 = the first use).
  // A repeat past the end of the list earns 0 points and adds no link to the multiplier.
  // Each entry: min 0 / typical 1, 0.5, 0.25 / max 1. Keep the list short (2 to 4 entries).
  repeatDecay: [1, 0.5, 0.25],
  maxMultiplier: 10, // cap on the combo multiplier (#75). min 5 / typical 10 / max 20.
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
