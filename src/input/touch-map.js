// Pure touch mapping. The touch overlay (src/input/touch.js) gives a stick
// vector and the held buttons; this module turns them into the controller
// input shape { steer, push, brake, jump, grind, style1, style2, switch }.
//
// The stick is a floating stick under the left thumb. x and y are in -1..1,
// with +x to the right and +y down (screen axes).
// - Left and right steer. The stick left steers left, which is +steer.
// - Up pushes. Down brakes.
// The buttons are JUMP, GRIND, GROOVE (style1), SPIN (style2), and SWITCH
// (switch: ride backward, or forward again). The skater turns on the press
// of SWITCH (src/sim/skate/skater.js), so a hold does not flip it again.

export const TOUCH = {
  radius: 56, // px from the stick base to the edge of its travel
  deadzone: 0.18, // fraction of the radius with no steer
  pushY: -0.4, // stick y at or above this (up) pushes
  brakeY: 0.55, // stick y at or below this (down) brakes
};

export const TOUCH_BUTTONS = ["jump", "grind", "style1", "style2", "switch"];

// The stick vector for a thumb at `point` on a stick with its base at
// `origin`, clamped to the unit circle.
export function stickVector(origin, point, radius = TOUCH.radius) {
  const dx = (point.x - origin.x) / radius;
  const dy = (point.y - origin.y) / radius;
  const len = Math.hypot(dx, dy);
  if (len <= 1) return { x: dx, y: dy };
  return { x: dx / len, y: dy / len };
}

// Removes the deadzone and rescales the rest to the full range.
export function steerFromX(x, deadzone = TOUCH.deadzone) {
  const a = Math.abs(x);
  if (a <= deadzone) return 0;
  const v = Math.min(1, (a - deadzone) / (1 - deadzone));
  return -Math.sign(x) * v;
}

// `state` is { stick: { x, y } | null, buttons: { jump, grind, style1, style2, switch } }.
export function mapTouch(state, k = TOUCH) {
  const stick = state.stick;
  const b = state.buttons ?? {};
  const steer = stick ? steerFromX(stick.x, k.deadzone) : 0;
  return {
    steer: steer || 0, // no negative zero
    push: Boolean(stick && stick.y <= k.pushY),
    brake: Boolean(stick && stick.y >= k.brakeY),
    jump: Boolean(b.jump),
    grind: Boolean(b.grind),
    style1: Boolean(b.style1),
    style2: Boolean(b.style2),
    switch: Boolean(b.switch),
  };
}

// True when the page runs on a touch screen, or when `?touch=1` forces the
// overlay on. `?touch=0` turns it off.
export function wantsTouch(param, { maxTouchPoints = 0, coarse = false } = {}) {
  if (param === "1") return true;
  if (param === "0") return false;
  return coarse || maxTouchPoints > 0;
}

// The held state of the touch buttons, per pointer, so two thumbs work at the
// same time. A press counts in the next `snapshot()` also when the finger
// lifts before it: at a low frame rate a short tap can start and end between
// two input samples, and the tap must not be lost. `snapshot()` is called
// once per input sample.
export function createButtonState(actions = TOUCH_BUTTONS) {
  const held = Object.fromEntries(actions.map((a) => [a, new Set()]));
  const pressed = new Set();
  return {
    down(action, pointerId) {
      held[action].add(pointerId);
      pressed.add(action);
    },
    up(action, pointerId) {
      held[action].delete(pointerId);
    },
    isDown(action) {
      return held[action].size > 0;
    },
    get any() {
      return actions.some((a) => held[a].size > 0);
    },
    snapshot() {
      const out = Object.fromEntries(actions.map((a) => [a, held[a].size > 0 || pressed.has(a)]));
      pressed.clear();
      return out;
    },
  };
}
