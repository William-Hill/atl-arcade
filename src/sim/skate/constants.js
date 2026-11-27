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
  // rad/s yaw spin while airborne (visual: the landing sets the yaw to the travel). 6 so that a
  // hop (0.57 s) or a fast kicker or vert air (11 m/s and up) can turn one 180 (#344, Q5).
  airTurnRate: 6.0, // min 1 / typical 6 / max 6.

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
  lipNormalY: 0.5, // a face steeper than this (normal y under it) launches the skater straight up at its top, where a flatter deck or a drop starts (#262). The H4W quarter pipe tops out at 0.357. min 0.3 / typical 0.5 / max 0.7.
  bonkSpeedKeep: 0, // fraction of speed kept after a head-on wall hit (a bonk). min 0 / typical 0 / max 0.3.
  wallBonkAngle: 1.05, // rad between the travel direction and a wall face above which a hit is head-on and the skater bonks. Under it the skater slides. min 0.7 / typical 1.05 / max 1.4.
  wallSlideKeep: 0.8, // fraction of the along-wall speed kept on a slide just under wallBonkAngle. A shallower hit keeps more; a graze keeps all. min 0.5 / typical 0.8 / max 1.
  softWallKeep: 0.5, // fraction of the speed kept on a head-on hit of a soft wall (a moving car, #261): the skater glances off along its side and never stops. A shallower hit keeps more. min 0.3 / typical 0.5 / max 0.8.
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
  // Swing: a wall or the edge fence close to the skater turns the camera around her to a clear side (playtest 2026-11-09).
  swingBelow: 0.55, // part of the camera range: a blocker nearer than this swings the camera. min 0.3 / typical 0.55 / max 0.8.
  swingStep: 0.3, // rad between the swing probes. min 0.15 / typical 0.3 / max 0.5.
  swingMax: 1.5, // rad: the widest swing to each side. min 0.6 / typical 1.5 / max 2.4.
  swingRate: 5.0, // rad/s: the swing speed. min 2 / typical 5 / max 10.
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
  // Ledge catch (#262): a skater who hits the side of a ledge with grind held, or presses grind
  // just after the hit, snaps to its edge at a wider angle and keeps the speed from before the hit.
  catchAlongDot: 0.2, // |cos| between heading and edge needed for a catch (about 78 degrees). min 0 / typical 0.2 / max 0.5.
  catchWindow: 0.25, // s after a bonk in which a grind press still catches with the speed from before it. min 0.1 / typical 0.25 / max 0.4.
};

// Style (dance) moves on the roll-out. Each button has a list of dances.
// With the old rules (trick input off), a press starts the next dance in the
// list; a held button repeats the dance. With the trick input on (#327), the
// direction picks the dance slot (src/sim/skate/tricks.js, GDD R7).
// Each dance has its own `beats` (the length on the game beat clock,
// BEAT.bpm) and `points` (GDD R7, #337). `clip` names the skater clip, and
// `anim` names the placeholder capsule animation of the move.
// The sources for the dances are in docs/characters/atl-dance-references.md.
// A dance with `skaters` plays only for those skaters (their GLB has the clip).
const groove = (clip, name, skaters) => ({ clip, name, beats: 2, points: 150, ...(skaters ? { skaters } : {}) });
const spin = (clip, name) => ({ clip, name, beats: 1, points: 160 });
export const STYLE = {
  minSpeed: 1.5, // m/s needed to start a style move. min 0.5 / typical 1.5 / max 3.
  moves: [
    {
      id: "groove",
      anim: "tilt",
      dances: [
        // Marcus' own dances (#107 follow-up): a retargeted Tripo motion and
        // two Meshy text to motion clips. Real skaters review them before release.
        groove("dance_jamgroove", "Jam Groove", ["marcus"]),
        groove("dance_drumline", "Drumline Count", ["marcus"]),
        groove("dance_jamstep", "Jam Step", ["marcus"]),
        groove("dance_bankhead", "Bankhead Bounce"),
        groove("dance_walkitout", "Walk It Out"),
        groove("dance_prep", "The Prep"),
        groove("dance_swagsurf", "Swag Surf"),
        groove("dance_snaplean", "Snap Lean"),
        // The clip dance_crisscross is the Cross Step (docs/decisions.md, 2026-11-03; GDD R7).
        groove("dance_crisscross", "Cross Step"),
        groove("dance_smoothquad", "Smooth Quad"),
      ],
    },
    {
      id: "spin",
      anim: "spin",
      dances: [spin("dance_spin", "Toe Spin"), spin("dance_sitspin", "Sit Spin")],
    },
  ],
};

// The dances of a move for one skater. A dance with no `skaters` list is for every skater.
export const dancesFor = (move, skater) => move.dances.filter((d) => !d.skaters || d.skaters.includes(skater));

// The length in seconds at `bpm` of a dance (anything with `beats`).
export const styleDuration = (dance, bpm = BEAT.bpm) => (dance.beats * 60) / bpm;

// Combo scoring.
export const COMBO = {
  linkWindow: 0.8, // s after a move ends, rolling on flat, before the combo banks. min 0.3 / typical 0.8 / max 1.5.
  grindBase: 100, // points per grind. min 50 / typical 100 / max 200.
  // A grind scores the meters on the rail, not the seconds (#262): before, a slow grind of the
  // same rail took longer, so it scored more. 35 points per m is the old 300 points per s at
  // 8.6 m/s, so the score scale and the challenge targets stay near the old ones. At 8 m/s or faster a grind earns more per second than the best dance
  // (spin: 267/s, #75); a slower grind earns less. min 30 / typical 35 / max 120 (120 keeps #75 at
  // the 2.5 m/s floor, but a grind line then scores about 3 times more).
  grindPerMeter: 35,
  longGrindMeters: 10, // m on one rail for the "Long" name. Was 1.5 s, which favored slow grinds. min 6 / typical 10 / max 15.
  rampAirPoints: 100, // points for air off a kicker or a ramp lip that is not vert (#262). min 50 / typical 100 / max 200.
  hopPoints: 50, // points for a jump that lands. min 20 / typical 50 / max 100.
  vertAirPoints: 200, // points for air off the quarter pipe. min 100 / typical 200 / max 400.
  manualPoints: 80, // points per manual with the old rules (trick input off). With the trick input on, F2 (TRICK.manualBase) pays. min 40 / typical 80 / max 150.
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
  // Trick input (#327, docs/gdd/trick-input.md F5 to F7, R10).
  beatPerfectBonus: 1.75, // F6: multiplier for a move judged PERFECT (BEAT.perfectMs). Keep at or above beatBonus. min 1.5 / typical 1.75 / max 2.
  stumbleKeep: 0.5, // F5 L: fraction of the link points on a stumble. min 0.25 / typical 0.5 / max 0.75.
  stumbleStyleLoss: 0.25, // R10: style meter lost on a stumble. min 0 / typical 0.25 / max 0.5.
  stumbleSpeedKeep: 0.7, // R10: fraction of the speed kept on a stumble. min 0.5 / typical 0.7 / max 0.9.
  // The hit stop at a PERFECT link (#338, docs/ux/trick-hud.md 6.4): the sim and the skater stop
  // for this many ms of wall time. The HUD does not stop. 0 turns it off. min 0 / typical 60 / max 100.
  perfectHitStopMs: 60,
  bailBank: 0.25, // F7: fraction of the pending points that a bail banks, at multiplier 1. min 0 / typical 0.25 / max 0.5.
};

// Trick input (#327, docs/gdd/trick-input.md, Tuning Knobs). Times are in s
// on the sim clock (`skater.time`). The input layer (src/input/, #328) owns
// the stick threshold and the touch flick; the sim reads the result.
export const TRICK = {
  // R3 and R3a: the fresh direction.
  dirBefore: 0.15, // s a direction may start before the press. min 0.1 / typical 0.15 / max 0.25.
  dirAfter: 0.06, // s the game waits after the press when no direction is fresh. min 0 / typical 0.06 / max 0.1.
  axisRule: true, // R3a (owner choice 2026-11-25, #326): the up/down hold and the up/down first rule. false = the R3 rule only.
  udHold: 0.3, // s: an up or down still held at the press counts if it started inside this. min 0.25 / typical 0.3 / max 0.4.
  udFirst: true, // R3a: an up or down beats a left or right when both are fresh.
  // R4: grabs.
  grabMinAir: 0.1, // s of air before a grab may start. min 0.05 / typical 0.1 / max 0.2.
  // R8, F1, F2: the manual.
  manualDelay: 0.15, // s GRIND is held with no rail before a manual starts. min 0.1 / typical 0.15 / max 0.3.
  manualMinSpeed: 3, // m/s. min 2 / typical 3 / max 4.
  manualFriction: 0.5, // times the roll friction and drag in a manual. min 0 / typical 0.5 / max 1.
  manualDrift: 0.4, // F1 d. min 0.2 / typical 0.4 / max 0.8.
  manualGravity: 1.0, // F1 g. min 0.5 / typical 1 / max 2.
  manualCorrect: 2.2, // F1 c. min 1 / typical 2.2 / max 4.
  manualBase: 40, // F2 points per manual (replaces COMBO.manualPoints). min 20 / typical 40 / max 80.
  manualPerMeter: 15, // F2 points per m. Keep under COMBO.grindPerMeter. min 8 / typical 15 / max 25.
  manualCapMeters: 30, // F2 m that pay; the link is added here. min 15 / typical 30 / max 50.
  toeRollBonus: 20, // F2 extra points for a Toe Roll. min 0 / typical 20 / max 60.
  // F3, F4: trick points.
  trickBaseNeutral: 80, // F3 neutral grab. min 40 / typical 80 / max 150.
  trickBaseDir: 120, // F3 direction grab. min 60 / typical 120 / max 300.
  stanceBonus: 30, // F4 direction stance. min 0 / typical 30 / max 80.
  holdRate: 60, // F3 points per s of grab held. Keep holdRate * holdCap under 1.5 x trickBase. min 20 / typical 60 / max 120.
  holdCap: 1.5, // F3 s of hold that pay. min 0.5 / typical 1.5 / max 3.
  spinPer180: 40, // F3 points per full half turn of |airYaw|. min 20 / typical 40 / max 80.
  spinCapHalfTurns: 6, // F3. min 4 / typical 6 / max 8.
  // R10: landings.
  landingGrace: 0.1, // s: a grab younger than this at the touchdown is void (no points, no stumble). Larger is more lenient. min 0.05 / typical 0.1 / max 0.2.
};

// R12.3 "Relaxed timing": longer windows.
export const TRICK_RELAXED = { dirBefore: 0.25, dirAfter: 0.1, landingGrace: 0.2 };

// Beat clock and the on-beat bonus. The beat never gates input.
export const BEAT = {
  bpm: 100, // beats per minute of the synthesized click. min 80 / typical 100 / max 140.
  perfectMs: 20, // |offset| for a PERFECT tag. min 10 / typical 20 / max 40.
  goodMs: 60, // |offset| for a GOOD tag and the bonus. min 40 / typical 60 / max 90.
  scheduleAheadSec: 0.15, // s of clicks scheduled ahead of the audio clock. min 0.1 / typical 0.15 / max 0.3.
  schedulerMs: 25, // ms between scheduler ticks. min 10 / typical 25 / max 50.
  startDelaySec: 0.25, // s between start() and beat 0. min 0.1 / typical 0.25 / max 0.5.
};
