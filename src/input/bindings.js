// Input bindings. One rebindable map for the keyboard and the standard
// gamepad. Actions are the controller's input fields; `left` and `right`
// fold into `steer`.
//
// Keyboard: WASD or arrows, Space jump, Shift push, Q and E style, hold
// Control to grind, S or Down to brake.
// Gamepad (standard mapping): left stick steer, A jump, X push, Y and B
// style, RT grind, LT brake.

export const ACTIONS = ["left", "right", "push", "brake", "jump", "grind", "style1", "style2"];

export const DEFAULT_KEYBOARD = {
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  push: ["ShiftLeft", "ShiftRight", "KeyW", "ArrowUp"],
  brake: ["KeyS", "ArrowDown"],
  jump: ["Space"],
  grind: ["ControlLeft", "ControlRight"],
  style1: ["KeyQ"],
  style2: ["KeyE"],
};

// Standard gamepad button indexes: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT.
export const DEFAULT_GAMEPAD = {
  steerAxis: 0,
  deadzone: 0.15,
  buttons: {
    jump: [0],
    style2: [1],
    push: [2],
    style1: [3],
    brake: [6],
    grind: [7],
    left: [14], // d-pad left
    right: [15], // d-pad right
  },
};

export function createBindings(overrides = {}) {
  return {
    keyboard: { ...DEFAULT_KEYBOARD, ...(overrides.keyboard ?? {}) },
    gamepad: {
      ...DEFAULT_GAMEPAD,
      ...(overrides.gamepad ?? {}),
      buttons: { ...DEFAULT_GAMEPAD.buttons, ...(overrides.gamepad?.buttons ?? {}) },
    },
  };
}

// Returns a new bindings object with `action` bound to `codes` on one device.
export function rebind(bindings, device, action, codes) {
  if (!ACTIONS.includes(action)) throw new Error(`bindings: unknown action ${action}`);
  const list = Array.isArray(codes) ? codes : [codes];
  if (device === "keyboard") return { ...bindings, keyboard: { ...bindings.keyboard, [action]: list } };
  if (device === "gamepad") return { ...bindings, gamepad: { ...bindings.gamepad, buttons: { ...bindings.gamepad.buttons, [action]: list } } };
  throw new Error(`bindings: unknown device ${device}`);
}
