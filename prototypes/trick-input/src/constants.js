// Tuning knobs of the trick input prototype (#326). The values are the
// "typical" values of docs/gdd/trick-input.md, Tuning Knobs. This file is a
// copy for the prototype: it does not import src/ (AGENTS.md).
// Times are in seconds on the sim clock, except the flick (px, ms).

export const DT = 1 / 60; // fixed sim step (60 Hz)
export const EPS = 1e-6; // float slack for frame time compares

export const TRICK = {
  dirBefore: 0.15, // s a direction may start before the press (R3). 0.10 / 0.15 / 0.25
  dirAfter: 0.06, // s the game waits after the press when no fresh direction exists (R3). 0 / 0.06 / 0.10
  stickThreshold: 0.5, // gamepad stick travel for a direction (R2). 0.35 / 0.5 / 0.7
  flickMin: 24, // px of drag for a touch flick (R11). 16 / 24 / 40
  flickMaxMs: 120, // ms before a touch with no flick resolves neutral (R11). 80 / 120 / 250
  manualDelay: 0.15, // s GRIND is held before a manual starts (R8). 0.1 / 0.15 / 0.3
  grabMinAir: 0.1, // s of air before a grab may start (R4). 0.05 / 0.1 / 0.2
  manualMinSpeed: 3, // m/s (R8). 2 / 3 / 4
  manualFriction: 0.5, // times the roll friction in a manual (R8). 0 / 0.5 / 1
  manualDrift: 0.4, // F1 d. 0.2 / 0.4 / 0.8
  manualGravity: 1.0, // F1 g. 0.5 / 1.0 / 2
  manualCorrect: 2.2, // F1 c. 1 / 2.2 / 4
  manualBase: 40, // F2. 20 / 40 / 80
  manualPerMeter: 15, // F2. 8 / 15 / 25
  manualCapMeters: 30, // F2. 15 / 30 / 50
  toeRollBonus: 20, // F2. 0 / 20 / 60
  trickBaseNeutral: 80, // F3. 40 / 80 / 150
  trickBaseDir: 120, // F3. 60 / 120 / 300
  stanceBonus: 30, // F4. 0 / 30 / 80
  holdRate: 60, // F3 points per s. 20 / 60 / 120
  holdCap: 1.5, // F3 s. 0.5 / 1.5 / 3
  spinPer180: 40, // F3. 20 / 40 / 80
  spinCapHalfTurns: 6, // F3. 4 / 6 / 8
  landingGrace: 0.1, // s; a grab younger than this at the touchdown is void (R10). 0.05 / 0.1 / 0.2
  stumbleStyleLoss: 0.25, // R10. 0 / 0.25 / 0.5
  stumbleKeep: 0.5, // F5 L on a stumble. 0.25 / 0.5 / 0.75
  stumbleSpeedKeep: 0.7, // R10. 0.5 / 0.7 / 0.9
  bailBank: 0.25, // F7. 0 / 0.25 / 0.5
  beatPerfectBonus: 1.75, // F6. 1.5 / 1.75 / 2
  oneButtonHold: 0.5, // s (R12). 0.3 / 0.5 / 0.8
  // Prototype toggle, not in the GDD (owner choice 2026-11-23, for playtest 1):
  // a left or right direction that is still held and started more than this
  // before the press is a carve, not a fresh direction. null = off (the GDD rule).
  carveGuard: null,
};

// Prototype toggles for playtest 1 (owner choice 2026-11-23). Off by default.
export const CARVE_GUARD = 0.1; // s
export const SHORT_FLICK = 16; // px

// R12.3 "Relaxed timing" overrides.
export const RELAXED = { dirBefore: 0.25, dirAfter: 0.1, flickMaxMs: 250, landingGrace: 0.2 };

export const withRelaxed = (k = TRICK) => ({ ...k, ...RELAXED });

// Copies of the present production values that the GDD keeps.
export const COMBO = {
  linkWindow: 0.8,
  grindBase: 100,
  grindPerMeter: 35,
  longGrindMeters: 10,
  rampAirPoints: 100,
  hopPoints: 50,
  vertAirPoints: 200,
  minAirTime: 0.2,
  styleGain: 0.25,
  bailStyleLoss: 0.5,
  beatBonus: 1.5,
  repeatDecay: [1, 0.5, 0.25],
  maxMultiplier: 10,
};

export const BEAT = { bpm: 100, perfectMs: 20, goodMs: 60 };

export const STYLE = { minSpeed: 1.5 };

export const GRIND = { buffer: 0.15, snapRadius: 1.2, snapAbove: 0.9, snapBelow: 0.35, endPop: 0.8, resnapCooldown: 0.4 };

// The greybox skater. Simple values, not the production controller.
export const SKATE = {
  pushAccel: 6, // m/s^2 while push is held
  maxPushSpeed: 9, // m/s
  brakeDecel: 8, // m/s^2
  coastDecel: 0.25, // m/s^2 roll friction
  coastDrag: 0.02, // 1/s speed drag
  turnRate: 2.4, // rad/s ground carve at full steer
  airTurnRate: 3, // rad/s (R4: present value)
  gravity: 9.8, // m/s^2
  jumpSpeed: 3.2, // m/s up on JUMP (a hop of about 0.65 s)
  kickerLaunch: 0.55, // vy = kickerLaunch * speed, capped
  kickerMaxVy: 5.2,
  wallKeep: 0.3, // speed kept on a wall hit
};
