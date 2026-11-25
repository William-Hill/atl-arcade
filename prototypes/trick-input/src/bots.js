// Synthetic players for the automated playtest 1 (#326). Pure and seeded.
//
// IMPORTANT: these bots are a model of human timing, not humans. They test
// the input rules (R3, R11) against stated assumptions. The human playtest
// (5 or more players) is still open. The numbers depend on the profile
// values below; the report states them.
//
// A trial: one trick press with an intended direction, in one context (air
// grab, ground dance, or grind stance), with background input before it (push
// taps or a held push, carves). The bot makes raw device events; they go
// through input.js and sim.js, the same path as the page.

import { DT, TRICK } from "./constants.js";
import { createInput } from "./input.js";
import { applyEvent, run } from "./harness.js";
import { createSim, place } from "./sim.js";

// --- Seeded random ---------------------------------------------------------

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (mu = 0, sd = 1) => {
    const u = Math.max(1e-12, next());
    const v = next();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const uniform = (lo, hi) => lo + (hi - lo) * next();
  const pick = (arr) => arr[Math.floor(next() * arr.length)];
  return { next, normal, uniform, pick };
}

// --- Player profiles (assumptions) ---------------------------------------
//
// dirMeanMs, dirSdMs: when the direction key goes down, relative to the trick
//   press (negative = before). A real player who "presses both at once"
//   usually leads with the direction; the spread is the skill.
// pushProb: share of trials with push input in the 1.5 s before the press.
// tapShare: of those, the share with W taps (the rest hold W or Shift).
// shiftShare: share of push input made with Shift (no direction, R2).
// focusMs: a tapping player stops the push taps this long before the press...
// focusProb: ...with this probability. Else the taps go on with no regard to
//   the trick (the worst case for R3).
// carveProb: share of trials with a carve (A or D held) near the press.
// touch: flickPx (mean, sd), angleSdDeg, tapJitterPx (sd), flickMs (min, max).
// pad: the stick for the direction; carves use the same stick (R2).

export const PROFILES = [
  { id: "P1", label: "new, slow", dirMeanMs: -70, dirSdMs: 75, pushProb: 0.6, tapShare: 0.7, shiftShare: 0.0, focusMs: 250, focusProb: 0.7, carveProb: 0.5, touch: { flickPx: [34, 12], angleSdDeg: 18, tapJitterPx: 8, flickMs: [70, 160] } },
  { id: "P2", label: "casual", dirMeanMs: -55, dirSdMs: 60, pushProb: 0.6, tapShare: 0.6, shiftShare: 0.1, focusMs: 250, focusProb: 0.8, carveProb: 0.45, touch: { flickPx: [40, 12], angleSdDeg: 15, tapJitterPx: 7, flickMs: [60, 140] } },
  { id: "P3", label: "gamer", dirMeanMs: -45, dirSdMs: 45, pushProb: 0.6, tapShare: 0.5, shiftShare: 0.2, focusMs: 220, focusProb: 0.85, carveProb: 0.4, touch: { flickPx: [44, 10], angleSdDeg: 12, tapJitterPx: 6, flickMs: [50, 120] } },
  { id: "P4", label: "THPS veteran", dirMeanMs: -40, dirSdMs: 35, pushProb: 0.55, tapShare: 0.5, shiftShare: 0.3, focusMs: 200, focusProb: 0.9, carveProb: 0.35, touch: { flickPx: [46, 10], angleSdDeg: 10, tapJitterPx: 5, flickMs: [45, 110] } },
  { id: "P5", label: "rink skater, new to games", dirMeanMs: -60, dirSdMs: 65, pushProb: 0.65, tapShare: 0.8, shiftShare: 0.0, focusMs: 250, focusProb: 0.75, carveProb: 0.55, touch: { flickPx: [38, 14], angleSdDeg: 16, tapJitterPx: 8, flickMs: [60, 150] } },
];

const DIR_KEY = { l: "KeyA", r: "KeyD", u: "KeyW", d: "KeyS" };
const PAD_AXES = { n: [0, 0], l: [-0.9, 0], r: [0.9, 0], u: [0, -0.9], d: [0, 0.9] };
const PAD_TRICK = { air: 3, ground: 3, grind: 7 };
export const CONTEXTS = ["air", "ground", "grind"];
const TP = 1.6; // s: the press time in a trial

const keyEv = (code, down, t) => ({ kind: "key", code, down, t });
const padEv = (axes, btns, t) => ({ kind: "pad", axes, buttons: Array.from({ length: 16 }, (_, i) => (btns.includes(i) ? 1 : 0)), t });

// --- Keyboard trial ------------------------------------------------------

function keyboardEvents(r, p, ctx, intended) {
  const ev = [];
  const notes = { pushTaps: 0, pushTapsInWindow: 0, pushHeld: false, carve: null, carveInWindow: false };
  // Push input in the 1.5 s before the press.
  if (r.next() < p.pushProb) {
    const shift = r.next() < p.shiftShare;
    if (r.next() < p.tapShare) {
      const period = r.uniform(0.35, 0.7);
      const focused = r.next() < p.focusProb;
      const stopAt = focused ? TP - p.focusMs / 1000 : TP + 0.3;
      for (let t = r.uniform(0.05, period); t < stopAt; t += period * r.uniform(0.85, 1.15)) {
        const code = shift ? "ShiftLeft" : "KeyW";
        const len = r.uniform(0.08, 0.15);
        ev.push(keyEv(code, true, t), keyEv(code, false, t + len));
        notes.pushTaps += 1;
        if (!shift && t >= TP - TRICK.dirBefore - 1e-9 && t <= TP + TRICK.dirAfter) notes.pushTapsInWindow += 1;
      }
    } else {
      const code = shift ? "ShiftLeft" : "KeyW";
      ev.push(keyEv(code, true, r.uniform(0.05, 0.4)), keyEv(code, false, TP + r.uniform(-0.4, 0.4)));
      notes.pushHeld = true;
    }
  }
  // A carve near the press.
  if (r.next() < p.carveProb) {
    const side = r.next() < 0.5 ? "l" : "r";
    const start = TP + r.uniform(-1.2, 0.3);
    ev.push(keyEv(DIR_KEY[side], true, start), keyEv(DIR_KEY[side], false, start + r.uniform(0.2, 0.8)));
    notes.carve = side;
    notes.carveAt = Math.round((start - TP) * 1000);
    notes.carveInWindow = start >= TP - TRICK.dirBefore && start <= TP + TRICK.dirAfter;
  }
  // The intended direction.
  if (intended !== "n") {
    const at = TP + r.normal(p.dirMeanMs, p.dirSdMs) / 1000;
    const code = DIR_KEY[intended];
    // A held W must go up before it can go down again.
    ev.push(keyEv(code, false, at - 0.03), keyEv(code, true, at), keyEv(code, false, at + r.uniform(0.12, 0.25)));
  }
  // The trick button.
  if (ctx === "grind") ev.push(keyEv("KeyF", true, TP), keyEv("KeyF", false, TP + 0.6));
  else if (ctx === "air") ev.push(keyEv("KeyQ", true, TP), keyEv("KeyQ", false, TP + r.uniform(0.25, 0.45)));
  else ev.push(keyEv(r.next() < 0.5 ? "KeyQ" : "KeyE", true, TP), keyEv("KeyQ", false, TP + 0.08), keyEv("KeyE", false, TP + 0.08));
  return { ev, notes };
}

// --- Gamepad trial -------------------------------------------------------

function padEvents(r, p, ctx, intended) {
  const ev = [];
  const notes = { pushTaps: 0, pushTapsInWindow: 0, pushHeld: false, carve: null, carveInWindow: false };
  const btn = PAD_TRICK[ctx];
  // The stick does the carve and the direction (R2). Push is the X button.
  let carveSpan = null;
  if (r.next() < p.carveProb) {
    const side = r.next() < 0.5 ? "l" : "r";
    const start = TP + r.uniform(-1.2, 0.3);
    carveSpan = { side, start, end: start + r.uniform(0.2, 0.8) };
    notes.carve = side;
    notes.carveInWindow = start >= TP - TRICK.dirBefore && start <= TP + TRICK.dirAfter;
  }
  const dirAt = intended !== "n" ? TP + r.normal(p.dirMeanMs, p.dirSdMs) / 1000 : null;
  const dirEnd = dirAt != null ? dirAt + r.uniform(0.12, 0.25) : null;
  // Sample the pad every frame from 0 to TP + 0.5.
  for (let f = 1; f <= Math.ceil((TP + 0.5) / DT); f++) {
    const t = f * DT;
    let axes = [0, 0];
    if (carveSpan && t >= carveSpan.start && t < carveSpan.end) axes = [...PAD_AXES[carveSpan.side]];
    if (dirAt != null && t >= dirAt && t < dirEnd) axes = [...PAD_AXES[intended]];
    const pressed = [];
    if (t >= TP && t < TP + (ctx === "grind" ? 0.6 : 0.3)) pressed.push(btn);
    ev.push(padEv(axes, pressed, t - 1e-6));
  }
  return { ev, notes };
}

// --- Touch trial ---------------------------------------------------------

const BTN_POS = { trick: [880, 560], spin: [960, 480], grind: [800, 480] };

function touchEvents(r, p, ctx, intended) {
  const ev = [];
  const notes = { pushTaps: 0, pushTapsInWindow: 0, pushHeld: false, carve: null, carveInWindow: false, flickPx: 0 };
  const button = ctx === "grind" ? "grind" : ctx === "air" ? "trick" : r.next() < 0.5 ? "trick" : "spin";
  // The steer thumb on the stick: pushes (stick up) and carves (stick x). Not a direction source (R11).
  if (r.next() < p.pushProb) {
    ev.push({ kind: "stick", x: 0, y: 0.9, t: 0.1 }, { kind: "stick", x: 0, y: 0, t: TP - 0.2 });
    notes.pushHeld = true;
  }
  if (r.next() < p.carveProb) {
    const start = TP + r.uniform(-1.2, 0.3);
    const side = r.next() < 0.5 ? -0.9 : 0.9;
    ev.push({ kind: "stick", x: side, y: 0, t: start }, { kind: "stick", x: 0, y: 0, t: start + r.uniform(0.2, 0.8) });
    notes.carve = side < 0 ? "l" : "r";
  }
  const [x0, y0] = BTN_POS[button];
  // The press lands a little early or late, as a human thumb does.
  const t0 = TP;
  ev.push({ kind: "touchDown", id: 7, button, x: x0, y: y0, t: t0 });
  const { touch } = p;
  if (intended === "n") {
    // A tap: a small jitter, then a lift.
    const jx = r.normal(0, touch.tapJitterPx);
    const jy = r.normal(0, touch.tapJitterPx);
    const liftMs = r.uniform(50, 140);
    ev.push({ kind: "touchMove", id: 7, x: x0 + jx, y: y0 + jy, t: t0 + liftMs / 2000 });
    ev.push({ kind: "touchUp", id: 7, t: t0 + liftMs / 1000 });
    notes.flickPx = Math.hypot(jx, jy);
  } else {
    const base = { l: 180, r: 0, u: -90, d: 90 }[intended]; // screen degrees, y down
    const ang = ((base + r.normal(0, touch.angleSdDeg)) * Math.PI) / 180;
    const dist = Math.max(4, r.normal(touch.flickPx[0], touch.flickPx[1]));
    const dur = r.uniform(touch.flickMs[0], touch.flickMs[1]) / 1000;
    const steps = Math.max(2, Math.round(dur / 0.008));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      ev.push({ kind: "touchMove", id: 7, x: x0 + Math.cos(ang) * dist * k, y: y0 + Math.sin(ang) * dist * k, t: t0 + 0.005 + dur * k });
    }
    ev.push({ kind: "touchUp", id: 7, t: t0 + dur + (button === "grind" ? 0.6 : 0.25) });
    notes.flickPx = dist;
  }
  return { ev, notes };
}

// --- Run one trial -------------------------------------------------------

// The trick event of the trial press: the first trick (or snap) at or after the press.
function outcome(sim, ctx) {
  const after = sim.log.filter((e) => e.t >= TP - 1e-9);
  if (ctx === "grind") {
    const i = after.findIndex((e) => e.type === "snap");
    if (i < 0) return null;
    const s = after[i];
    // Phone: a flick that resolves after the snap changes the stance once (R6).
    const next = after.slice(i + 1);
    const end = next.findIndex((e) => e.type === "snap");
    const change = (end < 0 ? next : next.slice(0, end)).find((e) => e.type === "stance-change");
    return change ? { dir: change.dir, at: change.t } : { dir: s.dir, at: s.t };
  }
  const kind = ctx === "air" ? "grab" : "dance";
  const e = after.find((x) => x.type === "trick" && x.kind === kind);
  return e ? { dir: e.dir, at: e.t, name: e.name } : null;
}

export function runTrial({ device, ctx, intended, profile, seed, k = TRICK }) {
  const r = rng(seed);
  const gen = device === "keyboard" ? keyboardEvents : device === "gamepad" ? padEvents : touchEvents;
  const { ev, notes } = gen(r, profile, ctx, intended);
  const sim = createSim({ k, beat: false });
  const inp = createInput({ k });
  const frames = Math.ceil((TP + 0.6) / DT);
  if (ctx === "air") {
    // Roll, then a ramp air that is 0.35 s old at the press.
    place(sim, { x: 10, z: 8, yaw: 0, speed: 6 });
    const fAir = Math.round((TP - 0.35) / DT);
    const evA = ev.filter((e) => e.t <= fAir * DT + 1e-9);
    run(sim, inp, evA, fAir);
    sim.speed = 6;
    place(sim, { mode: "air", vy: 5, base: 100, baseName: "Ramp Air" });
    run(sim, inp, ev.filter((e) => e.t > fAir * DT + 1e-9), frames - fAir);
  } else if (ctx === "grind") {
    // The rail (x -14) comes in range 0.05 s after the press. Push input
    // would change the speed, so the trial holds 8 m/s before the press.
    place(sim, { x: -14 - 8 * (TP + 0.05), z: 0, yaw: 0, speed: 8 });
    // The player lines up with the rail: a carve before the press does not
    // steer off the line (the trial measures the direction, not the steer).
    run(sim, inp, ev, frames, (s) => {
      if (s.t < TP + 0.1 && s.mode === "ground") {
        s.speed = 8;
        s.yaw = 0;
        s.z = 0;
      }
    });
  } else {
    place(sim, { x: -10, z: 8, yaw: 0, speed: 6 });
    run(sim, inp, ev, frames, (s) => {
      if (s.mode === "ground") s.yaw = 0; // stay on the pad
    });
  }
  const out = outcome(sim, ctx);
  const result = out ? out.dir : null;
  return { device, ctx, intended, result, wanted: result === intended, latencyMs: out ? Math.round((out.at - TP) * 1000) : null, ...notes, profile: profile.id };
}

// --- A session of trials, and the metrics ---------------------------------

export function runSession({ profile, device, trials = 150, seed = 1, k = TRICK }) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < trials; i++) {
    const ctx = CONTEXTS[i % CONTEXTS.length];
    const intended = r.pick(["n", "l", "r", "u", "d"]);
    out.push(runTrial({ device, ctx, intended, profile, seed: Math.floor(r.next() * 2 ** 31), k }));
  }
  return out;
}

export function metrics(trials) {
  const n = trials.length;
  const wanted = trials.filter((t) => t.wanted).length;
  const notUp = trials.filter((t) => t.intended !== "u" && (t.pushTaps > 0 || t.pushHeld));
  const upLeak = notUp.filter((t) => t.result === "u").length;
  const withCarve = trials.filter((t) => t.carve && t.intended !== "l" && t.intended !== "r");
  const carveLeak = withCarve.filter((t) => t.result === "l" || t.result === "r").length;
  const missed = trials.filter((t) => t.result === null).length;
  const byIntent = {};
  for (const d of ["n", "l", "r", "u", "d"]) {
    const g = trials.filter((t) => t.intended === d);
    byIntent[d] = g.length ? g.filter((t) => t.wanted).length / g.length : null;
  }
  const lat = trials.filter((t) => t.latencyMs != null && t.ctx !== "grind").map((t) => t.latencyMs).sort((a, b) => a - b);
  return {
    trials: n,
    wantedShare: wanted / n,
    unwantedUpFromPush: notUp.length ? upLeak / notUp.length : 0,
    pushTrials: notUp.length,
    unwantedLRFromCarve: withCarve.length ? carveLeak / withCarve.length : 0,
    carveTrials: withCarve.length,
    noTrick: missed,
    byIntent,
    medianLatencyMs: lat.length ? lat[Math.floor(lat.length / 2)] : null,
  };
}

// --- Sensitivity: push taps with no regard to the trick --------------------

// A worst case: the player taps W every `period` s with no pause before the
// press, and wants a neutral trick. Returns the share that came out Up.
export function pushTapSweep({ period, k = TRICK, trials = 200, seed = 9 }) {
  const r = rng(seed);
  let up = 0;
  for (let i = 0; i < trials; i++) {
    const phase = r.uniform(0, period);
    const ev = [];
    for (let t = phase; t < TP + 0.3; t += period) ev.push(keyEv("KeyW", true, t), keyEv("KeyW", false, t + 0.1));
    ev.push(keyEv("KeyQ", true, TP), keyEv("KeyQ", false, TP + 0.08));
    const sim = createSim({ k, beat: false });
    const inp = createInput({ k });
    place(sim, { x: -10, z: 8, yaw: 0, speed: 6 });
    run(sim, inp, ev, Math.ceil((TP + 0.4) / DT), (s) => {
      s.yaw = 0;
      if (s.speed > 8) s.speed = 8;
    });
    const e = sim.log.find((x) => x.type === "trick" && x.t >= TP - 1e-9);
    if (e && e.dir === "u") up += 1;
  }
  return up / trials;
}

// --- The route bot: the first 3-link combo with a manual -------------------
//
// Push to the rail, grind with GRIND held, hold GRIND off the end into a
// manual (the grind-to-manual link), balance with W/S, roll onto the kicker,
// tap A and press Q in the air (Japan Grab), let go before the touchdown.
// The bot is closed-loop: it reads the sim each frame, as a player reads the
// screen, with a reaction delay. Returns the time of the first bank with 3
// links or more that has a manual.

export function routeBot({ profile = PROFILES[2], seed = 3, maxSeconds = 60, k = TRICK, onFrame, stopWhen } = {}) {
  const r = rng(seed);
  const sim = createSim({ k });
  const inp = createInput({ k });
  const react = () => Math.max(0.06, r.normal(0.18, 0.04));
  const ev = (code, down) => applyEvent(inp, keyEv(code, down, sim.t));
  const fresh = () => ({ pressedF: false, grinded: false, linked: false, launched: false, grabAt: null, releaseAt: null, next: 0, attempts: 0 });
  let st = fresh();
  let attempts = 1;
  ev("KeyW", true);
  let firstCombo = null;
  const frames = Math.round(maxSeconds / DT);
  const reset = () => {
    for (const c of ["KeyW", "KeyS", "KeyF", "KeyA", "KeyQ"]) ev(c, false);
    place(sim, { ...sim.level.spawn, speed: 0 });
    st = fresh();
    attempts += 1;
    ev("KeyW", true);
  };
  for (let f = 0; f < frames && firstCombo == null; f++) {
    run(sim, inp, [], 1);
    if (onFrame) onFrame(sim, st);
    if (stopWhen && stopWhen(sim, st)) break;
    const bank = sim.events.find((e) => e.type === "bank");
    if (bank && bank.links >= 3 && bank.manual) {
      firstCombo = { t: sim.t, bank };
      break;
    }
    const t = sim.t;
    if (st.grabAt != null && t >= st.grabAt) {
      ev("KeyQ", true);
      st.grabAt = null;
      st.releaseAt = t + r.uniform(0.3, 0.5);
    }
    if (st.releaseAt != null && t >= st.releaseAt) {
      ev("KeyQ", false);
      ev("KeyA", false);
      st.releaseAt = null;
    }
    if (t < st.next) continue;
    // Press and hold GRIND just before the rail.
    if (!st.pressedF && sim.x > -15.0) {
      ev("KeyW", false);
      ev("KeyF", true);
      st.pressedF = true;
    }
    if (sim.mode === "grind") st.grinded = true;
    if (sim.mode === "manual") {
      if (st.grinded) st.linked = true;
      // Balance: push against the lean, with a dead band and a reaction delay.
      const m = sim.manual.m;
      const up = inp.down.has("KeyW");
      const down = inp.down.has("KeyS");
      if (m > 0.15 && !up) {
        ev("KeyS", false);
        ev("KeyW", true);
        st.next = t + react() / 3;
      } else if (m < -0.15 && !down) {
        ev("KeyW", false);
        ev("KeyS", true);
        st.next = t + react() / 3;
      } else if (Math.abs(m) < 0.05 && (up || down)) {
        ev("KeyW", false);
        ev("KeyS", false);
      }
    }
    // Off the kicker: tap left, then TRICK (a Japan Grab).
    if (sim.mode === "air" && st.linked && !st.launched) {
      st.launched = true;
      for (const c of ["KeyW", "KeyS", "KeyF"]) ev(c, false);
      const lead = Math.max(0.017, (-profile.dirMeanMs + r.normal(0, profile.dirSdMs / 2)) / 1000);
      const at = t + react();
      st.next = at;
      st.aAt = at;
      st.grabAt = at + lead;
    }
    if (st.aAt != null && t >= st.aAt) {
      ev("KeyA", true);
      st.aAt = null;
    }
    // A miss: start again from the spawn point.
    const landedNoManual = sim.mode === "ground" && st.grinded && !st.linked;
    const manualLost = sim.mode === "ground" && st.linked && !st.launched;
    const doneNoBank = sim.mode === "ground" && st.launched && !sim.combo.active && st.grabAt == null && st.releaseAt == null;
    if (landedNoManual || manualLost || doneNoBank || t > attempts * 15) reset();
  }
  return { firstComboSec: firstCombo ? firstCombo.t : null, bank: firstCombo ? firstCombo.bank : null, attempts, log: sim.log, sim, inp };
}
