// The greybox skater sim of the trick input prototype (#326). Pure: no DOM,
// no Three.js. One call of stepSim() is one 60 Hz frame.
//
// It is a small copy of the game rules, not the production controller: a
// capsule on a flat pad with one rail and one kicker. It implements the trick
// rules of docs/gdd/trick-input.md: R3 (fresh direction), R4 (grabs), R5,
// R6 (grind stances), R7 (dances), R8 (manual and the grind-to-manual link),
// R10 (landings), R11 (the touch flick), R12.1 (one-button mode), and the
// scoring F1 to F7 (in manual.js and scoring.js).
//
// Not in the prototype: the grind balance and the grind bail (the pure combo
// bail is tested in scoring.test.js), vert ramps, drops off edges, switch.

import { BEAT, COMBO, DT, EPS, GRIND, SKATE, STYLE, TRICK } from "./constants.js";
import { isFresh, resolvePress, resolvePending } from "./direction.js";
import { manualStep, manualPoints } from "./manual.js";
import { airPoints, beatOffsetMs, beatTag, comboMove, comboTick, createCombo, grindPoints } from "./scoring.js";
import { GRABS, STANCES, ONE_BUTTON, danceFor, grindName, MANUAL_NAMES } from "./tricks.js";

// The greybox level: a flat pad, one rail, one kicker (GDD, Prototype Plan).
export const LEVEL = {
  pad: { minX: -32, maxX: 32, minZ: -16, maxZ: 16 },
  rail: { x0: -14, x1: -4, z: 0, h: 0.5, edge: "Rail" },
  kicker: { x0: 3, x1: 5.5, zMin: -2.2, zMax: 2.2, h: 0.8 },
  spawn: { x: -27, z: 0, yaw: 0 },
};

export function createSim({ level = LEVEL, skater = "nia", k = TRICK, oneButton = false, beat = true, bpm = BEAT.bpm } = {}) {
  return {
    t: 0,
    frame: 0,
    level,
    skater,
    k,
    oneButton,
    beat,
    bpm,
    x: level.spawn.x,
    z: level.spawn.z,
    y: 0,
    vy: 0,
    yaw: level.spawn.yaw,
    speed: 0,
    mode: "ground", // ground | air | grind | manual
    prev: { trick: false, spin: false, grind: false, jump: false },
    air: null,
    grind: null,
    manual: null,
    dance: null,
    pend: null, // a press that waits for R3 dirAfter: { button, ctx, res }
    grindPress: null, // { t, res, fromAir }
    grindNeedsRepress: false,
    grindHeldFromExit: false,
    resnapAt: -Infinity,
    manualSide: 1,
    trick: null, // { kind, id, name, clip, dir, held }
    lastLanding: null,
    ob: { air: 0, grindIdx: 0, ground: 0, downAt: null, grind: false, manual: false },
    combo: createCombo(),
    events: [],
    log: [], // all events, for the telemetry
  };
}

const heading = (s) => ({ hx: Math.cos(s.yaw), hz: Math.sin(s.yaw) });

function emit(s, type, data = {}) {
  const e = { type, t: s.t, frame: s.frame, ...data };
  s.events.push(e);
  s.log.push(e);
}

function offsetAt(s, t) {
  return s.beat ? beatOffsetMs(t, s.bpm) : null;
}

function addLink(s, link) {
  const before = s.combo;
  s.combo = comboMove(s.combo, link, s.k, COMBO);
  const l = s.combo.links[s.combo.links.length - 1];
  emit(s, "link", { name: l.name, move: l.move, points: l.points, earned: l.earned, tag: l.tag, landing: l.landing, links: s.combo.links.length, multiplier: s.combo.multiplier, pendingBefore: before.pending });
}

// --- Rail ---------------------------------------------------------------

export function railInRange(s) {
  const r = s.level.rail;
  if (s.x < r.x0 - EPS || s.x > r.x1 + EPS) return false;
  if (Math.abs(s.z - r.z) > GRIND.snapRadius) return false;
  const dy = r.h - s.y; // + when the rail is above the feet
  if (dy > GRIND.snapAbove || dy < -GRIND.snapBelow - 2) return false;
  if (Math.abs(Math.cos(s.yaw)) < 0.5) return false;
  return true;
}

function snap(s, input) {
  if (s.manual) endManual(s, "rail");
  const r = s.level.rail;
  const along = Math.cos(s.yaw) >= 0 ? 1 : -1;
  let dir = "n";
  let pendingFlick = false;
  if (s.ob.grind) {
    dir = ONE_BUTTON.grind[s.ob.grindIdx % ONE_BUTTON.grind.length];
    s.ob.grindIdx += 1;
  } else if (input.touchGrind || s.touchGrindDir !== undefined) {
    // R6, phone: the stance comes at the flick resolve.
    if (s.touchGrindDir) dir = s.touchGrindDir;
    else pendingFlick = true;
  } else if (s.grindPress && s.grindPress.res.dir && s.grindPress.res.dir !== "n") dir = s.grindPress.res.dir;
  else if (isFresh(input.lastDir, input.lastDirAt, s.t, s.k)) dir = input.lastDir;
  s.mode = "grind";
  s.y = r.h;
  s.vy = 0;
  s.z = r.z;
  s.yaw = along > 0 ? 0 : Math.PI;
  s.speed = Math.max(s.speed, 2.5);
  s.grind = { dir, along, meters: 0, snapT: s.t, pendingFlick, changed: false };
  s.air = null;
  s.dance = null;
  s.pend = null;
  s.touchGrindDir = undefined;
  setGrindTrick(s);
  emit(s, "snap", { stance: STANCES[dir].id, dir });
  emit(s, "trick", { kind: "grind", id: STANCES[dir].id, dir, name: grindName(r.edge, dir, 0) });
}

function setGrindTrick(s) {
  const st = STANCES[s.grind.dir];
  s.trick = { kind: "grind", id: st.id, name: grindName(s.level.rail.edge, s.grind.dir, s.grind.meters), clip: st.clip, dir: s.grind.dir, held: true };
}

function exitGrind(s, how, input) {
  const g = s.grind;
  const name = grindName(s.level.rail.edge, g.dir, g.meters, COMBO.longGrindMeters);
  addLink(s, { move: "grind", name, points: grindPoints(g.meters, g.dir, s.k), offsetMs: offsetAt(s, g.snapT) });
  emit(s, "grind-exit", { how, meters: g.meters });
  s.grind = null;
  s.resnapAt = s.t + GRIND.resnapCooldown;
  s.grindHeldFromExit = !!effGrind(s, input);
  const base = how === "jump" ? COMBO.hopPoints : 0;
  const vy = how === "jump" ? SKATE.jumpSpeed : how === "end" ? GRIND.endPop : 0;
  startAir(s, vy, base, how === "jump" ? "Hop" : null);
}

// --- Air ----------------------------------------------------------------

function startAir(s, vy, base, baseName) {
  s.mode = "air";
  s.vy = vy;
  s.air = { time: 0, base, baseName, grab: null, yaw: 0, pressedTooEarly: false };
  if (s.dance) s.dance = null;
  if (!(s.trick && s.trick.kind === "grind")) s.trick = null;
}

function startGrab(s, dir, held) {
  const g = s.oneButton ? ONE_BUTTON.air[s.ob.air++ % ONE_BUTTON.air.length] : GRABS[dir];
  const gdir = s.oneButton ? Object.keys(GRABS).find((d) => GRABS[d] === g) : dir;
  s.air.grab = { ...g, dir: gdir, startAir: s.air.time, hold: 0, held };
  s.trick = { kind: "grab", id: g.id, name: g.name, clip: g.clip, dir: gdir, held };
  emit(s, "trick", { kind: "grab", id: g.id, dir: gdir, name: g.name });
}

function touchdown(s, input) {
  const a = s.air;
  s.y = 0;
  s.vy = 0;
  s.mode = "ground";
  s.air = null;
  s.pend = s.pend && s.pend.ctx === "air" ? null : s.pend;
  let result = "clean";
  if (a.time + EPS >= COMBO.minAirTime) {
    let grab = a.grab;
    if (grab && a.time - grab.startAir < s.k.landingGrace - EPS) {
      emit(s, "grab-void", { id: grab.id });
      grab = null; // R10 late grab: void, no stumble
    }
    if (grab && grab.held && input.trick && !s.oneButton) result = "stumble";
    const name = grab ? grab.name : a.baseName;
    if (name) {
      const points = airPoints({ airBase: a.base, grab: grab ? (grab.dir === "n" ? "neutral" : "dir") : null, tHold: grab ? grab.hold : 0, yawDeg: (a.yaw * 180) / Math.PI }, s.k);
      addLink(s, { move: "air", name, points, offsetMs: offsetAt(s, s.t), landing: result });
    }
  }
  if (result === "stumble") s.speed *= s.k.stumbleSpeedKeep;
  s.lastLanding = result;
  emit(s, "land", { result, airTime: a.time });
  if (s.trick && s.trick.kind === "grab") s.trick = null;
  // R8: the grind-to-manual link.
  if (s.grindHeldFromExit && effGrind(s, input) && !railInRange(s) && s.speed + EPS >= s.k.manualMinSpeed) {
    startManual(s, "n", s.t, true);
  }
  s.grindHeldFromExit = false;
}

// --- Manual -------------------------------------------------------------

function startManual(s, dir, pressT, link = false) {
  const toe = dir === "u";
  s.manualSide = -s.manualSide;
  s.mode = "manual";
  s.manual = { m: 0, side: s.manualSide, meters: 0, toe, pressT, capped: false, link };
  s.dance = null;
  const name = toe ? MANUAL_NAMES.toe : MANUAL_NAMES.manual;
  s.trick = { kind: "manual", id: toe ? "toe" : "manual", name, clip: toe ? "manual_toe" : "manual", dir, held: true };
  emit(s, "manual-start", { toe, link });
  emit(s, "trick", { kind: "manual", id: s.trick.id, dir, name });
}

function endManual(s, reason) {
  const mn = s.manual;
  const stumble = reason === "balance";
  if (!mn.capped) {
    addLink(s, { move: "manual", name: mn.toe ? MANUAL_NAMES.toe : MANUAL_NAMES.manual, points: manualPoints(mn.meters, mn.toe, s.k), offsetMs: offsetAt(s, mn.pressT), landing: stumble ? "stumble" : "clean" });
  } else if (stumble) {
    s.combo = { ...s.combo, style: Math.max(0, s.combo.style - s.k.stumbleStyleLoss) };
  }
  if (stumble) {
    s.speed *= s.k.stumbleSpeedKeep;
    s.lastLanding = "stumble";
  }
  // A new manual needs a new GRIND press (a release clears this).
  s.grindNeedsRepress = true;
  emit(s, "manual-end", { reason, meters: mn.meters, m: mn.m });
  s.manual = null;
  s.mode = "ground";
  s.trick = null;
}

// --- Dances -------------------------------------------------------------

function startDance(s, button, dir) {
  let d;
  if (s.oneButton && button === "trick") {
    const set = ONE_BUTTON.ground[s.skater];
    d = set[s.ob.ground++ % set.length];
  } else d = danceFor(button, s.skater, dir);
  s.dance = { ...d, button, dir, startT: s.t, endT: s.t + (d.beats * 60) / s.bpm };
  s.trick = { kind: "dance", id: d.id, name: d.name, clip: `dance_${d.id}`, dir, held: true };
  emit(s, "trick", { kind: "dance", id: d.id, dir, name: d.name, button });
}

// --- Helpers ------------------------------------------------------------

// The GRIND action, with the one-button mode mapping (R12.1).
function effGrind(s, input) {
  if (input.grind) return true;
  return s.oneButton && input.trick && (s.ob.grind || s.ob.manual);
}

function friction(s, dt, factor = 1) {
  s.speed = Math.max(0, s.speed - (SKATE.coastDecel + SKATE.coastDrag * s.speed) * factor * dt);
}

function move(s, dt) {
  const { hx, hz } = heading(s);
  s.x += hx * s.speed * dt;
  s.z += hz * s.speed * dt;
  const p = s.level.pad;
  let hit = false;
  if (s.x < p.minX || s.x > p.maxX) {
    s.x = Math.max(p.minX, Math.min(p.maxX, s.x));
    s.yaw = Math.PI - s.yaw;
    hit = true;
  }
  if (s.z < p.minZ || s.z > p.maxZ) {
    s.z = Math.max(p.minZ, Math.min(p.maxZ, s.z));
    s.yaw = -s.yaw;
    hit = true;
  }
  if (hit) {
    s.speed *= SKATE.wallKeep;
    emit(s, "wall");
  }
}

function inKicker(s) {
  const kk = s.level.kicker;
  return s.x >= kk.x0 && s.x <= kk.x1 && s.z >= kk.zMin && s.z <= kk.zMax && Math.cos(s.yaw) > 0.5 && s.speed > 2;
}

function launch(s) {
  if (s.manual) endManual(s, "launch");
  s.dance = null;
  startAir(s, Math.min(SKATE.kickerMaxVy, SKATE.kickerLaunch * s.speed), COMBO.rampAirPoints, "Ramp Air");
  s.y = s.level.kicker.h;
  s.x = s.level.kicker.x1;
  emit(s, "launch", { speed: s.speed });
}

// --- The step -----------------------------------------------------------

// R3 for a press: the flick of a touch press wins; else the fresh-direction rule.
function pressRes(s, button, input) {
  const f = input.flick && input.flick[button];
  if (f) return { dir: f, at: s.t };
  return resolvePress(s.t, input.lastDir, input.lastDirAt, s.k);
}

export function stepSim(s, input, dt = DT) {
  s.events = [];
  s.t = Math.round((s.t + dt) * 1e9) / 1e9;
  s.frame += 1;
  const t = s.t;
  const press = (b) => input[b] && !s.prev[b];
  const release = (b) => !input[b] && s.prev[b];
  const grindDown = effGrind(s, input);
  const grindPressed = input.grind && !s.prev.grind;

  // One-button mode: TRICK takes the context (R12.1 table).
  let trickPress = press("trick");
  if (s.oneButton && trickPress) {
    if (s.mode === "grind" || s.mode === "manual") trickPress = false;
    else if (railInRange(s)) {
      s.ob.grind = true;
      s.grindPress = { t, res: { dir: "n" }, fromAir: s.mode === "air" };
      trickPress = false;
    } else if (s.mode === "ground") {
      s.ob.downAt = t;
      trickPress = false;
    }
  }
  if (s.oneButton && release("trick")) {
    if (s.ob.downAt != null && s.mode === "ground" && !s.ob.manual && s.speed + EPS >= STYLE.minSpeed && !s.dance) startDance(s, "trick", "n");
    s.ob.downAt = null;
    s.ob.grind = false;
    s.ob.manual = false;
  }

  // GRIND press: buffer, R3 for the stance, and the manual hold timer.
  if (grindPressed) {
    s.grindPress = { t, res: pressRes(s, "grind", input), fromAir: s.mode === "air" };
    if (s.mode === "air" && !railInRange(s)) s.grindNeedsRepress = true;
    if (input.touchGrind) s.touchGrindDir = null;
  }
  if (!input.grind && !(s.oneButton && input.trick)) s.grindNeedsRepress = false;
  if (s.grindPress && s.grindPress.res.pending !== undefined) s.grindPress.res = resolvePending(s.grindPress.res, t, input.lastDir, input.lastDirAt, s.k);
  // Touch GRIND: the stance arrives at the flick resolve (R6).
  if (input.flick && input.flick.grind) {
    if (s.mode === "grind" && s.grind.pendingFlick && !s.grind.changed) {
      s.grind.dir = input.flick.grind;
      s.grind.pendingFlick = false;
      s.grind.changed = true;
      setGrindTrick(s);
      emit(s, "stance-change", { dir: s.grind.dir, stance: STANCES[s.grind.dir].id });
    } else if (s.mode !== "grind") s.touchGrindDir = input.flick.grind;
  }

  // A pending R3 press (dirAfter).
  if (s.pend) {
    s.pend.res = resolvePending(s.pend.res, t, input.lastDir, input.lastDirAt, s.k);
    if (s.pend.res.dir) {
      const p = s.pend;
      s.pend = null;
      if (p.ctx === "air" && s.mode === "air" && !s.air.grab) startGrab(s, p.res.dir, input.trick);
      if (p.ctx === "ground" && s.mode === "ground" && !s.dance) startDance(s, p.button, p.res.dir);
    }
  }

  // The speed gates (dance, manual) read the speed at the start of the frame.
  const v0 = s.speed;

  if (s.mode === "ground") {
    // Dances (R7): TRICK or SPIN.
    for (const b of ["trick", "spin"]) {
      const pressed = b === "trick" ? trickPress : press("spin");
      if (!pressed || s.dance || s.pend) continue;
      if (v0 + EPS < STYLE.minSpeed) {
        emit(s, "no-dance", { speed: v0 });
        continue;
      }
      const res = pressRes(s, b, input);
      if (res.dir) startDance(s, b, res.dir);
      else s.pend = { button: b, ctx: "ground", res };
    }
    if (s.dance && t + EPS >= s.dance.endT) {
      const d = s.dance;
      addLink(s, { move: "dance", name: d.name, points: d.points, offsetMs: offsetAt(s, t) });
      s.dance = null;
      s.trick = null;
      const held = d.button === "trick" ? input.trick : input.spin;
      if (held && !s.oneButton) startDance(s, d.button, d.dir); // hold to repeat
    }

    // Steer, push, brake.
    s.yaw += input.steer * SKATE.turnRate * dt;
    if (input.push) s.speed = Math.min(SKATE.maxPushSpeed, s.speed + SKATE.pushAccel * dt);
    else if (input.brake) s.speed = Math.max(0, s.speed - SKATE.brakeDecel * dt);
    friction(s, dt);

    // One-button hold: a manual at oneButtonHold.
    if (s.oneButton && s.ob.downAt != null && input.trick && !railInRange(s) && t - s.ob.downAt + EPS >= s.k.oneButtonHold && v0 + EPS >= s.k.manualMinSpeed) {
      s.ob.manual = true;
      s.ob.downAt = null;
      s.dance = null;
      startManual(s, "n", t);
    }

    // One-button: a TRICK held toward a rail snaps when the rail comes in range.
    if (s.oneButton && s.ob.downAt != null && input.trick && railInRange(s) && t - s.ob.downAt <= GRIND.buffer + EPS) {
      s.ob.downAt = null;
      s.ob.grind = true;
      s.grindPress = { t, res: { dir: "n" }, fromAir: false };
    }

    // GRIND: a rail in range snaps; else a hold of manualDelay starts a manual (R8).
    const buffered = s.grindPress && t - s.grindPress.t <= GRIND.buffer + EPS;
    if (s.mode === "ground" && (grindDown || buffered || (s.oneButton && s.ob.grind && input.trick)) && t >= s.resnapAt && railInRange(s)) snap(s, input);
    else if (s.mode === "ground" && grindDown && !s.oneButton && !s.grindNeedsRepress && s.grindPress && t - s.grindPress.t + EPS >= s.k.manualDelay && v0 + EPS >= s.k.manualMinSpeed && !railInRange(s)) {
      s.dance = null;
      startManual(s, s.grindPress.res.dir || "n", s.grindPress.t);
    }

    if (s.mode === "ground" && press("jump")) {
      s.dance = null;
      startAir(s, SKATE.jumpSpeed, COMBO.hopPoints, "Hop");
    }
    if (s.mode === "ground") {
      move(s, dt);
      if (inKicker(s)) launch(s);
    }
  } else if (s.mode === "manual") {
    const mn = s.manual;
    s.yaw += input.steer * SKATE.turnRate * dt;
    friction(s, dt, s.k.manualFriction);
    mn.m = manualStep(mn.m, mn.side, input.balance, dt, s.k);
    const before = s.speed;
    move(s, dt);
    mn.meters += before * dt;
    if (!mn.capped && mn.meters + EPS >= s.k.manualCapMeters) {
      addLink(s, { move: "manual", name: mn.toe ? MANUAL_NAMES.toe : MANUAL_NAMES.manual, points: manualPoints(mn.meters, mn.toe, s.k), offsetMs: offsetAt(s, mn.pressT) });
      mn.capped = true;
    }
    if (Math.abs(mn.m) >= 1 - EPS) endManual(s, "balance");
    else if (!grindDown) endManual(s, "release");
    else if (press("jump")) {
      endManual(s, "jump");
      startAir(s, SKATE.jumpSpeed, COMBO.hopPoints, "Hop");
    } else if (s.speed < s.k.manualMinSpeed - EPS) endManual(s, "slow");
    else if (t >= s.resnapAt && railInRange(s)) snap(s, input);
    else if (inKicker(s)) launch(s);
  } else if (s.mode === "grind") {
    const g = s.grind;
    s.speed = Math.max(2.5, s.speed - 0.6 * dt);
    s.x += g.along * s.speed * dt;
    g.meters += s.speed * dt;
    s.trick.name = grindName(s.level.rail.edge, g.dir, g.meters, COMBO.longGrindMeters);
    const r = s.level.rail;
    if (press("jump")) exitGrind(s, "jump", input);
    else if (s.x > r.x1 || s.x < r.x0) exitGrind(s, "end", input);
    else if (!grindDown) exitGrind(s, "release", input);
  } else if (s.mode === "air") {
    const a = s.air;
    a.time = Math.round((a.time + dt) * 1e9) / 1e9;
    // Air spin (R4): steer turns; airYaw is the signed sum with no wrap.
    const dyaw = input.steer * SKATE.airTurnRate * dt;
    s.yaw += dyaw;
    a.yaw += dyaw;
    // Grabs (R4). One-button mode: the next grab of the set.
    if (trickPress && !a.grab && !s.pend) {
      if (a.time + EPS < s.k.grabMinAir) emit(s, "grab-too-early", { airTime: a.time });
      else {
        const res = s.oneButton ? { dir: "n" } : pressRes(s, "trick", input);
        if (res.dir) startGrab(s, res.dir, input.trick);
        else s.pend = { button: "trick", ctx: "air", res };
      }
    }
    if (a.grab && a.grab.held) {
      if (input.trick) a.grab.hold += dt;
      else {
        a.grab.held = false;
        if (s.trick) s.trick.held = false;
      }
    }
    if (!effGrind(s, input)) s.grindHeldFromExit = false;
    s.vy -= SKATE.gravity * dt;
    s.y += s.vy * dt;
    move(s, dt);
    const buffered = s.grindPress && t - s.grindPress.t <= GRIND.buffer + EPS;
    if ((grindDown || buffered) && t >= s.resnapAt && s.vy <= 0 && railInRange(s) && s.y <= s.level.rail.h + 0.6) snap(s, input);
    else if (s.y <= 0) touchdown(s, input);
  }

  // The combo stays open while a move is in progress.
  const open = s.mode === "air" || s.mode === "grind" || (s.mode === "manual" && !s.manual.capped) || !!s.dance || !!s.pend;
  const was = s.combo;
  s.combo = comboTick(s.combo, dt, open, COMBO);
  if (was.active && !s.combo.active) emit(s, "bank", { banked: s.combo.lastBanked, links: was.links.length, names: was.links.map((l) => l.name), manual: was.links.some((l) => l.move === "manual") });

  s.prev = { trick: input.trick, spin: input.spin, grind: input.grind, jump: input.jump };
  return s;
}

// The HUD tag of the newest link (PERFECT, GOOD, WOBBLE).
export const lastTag = (s) => (s.combo.links.length ? s.combo.links[s.combo.links.length - 1].tag : null);
export { beatTag };

// Put the skater in a state, for the tests and the playtest trials.
export function place(s, { x, z, yaw, speed, mode = "ground", vy = 0, y = 0, base = 0, baseName = null } = {}) {
  if (x !== undefined) s.x = x;
  if (z !== undefined) s.z = z;
  if (yaw !== undefined) s.yaw = yaw;
  if (speed !== undefined) s.speed = speed;
  s.dance = null;
  s.manual = null;
  s.grind = null;
  s.pend = null;
  s.trick = null;
  if (mode === "air") {
    startAir(s, vy, base, baseName);
    s.y = y;
  } else {
    s.mode = "ground";
    s.y = 0;
    s.vy = 0;
    s.air = null;
  }
  return s;
}
