// Touch overlay for phones: a floating stick under the left thumb and four
// buttons under the right thumb. It keeps the held state per pointer, so two
// thumbs work at the same time. `sample()` returns the controller input
// shape through the pure mapTouch() in src/input/touch-map.js.
//
// The overlay covers only the stick zone and the buttons. A drag on the rest
// of the screen reaches the canvas and turns the camera (src/input/look.js).

import { TOUCH, mapTouch, stickVector } from "./touch-map.js";

const BUTTONS = [
  { action: "jump", label: "JUMP" },
  { action: "grind", label: "GRIND" },
  { action: "style1", label: "GROOVE" },
  { action: "style2", label: "SPIN" },
];

export function createTouchInput({ parent = document.body, radius = TOUCH.radius } = {}) {
  const root = document.createElement("div");
  root.id = "touch-controls";

  const zone = document.createElement("div");
  zone.className = "touch-stick-zone";
  zone.setAttribute("aria-label", "Stick: left and right to steer, up to push, down to brake");
  const base = document.createElement("div");
  base.className = "touch-stick-base";
  const knob = document.createElement("div");
  knob.className = "touch-stick-knob";
  base.appendChild(knob);
  zone.appendChild(base);
  root.appendChild(zone);

  const pad = document.createElement("div");
  pad.className = "touch-buttons";
  const held = { jump: new Set(), grind: new Set(), style1: new Set(), style2: new Set() };
  for (const b of BUTTONS) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `touch-btn touch-${b.action}`;
    el.dataset.action = b.action;
    el.textContent = b.label;
    const down = (e) => {
      e.preventDefault();
      held[b.action].add(e.pointerId);
      el.setPointerCapture?.(e.pointerId);
      el.dataset.down = "1";
    };
    const up = (e) => {
      held[b.action].delete(e.pointerId);
      if (held[b.action].size === 0) el.dataset.down = "0";
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    pad.appendChild(el);
  }
  root.appendChild(pad);
  parent.appendChild(root);

  // The stick: the first pointer down in the zone owns it until it lifts.
  let stickId = null;
  let origin = null;
  let stick = null;
  function place(x, y) {
    const r = zone.getBoundingClientRect();
    base.style.left = `${x - r.left}px`;
    base.style.top = `${y - r.top}px`;
  }
  function showKnob(v) {
    knob.style.transform = `translate(${v.x * radius}px, ${v.y * radius}px)`;
  }
  function release() {
    stickId = null;
    origin = null;
    stick = null;
    base.dataset.active = "0";
    base.style.left = "";
    base.style.top = "";
    knob.style.transform = "";
  }
  zone.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (stickId !== null) return;
    stickId = e.pointerId;
    origin = { x: e.clientX, y: e.clientY };
    stick = { x: 0, y: 0 };
    zone.setPointerCapture?.(e.pointerId);
    base.dataset.active = "1";
    place(origin.x, origin.y);
    showKnob(stick);
  });
  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== stickId) return;
    stick = stickVector(origin, { x: e.clientX, y: e.clientY }, radius);
    showKnob(stick);
  });
  const end = (e) => {
    if (e.pointerId === stickId) release();
  };
  zone.addEventListener("pointerup", end);
  zone.addEventListener("pointercancel", end);
  zone.addEventListener("lostpointercapture", end);
  zone.addEventListener("contextmenu", (e) => e.preventDefault());
  release();

  function buttons() {
    return { jump: held.jump.size > 0, grind: held.grind.size > 0, style1: held.style1.size > 0, style2: held.style2.size > 0 };
  }

  return {
    element: root,
    sample() {
      return mapTouch({ stick, buttons: buttons() });
    },
    // True while a thumb is on the stick or on a button.
    get touching() {
      return stickId !== null || Object.values(held).some((s) => s.size > 0);
    },
    dispose() {
      root.remove();
    },
  };
}
