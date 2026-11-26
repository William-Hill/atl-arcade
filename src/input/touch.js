// Touch overlay for phones: a floating stick under the left thumb and five
// buttons under the right thumb. It keeps the held state per pointer, so two
// thumbs work at the same time. `sample(t)` returns the controller input
// shape through the pure mapTouch() in src/input/touch-map.js.
//
// TRICK (style1), SPIN (style2), and GRIND take a flick (src/input/flick.js,
// GDD R11): their pointer events wait for the next sample, which gives them
// its time. A small arrow ring shows around the button while the finger is
// down.
//
// The overlay covers only the stick zone and the buttons. A drag on the rest
// of the screen reaches the canvas and turns the camera (src/input/look.js).

import { FLICK_BUTTONS, activeFlicks, createTouchTricks, flickDrag, rebaseTouchTricks, touchTrickDown, touchTrickMove, touchTrickUp, touchTricksFrame } from "./flick.js";
import { TOUCH, createButtonState, mapTouch, stickVector } from "./touch-map.js";
import { TRICK_INPUT } from "./trick-constants.js";

const BUTTONS = [
  { action: "jump", label: "JUMP" },
  { action: "grind", label: "GRIND" },
  { action: "style1", label: "TRICK" },
  { action: "style2", label: "SPIN" },
  // Ride backward, or forward again (the R key, the LB button).
  { action: "switch", label: "SWITCH", aria: "Switch: ride backward or forward" },
];

// The 4 arrows of the flick ring: up, right, down, left.
const RING_DIRS = [
  ["u", "\u25B2"],
  ["r", "\u25B6"],
  ["d", "\u25BC"],
  ["l", "\u25C0"],
];
const HALF_FRAME_MS = 1000 / 120;

export function createTouchInput({ parent = document.body, radius = TOUCH.radius, knobs = TRICK_INPUT } = {}) {
  let k = knobs;
  // The flick buttons: pointer events wait for the next sample.
  let tricks = createTouchTricks();
  const queue = [];
  const rings = {};
  let clockMs = 0;
  const root = document.createElement("div");
  root.id = "touch-controls";

  const zone = document.createElement("div");
  zone.className = "touch-stick-zone";
  zone.setAttribute("role", "group");
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
  const held = createButtonState(BUTTONS.map((b) => b.action).filter((a) => !FLICK_BUTTONS.includes(a)));
  for (const b of BUTTONS) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `touch-btn touch-${b.action}`;
    el.dataset.action = b.action;
    el.textContent = b.label;
    if (b.aria) el.setAttribute("aria-label", b.aria);
    if (FLICK_BUTTONS.includes(b.action)) {
      el.setAttribute("aria-label", `${b.label}: tap, or flick up, down, left, or right`);
      // The ring: 4 tick marks at rest, 4 arrows while the finger is down.
      // It is a sibling of the button over its center (no text in the button
      // but the label), and it takes no pointer events.
      const ring = document.createElement("div");
      ring.className = `flick-ring flick-ring-${b.action}`;
      ring.setAttribute("aria-hidden", "true");
      ring.dataset.active = "0";
      ring.dataset.dir = "";
      for (const [d, glyph] of RING_DIRS) {
        const a = document.createElement("span");
        a.className = `flick-arrow flick-${d}`;
        a.dataset.dir = d;
        a.dataset.glyph = glyph;
        ring.appendChild(a);
      }
      rings[b.action] = { ring, button: el };
      const fdown = (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        el.dataset.down = "1";
        queue.push({ type: "down", id: e.pointerId, button: b.action, x: e.clientX, y: e.clientY });
      };
      const fmove = (e) => queue.push({ type: "move", id: e.pointerId, x: e.clientX, y: e.clientY });
      const fup = (e) => {
        queue.push({ type: "up", id: e.pointerId });
        el.dataset.down = "0";
      };
      el.addEventListener("pointerdown", fdown);
      el.addEventListener("pointermove", fmove);
      el.addEventListener("pointerup", fup);
      el.addEventListener("pointercancel", fup);
      el.addEventListener("lostpointercapture", fup);
      el.addEventListener("contextmenu", (e) => e.preventDefault());
      pad.appendChild(el);
      pad.appendChild(ring);
      continue;
    }
    const down = (e) => {
      e.preventDefault();
      held.down(b.action, e.pointerId);
      el.setPointerCapture?.(e.pointerId);
      el.dataset.down = "1";
    };
    const up = (e) => {
      held.up(b.action, e.pointerId);
      if (!held.isDown(b.action)) el.dataset.down = "0";
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

  // The ring of each flick button: active while a finger is down, and the
  // direction of the drag (or of the resolve) as `data-dir`.
  function showRings() {
    const flicks = activeFlicks(tricks);
    for (const [action, { ring, button }] of Object.entries(rings)) {
      ring.style.left = `${button.offsetLeft + button.offsetWidth / 2}px`;
      ring.style.top = `${button.offsetTop + button.offsetHeight / 2}px`;
      const f = flicks.find((g) => g.button === action);
      ring.dataset.active = f ? "1" : "0";
      if (!f) {
        ring.dataset.dir = "";
        continue;
      }
      const { dx, dy } = flickDrag(f);
      const dir = f.resolved ? f.resolved.dir : Math.hypot(dx, dy) >= 6 ? (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "r" : "l") : dy < 0 ? "u" : "d") : "";
      ring.dataset.dir = dir === "n" ? "" : dir;
      ring.dataset.resolved = f.resolved ? "1" : "0";
    }
  }

  return {
    element: root,
    // `t` is the sim time (s) of the step that reads the frame.
    sample(t) {
      const tMs = Number.isFinite(t) ? t * 1000 : clockMs + 1000 / 60;
      // The sim clock went back (a new run): the old flick start events are
      // not fresh, and a flick still down starts its timeout again now.
      if (tMs < clockMs - 1e-3) tricks = rebaseTouchTricks(tricks, tMs);
      clockMs = tMs;
      for (const ev of queue) {
        if (ev.type === "down") tricks = touchTrickDown(tricks, ev.button, ev.id, ev.x, ev.y, tMs);
        else if (ev.type === "move") tricks = touchTrickMove(tricks, ev.id, ev.x, ev.y, tMs, k);
        else tricks = touchTrickUp(tricks, ev.id, tMs);
      }
      queue.length = 0;
      const frame = touchTricksFrame(tricks, tMs, k, HALF_FRAME_MS);
      tricks = frame.state;
      showRings();
      const b = { ...held.snapshot(), style1: frame.out.style1, style2: frame.out.style2, grind: frame.out.grind };
      return {
        ...mapTouch({ stick, buttons: b }),
        // Touch-only fields: the flick resolves, the GRIND stance wait, the
        // flick start events, and the balance (the stick y, up is +1).
        flick: frame.out.flick,
        grindFlick: frame.out.grindFlick,
        dirs: { lastDir: tricks.lastDir, lastDirAt: tricks.lastDirAt, hist: tricks.hist, held: false },
        balance: stick ? -stick.y || 0 : 0,
      };
    },
    // True while a thumb is on the stick or on a button.
    get touching() {
      return stickId !== null || held.any || Object.keys(tricks.pointers).length > 0 || queue.length > 0;
    },
    // The sim does not read the input on this frame: drop the waiting
    // pointer events and the flicks, so that they do not reach a later frame.
    skip() {
      queue.length = 0;
      tricks = createTouchTricks();
      showRings();
    },
    // The flick knobs (flickMin, flickMaxMs).
    set knobs(v) {
      k = v;
    },
    dispose() {
      root.remove();
    },
  };
}
