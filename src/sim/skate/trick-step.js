// The trick input rules on one sim tick (docs/gdd/trick-input.md R3 to R10,
// R12.1 for the air). Pure: `stepSkater` (skater.js) calls these functions
// on its own fresh copy of the state `s`, and the functions return it.
//
// The tick events for the run (run.js) are on the state:
//   s.landing      the touchdown result { result, grab, hold, airYaw, airFrom, airTime }
//   s.manualCap    the manual reached manualCapMeters: { toe, meters, pressT }
//   s.manualEnd    the manual ended: { toe, meters, pressT, capped, result, reason }
//   s.justManual   a manual started on this tick ({ link } for the grind-to-manual link)
//   s.grindPressed a GRIND press on this tick (the judged moment of a manual)

import { STYLE, TRICK, TRICK_RELAXED, COMBO, styleDuration } from "./constants.js";
import { freshDir, dirHistory, resolvePending, resolvePress } from "./direction.js";
import { manualOut, manualStep } from "./manual.js";
import { MANUALS, ONE_BUTTON_AIR, danceFor, grabFor, grindName, stanceFor } from "./tricks.js";

const EPS = 1e-6;
const BUTTONS = ["style1", "style2"];

// skaterEnv.tricks: true, or { oneButton, relaxed, k }. Returns null when off.
// The options object is made once per tricks object.
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
  if (flick) return stanceFor(flick) ? flick : "n";
  const pressNow = Boolean(input.grind) && !prev.grindHeld;
  if (!pressNow && prev.grindPress?.dir && prev.grindPress.dir !== "n") return prev.grindPress.dir;
  return freshDir(dirHistory(input), now, T.k);
}

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
  s.grab = { ...g, dir, startAir: s.airTime, hold: 0, held: Boolean(held) };
}

function startManual(s, { dir = "n", pressT, link = false, side }) {
  s.manual = { balance: 0, side, meters: 0, toe: dir === "u", dir, pressT, capped: false, link };
  s.justManual = { link };
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
  s.manualCap = null;
  s.manualEnd = null;
  s.justManual = null;
  s.justStyled = null;
  s.refused = prev.refused ?? null;
  s.manual = prev.manual ? { ...prev.manual } : null;
  s.grab = prev.state === "air" && prev.grab ? { ...prev.grab } : null; // kept to the touchdown tick
  s.manualSide = prev.manualSide ?? -1;
  const held = { style1: Boolean(input.style1), style2: Boolean(input.style2) };
  const prevHeld = { style1: Boolean(prev.styleHeld?.[0]), style2: Boolean(prev.styleHeld?.[1]) };
  const edge = (b) => held[b] && !prevHeld[b];
  const wantsGrind = Boolean(input.grind);
  const grindEdge = wantsGrind && !prev.grindHeld;
  const v0 = Math.abs(prev.speed ?? 0); // the speed gates read the speed at the start of the tick

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
    s.grind = { ...s.grind, stance: stanceFor(input.flick.grind) ? input.flick.grind : "n", flickDone: true };
  }
  if (s.state === "grind" && prev.state !== "grind" && input.flick?.grind) s.grind = { ...s.grind, flickDone: true };

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
      else if (!wantsGrind) endManual(s, "release", "clean", c);
      else if (Math.abs(s.speed) < k.manualMinSpeed - EPS) endManual(s, "slow", "clean", c);
    }
    // A new manual needs a new GRIND press.
    if (!s.manual && wantsGrind) s.grindNeedsRepress = true;
  }

  // --- Air: grabs (R4, R12.1) and the touchdown (R10) ---
  let pend = prev.trickPend ?? null;
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
    if (edge("style1") && !s.grab && !pend) {
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
    let grab = s.grab;
    let voided = null;
    // A late grab is void at the touchdown event (#334): no look-ahead.
    if (grab && s.airTime - grab.startAir < k.landingGrace - EPS) {
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

  // --- Ground: dance slots (R7) ---
  let style = prev.style ? { ...prev.style } : null;
  let repeat = null;
  if (style && (s.state !== "rolling" || s.manual)) style = null;
  if (style) {
    style.time += dt;
    style.held = held[BUTTONS[style.button]]; // style.button is the index 0 (TRICK) or 1 (SPIN)
    if (style.time >= style.duration) {
      s.justStyled = { id: style.id, name: style.name, points: style.points };
      stats.styles += 1;
      if (held[BUTTONS[style.button]]) repeat = style; // hold to repeat (R7)
      style = null;
    }
  }
  const canDance = s.state === "rolling" && !s.manual && v0 + EPS >= STYLE.minSpeed;
  const startDance = (button, dir) => {
    const move = STYLE.moves[BUTTONS.indexOf(button)];
    const d = danceFor(button, skaterEnv.skater, dir);
    style = { id: move.id, button: BUTTONS.indexOf(button), name: d.name, clip: d.clip, dir, time: 0, duration: styleDuration(d, skaterEnv.bpm), points: d.points, anim: move.anim, held: held[button] };
  };
  if (pend && pend.done) {
    if (!style && canDance) startDance(pend.button, pend.res.dir);
    pend = null;
  }
  if (!style && canDance) {
    if (repeat) style = { ...repeat, time: 0 };
    else if (!pend) {
      const button = BUTTONS.find((b) => edge(b));
      if (button) {
        const res = resolvePress(t, input, button, k);
        if (res.dir) startDance(button, res.dir);
        else pend = { button, ctx: "ground", res };
      }
    }
  }
  // A press that starts no trick (#264): the HUD says why.
  if (!style && !repeat && !prev.style && !pend) {
    const pressedSpin = edge("style2");
    const pressedTrick = edge("style1");
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
