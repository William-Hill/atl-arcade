// Minimal keyboard sampler for the greybox. M0-08 replaces this with the
// full rebindable map and the gamepad. Returns the controller input shape.
//
// A/D or Left/Right: steer. W/Up or Shift: push. S/Down: brake. Space: jump.

export function createKeyboard(target = window) {
  const down = new Set();
  const onDown = (e) => {
    down.add(e.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
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
      };
    },
    dispose() {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
    },
  };
}
