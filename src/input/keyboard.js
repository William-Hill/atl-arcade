// Minimal keyboard sampler for the greybox. M0-08 replaces this with the
// full rebindable map and the gamepad. Returns the controller input shape.
//
// A/D or Left/Right: steer. W/Up or Shift: push. S/Down: brake. Space: jump.
// Hold F: grind. Q and E: style moves. Grind is not on Control, because
// Control plus W closes the tab and Control plus S or D opens browser dialogs.

const BOUND = new Set(["KeyA", "KeyD", "KeyW", "KeyS", "KeyF", "KeyQ", "KeyE", "Space", "ShiftLeft", "ShiftRight", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function createKeyboard(target = window) {
  const down = new Set();
  const onDown = (e) => {
    down.add(e.code);
    if (BOUND.has(e.code)) e.preventDefault();
  };
  const onUp = (e) => down.delete(e.code);
  target.addEventListener("keydown", onDown);
  target.addEventListener("keyup", onUp);
  target.addEventListener("blur", () => down.clear());

  return {
    sample() {
      const left = down.has("KeyA") || down.has("ArrowLeft");
      const right = down.has("KeyD") || down.has("ArrowRight");
      return {
        steer: (left ? 1 : 0) - (right ? 1 : 0),
        push: down.has("KeyW") || down.has("ArrowUp") || down.has("ShiftLeft") || down.has("ShiftRight"),
        brake: down.has("KeyS") || down.has("ArrowDown"),
        jump: down.has("Space"),
        grind: down.has("KeyF"),
        style1: down.has("KeyQ"),
        style2: down.has("KeyE"),
      };
    },
    dispose() {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
    },
  };
}
