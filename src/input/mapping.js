// Pure mapping from device snapshots to the controller input shape:
// { steer, push, brake, jump, grind, style1, style2, switch }.

export const EMPTY_INPUT = Object.freeze({ steer: 0, push: false, brake: false, jump: false, grind: false, style1: false, style2: false, switch: false });

function any(codes, isDown) {
  return Boolean(codes && codes.some(isDown));
}

// `down` is a Set of KeyboardEvent.code values that are held.
export function mapKeyboard(down, bindings) {
  const k = bindings.keyboard;
  const isDown = (code) => down.has(code);
  const left = any(k.left, isDown);
  const right = any(k.right, isDown);
  return {
    steer: (left ? 1 : 0) - (right ? 1 : 0),
    push: any(k.push, isDown),
    brake: any(k.brake, isDown),
    jump: any(k.jump, isDown),
    grind: any(k.grind, isDown),
    style1: any(k.style1, isDown),
    style2: any(k.style2, isDown),
    switch: any(k.switch, isDown),
  };
}

// `pad` is a snapshot { axes: number[], buttons: [{ pressed, value }] }
// like the Gamepad API gives. Stick left (negative axis) steers left (+).
export function mapGamepad(pad, bindings) {
  const g = bindings.gamepad;
  const pressed = (i) => Boolean(pad.buttons && pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
  const isDown = (i) => pressed(i);
  let axis = pad.axes && Number.isFinite(pad.axes[g.steerAxis]) ? pad.axes[g.steerAxis] : 0;
  if (Math.abs(axis) < g.deadzone) axis = 0;
  else axis = Math.sign(axis) * ((Math.abs(axis) - g.deadzone) / (1 - g.deadzone));
  let steer = axis === 0 ? 0 : -axis; // no negative zero
  if (any(g.buttons.left, isDown)) steer = 1;
  if (any(g.buttons.right, isDown)) steer = -1;
  return {
    steer: Math.max(-1, Math.min(1, steer)) || 0,
    push: any(g.buttons.push, isDown),
    brake: any(g.buttons.brake, isDown),
    jump: any(g.buttons.jump, isDown),
    grind: any(g.buttons.grind, isDown),
    style1: any(g.buttons.style1, isDown),
    style2: any(g.buttons.style2, isDown),
    switch: any(g.buttons.switch, isDown),
  };
}

// Combines two inputs: buttons OR together, steer takes the larger magnitude.
export function mergeInputs(a, b) {
  return {
    steer: Math.abs(b.steer) > Math.abs(a.steer) ? b.steer : a.steer,
    push: a.push || b.push,
    brake: a.brake || b.brake,
    jump: a.jump || b.jump,
    grind: a.grind || b.grind,
    style1: a.style1 || b.style1,
    style2: a.style2 || b.style2,
    switch: a.switch || b.switch,
  };
}

export function isActive(input) {
  return input.steer !== 0 || input.push || input.brake || input.jump || input.grind || input.style1 || input.style2;
}

// --- Trick directions and the manual balance (docs/gdd/trick-input.md) -------

// The fields of the direction contract (src/input/direction.js) with no
// direction. A scripted input with no direction fields means these values.
export const NEUTRAL_DIR = Object.freeze({ dir: "n", lastDir: "n", lastDirAt: -Infinity, lastDirHeld: false, dirHist: Object.freeze([]), balance: 0 });

function rescale(v, deadzone) {
  if (!Number.isFinite(v) || Math.abs(v) < deadzone) return 0;
  return Math.sign(v) * ((Math.abs(v) - deadzone) / (1 - deadzone));
}

// The gamepad trick direction: the d-pad first, else the left stick with
// `threshold` travel on the main axis (R2).
export function padDir(pad, bindings, stickDirOf) {
  const g = bindings.gamepad;
  const pressed = (i) => Boolean(pad.buttons && pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
  const on = (action) => any(g.buttons[action], pressed);
  if (on("dirUp")) return "u";
  if (on("dirDown")) return "d";
  if (on("dirLeft")) return "l";
  if (on("dirRight")) return "r";
  const axes = pad.axes ?? [];
  const x = Number.isFinite(axes[g.steerAxis]) ? axes[g.steerAxis] : 0;
  const y = Number.isFinite(axes[g.balanceAxis ?? 1]) ? axes[g.balanceAxis ?? 1] : 0;
  return stickDirOf(x, -y);
}

// The gamepad balance (GDD Interactions): the left stick y with the sign
// changed, after the deadzone, not snapped; the d-pad up or down gives +1 or -1.
export function padBalance(pad, bindings) {
  const g = bindings.gamepad;
  const pressed = (i) => Boolean(pad.buttons && pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
  if (any(g.buttons.dirUp, pressed)) return 1;
  if (any(g.buttons.dirDown, pressed)) return -1;
  const y = (pad.axes ?? [])[g.balanceAxis ?? 1];
  return -rescale(y, g.deadzone) || 0;
}

// The balance of several devices: the largest magnitude wins.
export function mergeBalance(...values) {
  return values.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
}
