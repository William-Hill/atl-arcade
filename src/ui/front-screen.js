// The intro and the title screen (#301): the DOM part. The phase logic and
// the camera flight are pure, in src/ui/intro.js.
//
// One element, #front, over the game canvas. In the intro it shows the logo
// over the camera flight. On the title screen it adds "Press any key" (or
// "Tap to start" on a touch screen), the skater select, and a Settings
// button. While #front shows, body has the class "front-open": the HUD,
// the touch controls, and the game buttons hide. The OpenStreetMap
// attribution stays (ODbL).
//
// A key handler on window in the capture phase takes every key while #front
// shows, so the game input, the photo key and the map key do not see it.
// When the settings dialog is open, the handler does nothing.

import logoUrl from "../../assets/brand/logo/skate-atl-logo.svg?url";
import { createFront, frontPress, frontStep, keyStarts, logoOpacity } from "./intro.js";

// Colors: paper #f3f3f7 on the dark scrim is over 12:1; pink #ff5fb2 on
// #0b0b12 is 7.4:1 (WCAG AA).
const STYLE = `
#front {
  position: fixed; inset: 0; z-index: 40;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: clamp(10px, 3vh, 28px);
  padding: calc(16px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(40px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));
  box-sizing: border-box; color: var(--atl-paper, #f3f3f7); font: 600 16px system-ui, sans-serif; text-align: center;
  background: linear-gradient(180deg, rgba(11, 11, 18, 0.35) 0%, rgba(11, 11, 18, 0) 35%, rgba(11, 11, 18, 0) 55%, rgba(11, 11, 18, 0.6) 100%);
  cursor: pointer; -webkit-user-select: none; user-select: none; touch-action: none;
}
#front .front-logo { width: min(78vw, 620px); max-height: 34vh; height: auto; object-fit: contain; filter: drop-shadow(0 6px 18px rgba(0, 0, 0, 0.45)); pointer-events: none; }
/* On the title screen the logo goes to the top and the controls to the
   bottom, so the skater in the middle of the view shows. */
#front[data-phase="title"] { justify-content: space-between; }
#front .front-title { display: none; flex-direction: column; align-items: center; gap: clamp(10px, 2.4vh, 20px); }
#front[data-phase="title"] .front-title { display: flex; }
#front .front-press { margin: 0; font-size: clamp(18px, 3.2vh, 26px); font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8); animation: front-pulse 1.6s ease-in-out infinite; }
#front .front-skip { position: absolute; bottom: calc(40px + env(safe-area-inset-bottom)); margin: 0; font-size: 13px; opacity: 0.8; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9); }
#front[data-phase="title"] .front-skip { display: none; }
#front .front-row { display: flex; flex-wrap: wrap; align-items: stretch; justify-content: center; gap: 10px; cursor: default; }
#front #skater-select { position: static; }
#front .front-settings {
  min-width: 96px; min-height: 44px; padding: 6px 14px; border: 2px solid rgba(255, 255, 255, 0.35); border-radius: 8px;
  background: rgba(11, 11, 18, 0.7); color: var(--atl-paper, #f3f3f7); font: 600 13px system-ui, sans-serif; letter-spacing: 0.08em; cursor: pointer;
}
#front .front-settings kbd { font: inherit; opacity: 0.75; margin-left: 6px; }
#front button:focus-visible { outline: 3px solid #ff5fb2; outline-offset: 2px; }
body.reduced-motion #front .front-press { animation: none; }
@media (prefers-reduced-motion: reduce) { #front .front-press { animation: none; } }
@keyframes front-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
/* The game UI hides under the front screen. The canvas, the load screen,
   dialogs, the ODbL attribution, and the front screen stay. */
body.front-open > :not(#stage):not(#front):not(#loader):not(#attribution):not(dialog):not(style):not(script) { visibility: hidden !important; }
/* A short phone in landscape: a smaller logo and a tighter gap. */
@media (max-height: 480px) {
  #front .front-logo { max-height: 30vh; }
  #front { gap: 8px; padding-bottom: calc(28px + env(safe-area-inset-bottom)); }
  #front .front-skip { bottom: calc(28px + env(safe-area-inset-bottom)); }
}
`;

// Creates the front screen. `plan` is from introPlan(). Callbacks:
// - onPhase(phase, from): after each phase change ("title" or "play").
// - onSettings(): the Settings button and the O key on the title screen.
// - onGesture(): each key or press (the music needs a user gesture).
// - settingsOpen(): true while the settings dialog is open.
// - skaterNav: the skater select <nav>; it moves into the title screen and
//   back to `body` when the game starts.
export function createFrontScreen({ plan, touch = false, root = document.body, skaterNav = null, onPhase = () => {}, onSettings = () => {}, onGesture = () => {}, settingsOpen = () => false, settingsCode = "KeyO", reducedMotion = () => false, win = window } = {}) {
  let state = createFront(plan);
  if (state.phase === "play") return null;

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const el = document.createElement("div");
  el.id = "front";
  el.dataset.phase = state.phase;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Skate ATL title screen");
  const logo = Object.assign(document.createElement("img"), { className: "front-logo", src: logoUrl, alt: "Skate ATL" });
  logo.draggable = false;
  el.appendChild(logo);
  const title = Object.assign(document.createElement("div"), { className: "front-title" });
  const press = Object.assign(document.createElement("p"), { className: "front-press", textContent: touch ? "Tap to start" : "Press any key" });
  press.setAttribute("aria-live", "polite");
  title.appendChild(press);
  const row = Object.assign(document.createElement("div"), { className: "front-row" });
  const navHome = skaterNav?.parentNode ?? null;
  if (skaterNav) row.appendChild(skaterNav);
  // The keyboard path to the skater select: the digit keys 1, 2, ... select
  // the skater buttons in menu order.
  const skaterButtons = skaterNav ? [...skaterNav.querySelectorAll("button[data-skater]")] : [];
  const shortcutsBefore = skaterButtons.map((b) => b.getAttribute("aria-keyshortcuts"));
  skaterButtons.forEach((b, i) => b.setAttribute("aria-keyshortcuts", String(i + 1)));
  const settings = Object.assign(document.createElement("button"), { type: "button", className: "front-settings", textContent: "SETTINGS" });
  settings.setAttribute("aria-keyshortcuts", "O");
  if (!touch) settings.append(Object.assign(document.createElement("kbd"), { textContent: "O" }));
  // As the skater select: the button never keeps the focus, so Space and
  // Enter start the game, also after the settings dialog closes and gives
  // the focus back. The O key opens the settings from the keyboard.
  settings.addEventListener("focus", () => settings.blur());
  settings.addEventListener("click", (e) => {
    e.stopPropagation();
    onSettings();
  });
  row.appendChild(settings);
  title.appendChild(row);
  el.appendChild(title);
  const skip = Object.assign(document.createElement("p"), { className: "front-skip", textContent: touch ? "Tap to skip" : "Press any key to skip" });
  el.appendChild(skip);
  root.appendChild(el);
  document.body.classList.add("front-open");

  function apply(next) {
    const changed = next.changed;
    const from = next.from;
    state = next;
    if (!changed) return;
    el.dataset.phase = state.phase;
    if (state.phase === "play") {
      if (skaterNav && navHome) navHome.appendChild(skaterNav);
      skaterButtons.forEach((b, i) => (shortcutsBefore[i] === null ? b.removeAttribute("aria-keyshortcuts") : b.setAttribute("aria-keyshortcuts", shortcutsBefore[i])));
      el.remove();
      style.remove();
      document.body.classList.remove("front-open");
      win.removeEventListener("keydown", onKey, true);
    }
    onPhase(state.phase, from);
  }

  function onKey(e) {
    if (state.phase === "play" || settingsOpen()) return;
    // A key in the skater select or on the Settings button: Enter and Space
    // press that button, Tab moves the focus.
    const inButton = e.target instanceof Element && e.target.closest?.("#front button");
    if (inButton && (e.code === "Enter" || e.code === "Space" || e.code === "Tab")) return;
    e.stopImmediatePropagation();
    onGesture();
    if (state.phase === "title" && e.code === settingsCode && !e.repeat) {
      e.preventDefault();
      onSettings();
      return;
    }
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    const pick = state.phase === "title" && digit && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey ? skaterButtons[Number(digit[1]) - 1] : null;
    if (pick) {
      e.preventDefault();
      pick.click();
      return;
    }
    if (state.phase === "intro" ? !e.repeat : keyStarts(e, { settingsCode })) {
      // In the intro every new key skips, but only the keys that start the
      // game lose their browser action (F5 and Ctrl+R still reload).
      if (state.phase !== "intro" || keyStarts(e, { settingsCode: null })) e.preventDefault();
      apply(frontPress(state));
    }
  }
  win.addEventListener("keydown", onKey, true);

  el.addEventListener("pointerdown", (e) => {
    if (state.phase === "play" || settingsOpen()) return;
    onGesture();
    if (e.target instanceof Element && e.target.closest("button, nav")) return;
    e.preventDefault();
    apply(frontPress(state));
  });

  // A gamepad button counts as a key: a press is a button that is down now
  // and was up in the last poll. Each button of each pad has its own state,
  // so a held button does not block a press of a different button.
  let padDown = new Set();
  function pollPad() {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const down = new Set();
    for (const p of pads ?? []) if (p) p.buttons.forEach((b, i) => b.pressed && down.add(`${p.index}:${i}`));
    let pressed = false;
    for (const k of down) if (!padDown.has(k)) pressed = true;
    padDown = down;
    return pressed;
  }

  return {
    get phase() {
      return state.phase;
    },
    get state() {
      return { ...state };
    },
    // True while the intro or the title screen shows.
    get active() {
      return state.phase !== "play";
    },
    // One frame: the clock, the flight, the logo, and the pad.
    update(dt, { moving = true } = {}) {
      if (state.phase === "play") return state;
      if (!settingsOpen() && pollPad()) {
        // A pad press is a user gesture too: it starts the beat clock.
        onGesture();
        apply(frontPress(state));
      }
      if (state.phase === "play") return state;
      apply(frontStep(state, dt, { moving }));
      logo.style.opacity = String(logoOpacity(state, { reducedMotion: reducedMotion() }));
      return state;
    },
    // The same as a key or a tap (for the tests).
    press() {
      apply(frontPress(state));
      return state.phase;
    },
  };
}
