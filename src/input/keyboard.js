// A first keyboard binding so the prototype is playable by hand. M0-08
// replaces this with the real rebindable map plus gamepad support; the shape
// of what it produces (one plain input object per frame) stays the same.

const KEYS = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  push: ["ShiftLeft", "ShiftRight", "KeyW", "ArrowUp"],
  brake: ["KeyS", "ArrowDown"],
  jump: ["Space"],
};

export function createKeyboardInput(target = window) {
  const down = new Set();
  const onDown = (event) => {
    down.add(event.code);
    if (event.code === "Space") event.preventDefault();
  };
  const onUp = (event) => down.delete(event.code);

  target.addEventListener("keydown", onDown);
  target.addEventListener("keyup", onUp);

  const held = (names) => names.some((name) => down.has(name));

  return {
    sample() {
      return {
        steer: (held(KEYS.right) ? 1 : 0) - (held(KEYS.left) ? 1 : 0),
        push: held(KEYS.push),
        brake: held(KEYS.brake),
        jump: held(KEYS.jump),
      };
    },
    dispose() {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
    },
  };
}
