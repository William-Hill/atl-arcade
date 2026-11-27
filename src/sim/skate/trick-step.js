// The trick input rules on one sim tick (docs/gdd/trick-input.md R3 to R10,
// R12.1 for the air). Pure: `stepSkater` (skater.js) calls these functions
// on its own fresh copy of the state `s`, and the functions return it.
//
// The tick events for the run (run.js) are on the state:
//   s.landing      the touchdown result { result, grab, hold, airYaw, airFrom, airTime }
//   s.manualCap    the manual reached manualCapMeters: { toe, meters, pressT }
//   s.manualEnd    the manual ended: { toe, meters, pressT, capped, result, reason }
//   s.justManual   a manual started on this tick ({ link } for the grind-to-manual link;
//                  { judgeNow } for a one-button manual, judged at its start)
//   s.grindPressed a GRIND press on this tick (the judged moment of a manual)
//
// One-button mode (R12.1, #328): the input layer runs stepOneButton()
// (src/input/one-button.js) with the sim context and puts its intent on the
// frame: `grind` (a GRIND hold) and `ob: { manual, start }`. With `ob` on
// the frame, the sim starts the grab and the dance of `ob.start` and holds a
// manual while `ob.manual` is true. With no `ob`, the sim takes the air set
// itself (ONE_BUTTON_AIR) on a TRICK press.

import { STYLE, TRICK, TRICK_RELAXED, COMBO, styleDuration } from "./constants.js";
import { freshDir, dirHistory, resolvePending, resolvePress } from "./direction.js";
import { manualOut, manualStep } from "./manual.js";
import { MANUALS, ONE_BUTTON_AIR, STANCES, danceFor, danceNamed, grabFor, grindName, stanceFor } from "./tricks.js";

const EPS = 1e-6;
const BUTTONS = ["style1", "style2"];

// skaterEnv.tricks: true, or { oneButton, relaxed, k, combo }. Returns null when off.
// The options object is made once per tricks object: to change a setting,
// give skaterEnv a new tricks object (a change in place has no effect).
const optCache = new WeakMap();
export function trickOptions(tricks) {
  if (!tricks) return null;
  if (tricks === true) return DEFAULT_OPTS;
  const cached = optCache.get(tricks);
  if (cached) return cached;
  const k = { ...TRICK, ...(tricks.relaxed ? TRICK_RELAXED : {}), ...(tricks.k ?? {}) };
  const out = { k, c: { ...COMBO, ...(tricks.combo ?? {}) }, oneButton: Boolean(tricks.oneButton) };
  optCache.set(tricks, out);
  return out;
}
const DEFAULT_OPTS = { k: TRICK, c: COMBO, oneButton: false };

// R8: in a manual, push and brake are off. The W/S keys move the balance.
export function trickInput(prev, input) {
  if (!prev.manual) return input;
  return { ...input, push: false, brake: false };
}

// R8: the roll friction in a manual is manualFriction times the present one.
const manualKs = new WeakMap();
export function manualSkate(skate, k = TRICK) {
  let byK = manualKs.get(skate);
  if (!byK) manualKs.set(skate, (byK = new Map()));
  let out = byK.get(k.manualFriction);
  if (!out) {
    out = { ...skate, coastDecel: skate.coastDecel * k.manualFriction, coastDrag: skate.coastDrag * k.manualFriction };
    byK.set(k.manualFriction, out);
  }
  return out;
}

// #339 airYaw: the signed sum of the steer turn in this air, with no wrap
// (controller.js wraps `yaw`). A turn back cancels a turn out. The sum
// starts at 0 on the tick the skater leaves the ground or the rail, and
// counts every tick of stepAir, the landing tick too (the landing then sets
// the yaw to the travel).
export function airTurn(prev, s, input, dt, skate) {
  if (prev.state !== "air") return 0;
  const steer = Math.max(-1, Math.min(1, input.steer ?? 0));
  const turn = Math.abs(steer) > 1e-3 ? steer * skate.airTurnRate * dt : 0;
  return (prev.airYaw ?? 0) + turn;
}

// R6: the stance at the snap. The flick of a touch GRIND press wins; then
// the fresh direction of the GRIND press; else the fresh direction at the
// snap (a buffered press).
export function trickStance(prev, input, dt, T) {
  const now = (prev.time ?? 0) + dt;
  const flick = input.flick?.grind;
  if (flick) return validStance(flick);
  const pressNow = Boolean(input.grind) && !prev.grindHeld;
  if (!pressNow && prev.grindPress?.dir && prev.grindPress.dir !== "n") return prev.grindPress.dir;
  return freshDir(dirHistory(input), now, T.k);
}

// A touch flick token that is not a direction gives the neutral stance.
const validStance = (d) => (Object.prototype.hasOwnProperty.call(STANCES, d) ? d : "n");

function grabTrick(g) {
  return { kind: "grab", id: g.id, name: g.name, clip: g.clip, dir: g.dir, held: g.held };
}

// The trick in progress, from the state.
function currentTrick(s, stanceMeters) {
  if (s.state === "grind" && s.grind) {
    const dir = s.grind.stance ?? "n";
    const st = stanceFor(dir);
    return { kind: "grind", id: st.id, name: grindName(s.grind.id, stanceMeters ?? s.grind.distance ?? 0, dir), clip: st.clip, dir, held: true };
  }
  if (s.manual) {
    const m = s.manual.toe ? MANUALS.toe : MANUALS.manual;
    return { kind: "manual", id: m.id, name: m.name, clip: m.clip, dir: s.manual.dir, held: true };
  }
  if (s.state === "air" && s.grab) return grabTrick(s.grab);
  if (s.style) return { kind: "dance", id: s.style.clip, name: s.style.name, clip: s.style.clip, dir: s.style.dir ?? "n", held: Boolean(s.style.held) };
  return null;
}

function startGrab(s, dir, held) {
  const g = grabFor(dir);
  // startT is on the sim clock: a coyote jump resets airTime, not the clock.
  s.grab = { ...g, dir, startAir: s.airTime, startT: s.time, hold: 0, held: Boolean(held) };
}

function startManual(s, { dir = "n", pressT, link = false, side, judgeNow = false }) {
  s.manual = { balance: 0, side, meters: 0, toe: dir === "u", dir, pressT, capped: false, link };
  s.justManual = judgeNow ? { link, judgeNow } : { link };
  s.style = null;
}

function endManual(s, reason, result, c) {
  const m = s.manual;
  s.manualEnd = { toe: m.toe, meters: m.meters, pressT: m.pressT, capped: m.capped, result, reason };
  if (result === "stumble") {
    s.speed *= c.stumbleSpeedKeep;
    s.velocity = s.velocity.map((v) => v * c.stumbleSpeedKeep);
  }
  s.manual = null;
  s.manualSide = m.side;
}

export function stepTricks(prev, s, input, dt, stats, skaterEnv, T) {
  const { k, c } = T;
  const t = s.time; // set by stepSkater
  s.landing = null;
  s.grabEarly = false; // a TRICK press before grabMinAir on this tick (no grab)
  s.manualCap = null;
  s.manualEnd = null;
  s.justManual = null;
  s.justStyled = null;
  s.refused = prev.refused ?? null;
  s.ignored = prev.ignored ?? null;
  s.manual = prev.manual ? { ...prev.manual } : null;
  s.grab = prev.state === "air" && prev.grab ? { ...prev.grab } : null; // kept to the touchdown tick
  s.manualSide = prev.manualSide ?? -1;
  const held = { style1: Boolean(input.style1), style2: Boolean(input.style2) };
  const prevHeld = { style1: Boolean(prev.styleHeld?.[0]), style2: Boolean(prev.styleHeld?.[1]) };
  const edge = (b) => held[b] && !prevHeld[b];
  const wantsGrind = Boolean(input.grind);
  const grindEdge = wantsGrind && !prev.grindHeld;
  const v0 = Math.abs(prev.speed ?? 0); // the speed gates read the speed at the start of the tick
  const ob = T.oneButton && input.ob && typeof input.ob === "object" ? input.ob : null;
  const obManual = Boolean(ob && ob.manual);

  // GRIND press: R3 for the stance and the Toe Roll, and the manual hold timer.
  s.grindPressed = grindEdge;
  let gp = prev.grindPress ?? null;
  if (grindEdge) gp = { at: t, ...resolvePress(t, input, "grind", k) };
  else if (gp && gp.pending !== undefined) gp = { at: gp.at, ...resolvePending(gp, t, input, "grind", k) };
  if (!wantsGrind) gp = null;
  s.grindPress = gp;
  // A GRIND press in the air with no rail starts no manual at the touchdown (R8).
  s.grindNeedsRepress = wantsGrind && Boolean(prev.grindNeedsRepress || (grindEdge && prev.state === "air" && s.state !== "grind"));
  if (s.state === "grind") s.grindNeedsRepress = false;
  // The grind-to-manual link (R8): GRIND held with no release from a grind exit.
  let fromExit = wantsGrind && Boolean(prev.grindHeldFromExit);
  if (s.justExited && wantsGrind) fromExit = true;
  if (s.state === "grind") fromExit = false;

  // R6, phone: the stance comes at the flick resolve, once, if the snap came first.
  if (s.state === "grind" && prev.state === "grind" && input.flick?.grind && !s.grind.flickDone) {
    s.grind = { ...s.grind, stance: validStance(input.flick.grind), flickDone: true, stancePending: false };
  }
  if (s.state === "grind" && prev.state !== "grind" && input.flick?.grind) s.grind = { ...s.grind, flickDone: true };
  // R3 for the stance: a GRIND press with no fresh direction at the snap
  // waits dirAfter; the first direction in that time sets the stance, once.
  if (s.state === "grind" && prev.state !== "grind" && !s.grind.flickDone && (s.grind.stance ?? "n") === "n" && gp && gp.pending !== undefined) {
    s.grind = { ...s.grind, stancePending: true };
  }
  if (s.state === "grind" && s.grind.stancePending && prev.state === "grind") {
    if (!gp) s.grind = { ...s.grind, stancePending: false };
    else if (gp.dir) s.grind = { ...s.grind, stance: validStance(gp.dir), stancePending: false };
  }

  // A respawn ends every trick.
  if (s.respawned) {
    s.manual = null;
    s.grab = null;
    s.style = null;
    fromExit = false;
  }

  // --- Manual (R8, F1, F2) ---
  if (s.manual) {
    const m = s.manual;
    if (s.state === "grind") endManual(s, "rail", "clean", c);
    else if (s.state === "air") endManual(s, s.justJumped ? "jump" : "launch", "clean", c);
    else {
      m.balance = manualStep(m.balance, m.side, input.balance, dt, k);
      m.meters += Math.hypot(s.position[0] - prev.position[0], s.position[2] - prev.position[2]);
      if (!m.capped && m.meters + EPS >= k.manualCapMeters) {
        s.manualCap = { toe: m.toe, meters: m.meters, pressT: m.pressT };
        m.capped = true;
      }
      if (manualOut(m.balance)) endManual(s, "balance", "stumble", c);
      else if (!wantsGrind && !obManual) endManual(s, "release", "clean", c);
      else if (Math.abs(s.speed) < k.manualMinSpeed - EPS) endManual(s, "slow", "clean", c);
    }
    // A new manual needs a new GRIND press.
    if (!s.manual && wantsGrind) s.grindNeedsRepress = true;
  }
  // One-button: a manual that ended needs a new TRICK hold.
  s.obManualSpent = obManual && Boolean(prev.obManualSpent || (prev.manual && !s.manual));

  // --- Air: grabs (R4, R12.1) and the touchdown (R10) ---
  let pend = s.respawned ? null : (prev.trickPend ?? null); // a respawn ends a pending press
  if (pend && pend.ctx === "air" && s.state !== "air") pend = null;
  if (pend && pend.ctx === "ground" && (s.state !== "rolling" || s.manual)) pend = null;
  if (pend) {
    const res = resolvePending(pend.res, t, input, pend.button, k);
    if (res.dir) {
      if (pend.ctx === "air" && !s.grab) startGrab(s, res.dir, held.style1);
      pend = pend.ctx === "ground" ? { ...pend, res, done: true } : null;
    } else pend = { ...pend, res };
  }
  s.obAir = prev.obAir ?? 0;
  if (s.state === "air" && prev.state === "air") {
    if (ob) {
      // One-button: the grab of the set that the input took (never a stumble).
      if (ob.start && ob.start.kind === "grab" && !s.grab) {
        if (s.airTime + EPS < k.grabMinAir) s.grabEarly = true;
        else startGrab(s, ob.start.dir ?? "n", held.style1);
      }
    } else if (edge("style1") && !s.grab && !pend) {
      if (s.airTime + EPS < k.grabMinAir) s.grabEarly = true;
      else if (T.oneButton) {
        startGrab(s, ONE_BUTTON_AIR[s.obAir % ONE_BUTTON_AIR.length], true);
        s.obAir += 1;
      } else {
        const res = resolvePress(t, input, "style1", k);
        if (res.dir) startGrab(s, res.dir, true);
        else pend = { button: "style1", ctx: "air", res };
      }
    }
    if (s.grab && s.grab.held) {
      if (held.style1) s.grab.hold += dt;
      else s.grab.held = false;
    }
  }
  if (s.justLanded && prev.state === "air") {
    // An air shorter than COMBO.minAirTime has no grab and no link (GDD Edge Cases), so no stumble.
    let grab = prev.airTime + EPS >= c.minAirTime ? s.grab : null;
    let voided = null;
    // A late grab is void at the touchdown event (#334): no look-ahead.
    if (grab && t - grab.startT < k.landingGrace - EPS) {
      voided = grab;
      grab = null;
    }
    // A grab still held at the touchdown is a stumble, but not in one-button mode (#334).
    const stumble = Boolean(grab && grab.held && held.style1 && !T.oneButton);
    if (stumble) {
      s.speed *= c.stumbleSpeedKeep;
      s.velocity = s.velocity.map((v) => v * c.stumbleSpeedKeep);
    }
    s.landing = { result: stumble ? "stumble" : "clean", grab, voided, hold: grab ? grab.hold : 0, airYaw: s.airYaw, airFrom: prev.airFrom, airTime: prev.airTime };
    s.grab = null;
    pend = null;
  }
  if (s.state !== "air") s.grab = null;

  // The grind-to-manual link starts at the touchdown frame.
  if (s.justLanded && fromExit && wantsGrind && s.state === "rolling" && !s.manual && Math.abs(s.speed) + EPS >= k.manualMinSpeed) {
    startManual(s, { dir: "n", pressT: t, link: true, side: -s.manualSide });
  }
  if (s.justLanded || s.state === "rolling") fromExit = false;
  s.grindHeldFromExit = fromExit;

  // A GRIND held for manualDelay on the ground with no rail starts a manual.
  if (!s.manual && !prev.manual && s.state === "rolling" && prev.state === "rolling" && wantsGrind && gp && !s.grindNeedsRepress && t - gp.at + EPS >= k.manualDelay && v0 + EPS >= k.manualMinSpeed) {
    startManual(s, { dir: gp.dir ?? "n", pressT: gp.at, side: -s.manualSide });
  }

  // One-button: a TRICK hold of oneButtonHold on the ground starts a manual (R12.1).
  if (obManual && !s.obManualSpent && !s.manual && !prev.manual && s.state === "rolling" && prev.state === "rolling" && v0 + EPS >= k.manualMinSpeed) {
    // No GRIND press: the beat judges the manual at its start (run.js).
    startManual(s, { dir: "n", pressT: t, side: -s.manualSide, judgeNow: true });
  }

  // --- Ground: dance slots (R7) ---
  let style = prev.style && !s.respawned ? { ...prev.style } : null; // a respawn ends a dance
  let repeat = null;
  if (style && (s.state !== "rolling" || s.manual)) style = null;
  if (style) {
    style.time += dt;
    style.held = held[BUTTONS[style.button]]; // style.button is the index 0 (TRICK) or 1 (SPIN)
    if (style.time >= style.duration) {
      s.justStyled = { id: style.id, name: style.name, points: style.points, dir: style.dir ?? "n" };
      stats.styles += 1;
      // Hold to repeat (R7). In one-button mode a TRICK dance starts at the
      // release, so a TRICK down at the end is the next press, not a hold.
      if (held[BUTTONS[style.button]] && !(ob && style.button === 0)) repeat = style;
      style = null;
    }
  }
  const canDance = s.state === "rolling" && !s.manual && v0 + EPS >= STYLE.minSpeed;
  const startDance = (button, dir) => {
    const move = STYLE.moves[BUTTONS.indexOf(button)];
    const d = danceFor(button, skaterEnv.skater, dir);
    style = { id: move.id, button: BUTTONS.indexOf(button), name: d.name, clip: d.clip, dir, time: 0, duration: styleDuration(d, skaterEnv.bpm), points: d.points, anim: move.anim, held: held[button] };
  };
  // One-button: the dance of the set that the input took, by its name.
  const startObDance = (st) => {
    const button = st.button === "style2" ? "style2" : "style1";
    const move = STYLE.moves[BUTTONS.indexOf(button)];
    const d = danceNamed(st.name) ?? danceFor(button, skaterEnv.skater, st.dir ?? "n");
    style = { id: move.id, button: BUTTONS.indexOf(button), name: d.name, clip: d.clip, dir: st.dir ?? "n", time: 0, duration: styleDuration(d, skaterEnv.bpm), points: d.points, anim: move.anim, held: false };
  };
  const obDance = ob && ob.start && ob.start.kind === "dance" ? ob.start : null;
  if (pend && pend.done) {
    if (!style && canDance) startDance(pend.button, pend.res.dir);
    pend = null;
  }
  if (!style && canDance) {
    if (repeat) style = { ...repeat, time: 0 };
    else if (obDance) startObDance(obDance);
    else if (!pend) {
      // In one-button mode TRICK starts no dance at the press (R12.1).
      const button = BUTTONS.find((b) => edge(b) && !(ob && b === "style1"));
      if (button) {
        const res = resolvePress(t, input, button, k);
        if (res.dir) startDance(button, res.dir);
        else pend = { button, ctx: "ground", res };
      }
    }
  }
  // A TRICK or SPIN press while a dance runs starts nothing (the dance
  // goes on). The HUD shows "BUSY" and the dance name (docs/ux/trick-hud.md
  // 6.1). Not in one-button mode: there a TRICK press has another job.
  if (style && prev.style && !T.oneButton && (edge("style1") || edge("style2"))) {
    s.ignored = { name: style.name, seq: (prev.ignored?.seq ?? 0) + 1 };
  }
  // A press that starts no trick (#264): the HUD says why.
  if (!style && !repeat && !prev.style && !pend) {
    const pressedSpin = edge("style2");
    const pressedTrick = ob ? Boolean(obDance) : edge("style1");
    let reason = null;
    if (s.state === "air" && pressedSpin) reason = "air";
    else if (s.state === "grind" && (pressedSpin || pressedTrick)) reason = "grind";
    else if (s.state === "rolling" && !s.manual && (pressedSpin || pressedTrick) && v0 + EPS < STYLE.minSpeed) reason = "slow";
    if (reason) s.refused = { reason, seq: (prev.refused?.seq ?? 0) + 1 };
  }
  s.trickPend = pend;
  s.style = style;
  s.styleHeld = [held.style1, held.style2];
  s.styleCount = prev.styleCount ?? [0, 0];
  s.trick = currentTrick(s);
  s.stats = stats;
  return s;
}
