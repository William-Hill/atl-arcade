// Teach the moves in the world (#76). Pure: which move to show next, when a
// step is done, the prompt text and icons for the active input, the rail or
// ledge to show for the grind, and where its pin goes on the screen.
// src/ui/teach-prompt.js draws it; Vitest tests this file.
//
// One prompt at a time: push, steer, jump, dance, grind, then the 3 trick
// input steps of #331 (docs/gdd/trick-input.md, UI Requirements): a grab with
// a direction, a grind stance, and the manual link from a grind to a kicker.
// Then a combo tip. A move done before its turn counts, so its prompt does
// not show. In one-button mode (R12.1) the game does not read the direction,
// so the prompts show TRICK only and any grab or snap counts.

export const TEACH_STEPS = ["push", "steer", "jump", "dance", "grind", "grab", "stance", "link", "combo"];

// The steps that show the rail pin: each needs a rail or a ledge.
export const PIN_STEPS = ["grind", "stance", "link"];


export const TEACH = {
  pushTime: 0.6, // s of push held while rolling
  steerTime: 0.5, // s of steer held while rolling at speed
  steerMin: 0.3, // |steer| that counts as a steer
  steerSpeed: 1, // m/s needed for a steer to count
  comboLinks: 3, // links in one combo that end the combo tip
  comboTime: 12, // s: the combo tip goes after this time also
  doneMs: 700, // ms the check mark shows after a move
  targetRange: 250, // m: a rail or ledge farther than this gets no pin
};

// The rail and the ledge for the grind prompt, per level: real features near
// the spawn. Other levels use the nearest rail or ledge.
// BeltLine Eastside: the end rail and the line ledge of the Historic Fourth
// Ward skatepark, 58 to 67 m west of the spawn. A straight ride from the
// spawn reaches the rail in about 9 s (e2e/teach-ride.js).
export const TEACH_SPOTS = {
  "beltline-eastside": ["rail:skatepark:h4w-skatepark:end-rail:top", "ledge:skatepark:h4w-skatepark:line-ledge:front"],
};

export const TEACH_STORAGE_KEY = "atl.teach.v1";
// The saved value after all the steps. "done" is the value of the first
// version (#76, 5 moves): a player with it sees only the new steps (#331).
export const TEACH_DONE = "done-v2";
const TEACH_DONE_V1 = "done";
const FIRST_NEW = "grab";

// On or off: ?teach=1 forces the prompts (and starts them again), ?teach=0
// turns them off, ?teach=<step> starts at that step (for the tests). Else
// they show once per browser, on a geodata level.
export function teachMode(param, stored, geo) {
  if (param === "1" || TEACH_STEPS.includes(param)) return "on";
  if (param === "0") return "off";
  if (!geo) return "off";
  return stored === TEACH_DONE ? "off" : "on";
}

// The step to start at: the ?teach step, else the first new step for a
// player who finished the first version, else the first step.
export function teachStart(param, stored) {
  if (TEACH_STEPS.includes(param)) return param;
  if (param !== "1" && stored === TEACH_DONE_V1) return FIRST_NEW;
  return TEACH_STEPS[0];
}

export function createTeach(start = TEACH_STEPS[0]) {
  const n = Math.max(0, TEACH_STEPS.indexOf(start));
  const done = Object.fromEntries(TEACH_STEPS.slice(0, n).map((s) => [s, true]));
  return { done, step: TEACH_STEPS[n], push: 0, steer: 0, comboTime: 0, afterGrind: false, linkManual: false, finished: false, justDone: [] };
}

export function currentStep(done, steps = TEACH_STEPS) {
  return steps.find((s) => !done[s]) ?? null;
}

// One fixed tick. `prev` and `s` are the skater before and after the tick,
// `input` the sampled input, `combo` the run combo, `mode.oneButton` the
// one-button switch. Returns a new state; `justDone` lists the steps done in
// this tick.
export function stepTeach(t, prev, s, input = {}, combo = null, dt = 1 / 60, k = TEACH, mode = {}) {
  if (t.finished) return t.justDone.length ? { ...t, justDone: [] } : t;
  const done = { ...t.done };
  const justDone = [];
  const mark = (id) => {
    if (!done[id]) {
      done[id] = true;
      justDone.push(id);
    }
  };
  const rolling = s.state === "rolling";
  const push = rolling && input.push ? t.push + dt : t.push;
  if (push >= k.pushTime) mark("push");
  const steering = rolling && Math.abs(input.steer ?? 0) >= k.steerMin && s.speed >= k.steerSpeed;
  const steer = steering ? t.steer + dt : t.steer;
  if (steer >= k.steerTime) mark("steer");
  if (s.justJumped || (s.justExited && s.exitReason === "jump")) mark("jump");
  if (s.style && !prev.style) mark("dance");
  if (s.justSnapped) mark("grind");
  const ob = Boolean(mode.oneButton);
  // A grab with a direction (R4). One-button mode: any grab (the next of the set).
  if (s.grab && !prev.grab && (ob || (s.grab.dir ?? "n") !== "n")) mark("grab");
  // A grind stance (R6). The phone flick can set it after the snap, so every
  // grind tick counts. One-button mode: any snap (TRICK picks the stance).
  if (s.state === "grind" && (ob ? s.justSnapped : (s.grind?.stance ?? "n") !== "n")) mark("stance");
  // The manual link (R8): a grind, then a manual in the same combo, then an
  // air straight from the manual: a JUMP or a kicker (owner choice
  // 2026-11-27, #331: every ramp of the Eastside skatepark but the kicker has
  // a grind edge, and street levels have few kickers).
  let afterGrind = t.afterGrind;
  let linkManual = t.linkManual;
  if (s.state === "grind") afterGrind = true;
  else if (combo && !combo.active) afterGrind = false;
  if (prev.manual && !s.manual) {
    if (linkManual && s.state === "air") mark("link");
    linkManual = false;
  }
  if (s.manual && !prev.manual) linkManual = afterGrind;
  // The combo tip shows only after the moves.
  const step0 = currentStep(done);
  let comboTime = t.comboTime;
  if (step0 === "combo") {
    comboTime += dt;
    if ((combo?.links?.length ?? 0) >= k.comboLinks || comboTime >= k.comboTime) mark("combo");
  }
  const step = currentStep(done);
  return { done, step, push, steer, comboTime, afterGrind, linkManual, finished: step === null, justDone };
}

// The input kind for the icons: "touch", "gamepad", or "keyboard".
// `source` is input.source; before the first input a touch screen shows touch
// and a connected gamepad shows the gamepad.
export function inputKind(source, { touch = false, gamepad = false, started = true } = {}) {
  if (!started) return touch ? "touch" : gamepad ? "gamepad" : "keyboard";
  if (source === "touch" || source === "gamepad") return source;
  return "keyboard";
}

const KEY_NAMES = { Space: "Space", ShiftLeft: "Shift", ShiftRight: "Shift", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Enter: "Enter", Tab: "Tab" };

// A short label for a KeyboardEvent.code.
export function keyLabel(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return String(code);
}

// Up to `max` different labels of the keys bound to an action. Letters come
// first: W reads more plainly than Shift for a new player.
export function keyLabels(codes = [], max = 2) {
  const labels = [];
  const sorted = [...codes].sort((a, b) => Number(!/^Key/.test(a)) - Number(!/^Key/.test(b)));
  for (const c of sorted) {
    const l = keyLabel(c);
    if (!labels.includes(l)) labels.push(l);
    if (labels.length >= max) break;
  }
  return labels;
}

// Standard gamepad button indexes to the face and shoulder names.
const PAD_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "↑", "↓", "←", "→"];
export const padLabel = (index) => PAD_NAMES[index] ?? `B${index}`;

const TITLES = {
  push: "Push to roll",
  steer: "Steer",
  jump: "Jump",
  dance: "Dance while you roll",
  grind: "Grind the rail",
  grab: "Aim a grab",
  stance: "Grind with a stance",
  link: "Grind, manual, jump",
  combo: "Chain 3 moves for a combo",
};

// One-button mode (R12.1): TRICK does the move, with no direction.
const TITLES_ONE_BUTTON = { grab: "Grab in the air", stance: "Grind with TRICK" };

// The direction keys as one cap: "WASD" (up, left, down, right), or the
// arrows when the direction keys are the arrows only.
export function dirKeysLabel(kb = {}) {
  const labels = ["dirUp", "dirLeft", "dirDown", "dirRight"].map((a) => keyLabels(kb[a], 1)[0]).filter(Boolean);
  return labels.length ? labels.join("") : "WASD";
}

// The prompt of a step for an input kind. `bindings` is input.bindings.
// Each icon is { type: "key" | "pad" | "stick" | "touch", label }. `hint` is
// a short second line, or "". `oneButton` is the one-button switch (R12.1).
export function promptFor(step, kind, bindings = null, { oneButton = false } = {}) {
  const kb = bindings?.keyboard ?? {};
  const pad = bindings?.gamepad?.buttons ?? {};
  const keys = (action, max) => keyLabels(kb[action], max).map((label) => ({ type: "key", label }));
  const btn = (action) => (pad[action]?.length ? [{ type: "pad", label: padLabel(pad[action][0]) }] : []);
  // The icons of one action on this input, and the name of its first icon.
  const of = (action, touchLabel) => (kind === "touch" ? [{ type: "touch", label: touchLabel }] : kind === "gamepad" ? btn(action) : keys(action, 1));
  const nameOf = (action, touchLabel) => of(action, touchLabel)[0]?.label ?? touchLabel;
  const dir = kind === "gamepad" ? [{ type: "stick", label: "L" }] : [{ type: "key", label: dirKeysLabel(kb) }];
  const title = (oneButton && TITLES_ONE_BUTTON[step]) || TITLES[step] || "";
  let icons = [];
  let hint = "";
  if (step === "push") {
    icons = kind === "touch" ? [{ type: "stick", label: "↑" }] : kind === "gamepad" ? btn("push") : keys("push", 2);
    hint = kind === "touch" ? "Hold the stick up" : "Hold to speed up";
  } else if (step === "steer") {
    icons = kind === "touch" ? [{ type: "stick", label: "← →" }] : kind === "gamepad" ? [{ type: "stick", label: "L" }] : [...keys("left", 1), ...keys("right", 1)];
    hint = kind === "touch" ? "Move the stick left or right" : kind === "gamepad" ? "Left stick" : "";
  } else if (step === "jump") {
    icons = kind === "touch" ? [{ type: "touch", label: "JUMP" }] : kind === "gamepad" ? btn("jump") : keys("jump", 1);
  } else if (step === "dance") {
    icons = kind === "touch" ? [{ type: "touch", label: "TRICK" }, { type: "touch", label: "SPIN" }] : kind === "gamepad" ? [...btn("style1"), ...btn("style2")] : [...keys("style1", 1), ...keys("style2", 1)];
  } else if (step === "grind") {
    icons = kind === "touch" ? [{ type: "touch", label: "GRIND" }] : kind === "gamepad" ? btn("grind") : keys("grind", 1);
    hint = kind === "touch" ? "Ride to the rail, hold GRIND" : "Ride to the rail and hold";
  } else if (oneButton && (step === "grab" || step === "stance" || step === "link")) {
    // One-button mode: TRICK only, from the context (R12.1).
    icons = of("style1", "TRICK");
    const trick = nameOf("style1", "TRICK");
    hint = step === "grab" ? `In the air, tap ${trick} for the next grab` : step === "stance" ? `At the rail, tap ${trick} for the next stance` : `After a grind, hold ${trick}, then jump or hit a kicker`;
  } else if (step === "grab") {
    // R4: a direction with TRICK in the air. Touch: a flick from TRICK (R11).
    if (kind === "touch") {
      icons = of("style1", "TRICK");
      hint = "In the air, flick TRICK up, down, left, or right";
    } else {
      icons = [...dir, ...of("style1", "TRICK")];
      hint = kind === "gamepad" ? `In the air, tilt the stick and press ${nameOf("style1")}` : `In the air, tap a direction with ${nameOf("style1")}`;
    }
  } else if (step === "stance") {
    // R6: a direction with GRIND at the rail.
    if (kind === "touch") {
      icons = of("grind", "GRIND");
      hint = "At the rail, flick GRIND up, down, left, or right";
    } else {
      icons = [...dir, ...of("grind", "GRIND")];
      hint = kind === "gamepad" ? `At the rail, tilt the stick and press ${nameOf("grind")}` : `At the rail, tap a direction with ${nameOf("grind")}`;
    }
  } else if (step === "link") {
    // R8: GRIND held off the rail lands in a manual; then a kicker.
    icons = of("grind", "GRIND");
    hint = `Hold ${nameOf("grind", "GRIND")} off the rail, then jump or hit a kicker`;
  } else if (step === "combo") {
    hint = "Jump, grind, and dance before the combo ends";
  }
  return { step, title, icons, hint };
}

// The touch button to light up for a step on touch, or null. In one-button
// mode TRICK does the grab, the stance, and the manual.
export function touchButtonFor(step, { oneButton = false } = {}) {
  if (oneButton && (step === "stance" || step === "link")) return "style1";
  return { jump: "jump", dance: "style1", grind: "grind", grab: "style1", stance: "grind", link: "grind" }[step] ?? null;
}

// The rail or ledge for the grind pin: the nearest of the level's teach
// spots, else the nearest rail or ledge. Returns { id, kind, point, distance }
// or null. `point` is the middle of the feature.
export function teachTarget(grindables, position, ids = null, range = TEACH.targetRange) {
  const pool = ids && ids.length ? grindables.filter((g) => ids.includes(g.id)) : grindables.filter((g) => g.kind === "rail" || g.kind === "ledge");
  let best = null;
  for (const g of pool) {
    const pts = g.points;
    if (!pts?.length) continue;
    const mid = pts[Math.floor(pts.length / 2)];
    const d = Math.hypot(mid[0] - position[0], mid[2] - position[2]);
    if (d <= range && (!best || d < best.distance)) best = { id: g.id, kind: g.kind, point: [mid[0], mid[1], mid[2]], distance: d };
  }
  return best;
}

// The pin label: "Rail 62 m" or "Ledge 8 m".
export function pinLabel(target) {
  if (!target) return "";
  const name = target.kind === "ledge" ? "Ledge" : "Rail";
  return `${name} ${Math.max(0, Math.round(target.distance))} m`;
}

// Where the pin goes on a w x h screen. `ndc` is the projected point
// (x, y in -1..1, z > 1 behind the camera). On the screen the pin sits on the
// point; off the screen it sits on the edge, `margin` px in, with an arrow
// angle (rad, 0 = right, clockwise in screen axes) to the point.
export function pinPlacement(ndc, w, h, margin = 40) {
  const behind = ndc.z > 1;
  let x = ndc.x;
  let y = ndc.y;
  if (behind) {
    x = -x;
    y = -y;
  }
  const onScreen = !behind && Math.abs(x) <= 1 && Math.abs(y) <= 1;
  const sx = ((x + 1) / 2) * w;
  const sy = ((1 - y) / 2) * h;
  if (onScreen) return { x: sx, y: sy, onScreen: true, angle: Math.PI / 2 };
  const cx = w / 2;
  const cy = h / 2;
  let dx = sx - cx;
  let dy = sy - cy;
  if (behind && Math.hypot(dx, dy) < 1) dy = 1; // straight behind: point down
  const hw = Math.max(1, cx - margin);
  const hh = Math.max(1, cy - margin);
  const scale = Math.min(hw / Math.max(Math.abs(dx), 1e-6), hh / Math.max(Math.abs(dy), 1e-6));
  return { x: cx + dx * scale, y: cy + dy * scale, onScreen: false, angle: Math.atan2(dy, dx) };
}
