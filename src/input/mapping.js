// Pure mapping from device snapshots to the controller input shape:
// { steer, push, brake, jump, grind, style1, style2 }.

export const EMPTY_INPUT = Object.freeze({ steer: 0, push: false, brake: false, jump: false, grind: false, style1: false, style2: false });

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
  };
}

export function isActive(input) {
  return input.steer !== 0 || input.push || input.brake || input.jump || input.grind || input.style1 || input.style2;
}
