// Camera look input: mouse drag on the canvas and the gamepad right stick.
// It is separate from the skate input, because the camera does not change
// the simulation. `sample()` returns the drag pixels since the last call and
// the right stick axes, for mapLook() in src/sim/camera.js.

// Standard gamepad mapping: axis 2 is right stick x, axis 3 is right stick y.
export const LOOK_AXES = [2, 3];

export function createLookInput({ element, getGamepads = () => (navigator.getGamepads ? navigator.getGamepads() : []) } = {}) {
  let dx = 0;
  let dy = 0;
  let pointer = null;
  let lastX = 0;
  let lastY = 0;

  const onDown = (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    pointer = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    element.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (e.pointerId !== pointer) return;
    dx += e.clientX - lastX;
    dy += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = (e) => {
    if (e.pointerId === pointer) pointer = null;
  };
  const onMenu = (e) => e.preventDefault();
  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointermove", onMove);
  element.addEventListener("pointerup", onUp);
  element.addEventListener("pointercancel", onUp);
  element.addEventListener("contextmenu", onMenu);
  // A drag on the canvas must not scroll or zoom the page on touch screens.
  element.style.touchAction = "none";

  function stick() {
    let pads = [];
    try {
      pads = getGamepads() || [];
    } catch {
      pads = [];
    }
    for (const p of pads) {
      if (p && p.connected !== false) {
        const axes = p.axes ?? [];
        return [axes[LOOK_AXES[0]] ?? 0, axes[LOOK_AXES[1]] ?? 0];
      }
    }
    return [0, 0];
  }

  return {
    sample() {
      const out = { dx, dy, stick: stick() };
      dx = 0;
      dy = 0;
      return out;
    },
    get dragging() {
      return pointer !== null;
    },
    dispose() {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
      element.removeEventListener("contextmenu", onMenu);
    },
  };
}
