// Input bindings. One rebindable map for the keyboard and the standard
// gamepad. Actions are the controller's input fields; `left` and `right`
// fold into `steer`.
//
// Keyboard: WASD or arrows, Space jump, Shift push, Q and E style, hold F
// to grind, S or Down to brake, R to switch between forward and backward. Grind is not on Control: Control plus W
// closes the tab, and Control plus S or D opens browser dialogs.
// Gamepad (standard mapping): left stick steer, A jump, X push, Y and B
// style, RT grind, LT brake, LB switch.
//
// Trick directions (docs/gdd/trick-input.md, R2): 4 more actions, dirLeft,
// dirRight, dirUp, dirDown. They read the keys themselves, not the push or
// brake action, so Shift pushes and gives no direction. On the gamepad the
// left stick (0.5 travel) and the d-pad give the direction.

// The 2 action groups of R12.2. One key can hold one action of each group.
export const MOVE_ACTIONS = ["left", "right", "push", "brake", "jump", "grind", "style1", "style2", "switch"];
export const DIR_ACTIONS = ["dirLeft", "dirRight", "dirUp", "dirDown"];
export const ACTIONS = [...MOVE_ACTIONS, ...DIR_ACTIONS];

// The direction of each direction action.
export const DIR_OF_ACTION = Object.freeze({ dirLeft: "l", dirRight: "r", dirUp: "u", dirDown: "d" });

export const DEFAULT_KEYBOARD = {
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  push: ["ShiftLeft", "ShiftRight", "KeyW", "ArrowUp"],
  brake: ["KeyS", "ArrowDown"],
  jump: ["Space"],
  grind: ["KeyF"],
  style1: ["KeyQ"],
  style2: ["KeyE"],
  switch: ["KeyR"],
  dirLeft: ["KeyA", "ArrowLeft"],
  dirRight: ["KeyD", "ArrowRight"],
  dirUp: ["KeyW", "ArrowUp"],
  dirDown: ["KeyS", "ArrowDown"],
};

// Standard gamepad button indexes: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT.
export const DEFAULT_GAMEPAD = {
  steerAxis: 0,
  // The stick y for the trick direction and the manual balance. The Gamepad
  // API gives up as negative; the input changes the sign.
  balanceAxis: 1,
  // The left stick gives the trick direction (false: the d-pad only).
  dirStick: true,
  deadzone: 0.15,
  buttons: {
    jump: [0],
    style2: [1],
    push: [2],
    style1: [3],
    brake: [6],
    grind: [7],
    switch: [4],
    left: [14], // d-pad left
    right: [15], // d-pad right
    dirUp: [12], // d-pad up
    dirDown: [13], // d-pad down
    dirLeft: [14], // d-pad left
    dirRight: [15], // d-pad right
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
