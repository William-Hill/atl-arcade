// The fullscreen button and the "turn your phone" hint (#97, MOB-9). Touch
// screens only. The pure rules are in src/ui/screen.js; the places are in
// src/shell.css.

import { TURN_HINT, TURN_HINT_MS, fullscreenApi, fullscreenLabel, orientationOf, wantsTurnHint } from "./screen.js";

function el(tag, parent, props = {}) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  parent.appendChild(node);
  return node;
}

// `touch` is true when the touch controls show. `doc` and `win` are for the
// tests. `after` is a promise (the first game frame): the hint waits for it,
// so it does not run out behind the load screen. Returns
// { button, hint, update() } (null items when not used).
export function createScreenControls({ root = document.body, touch = false, doc = document, win = window, hintMs = TURN_HINT_MS, after = null } = {}) {
  if (!touch) return { button: null, hint: null, update() {} };

  const api = fullscreenApi(doc);
  let button = null;
  if (api) {
    button = el("button", root, { id: "fullscreen-toggle", type: "button" });
    const show = () => {
      const l = fullscreenLabel(api.active());
      button.textContent = l.text;
      button.setAttribute("aria-label", l.name);
      button.setAttribute("aria-pressed", String(api.active()));
    };
    button.addEventListener("focus", () => button.blur());
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      // A browser can refuse (no user gesture, a policy): keep the button.
      Promise.resolve()
        .then(() => (api.active() ? api.exit() : api.enter()))
        .catch(() => {});
    });
    doc.addEventListener(api.event, show);
    show();
  }

  const hint = el("div", root, { id: "turn-hint", hidden: true });
  hint.setAttribute("role", "status");
  el("span", hint, { textContent: TURN_HINT });
  const ok = el("button", hint, { type: "button", textContent: "OK" });
  ok.setAttribute("aria-label", "Close the hint");
  let timer = null;
  let last = null;
  const hide = () => {
    hint.hidden = true;
    clearTimeout(timer);
  };
  ok.addEventListener("click", (e) => {
    e.stopPropagation();
    hide();
  });
  // The hint shows each time the phone turns into the worse orientation,
  // and goes after `hintMs`, an OK tap, or a turn to the better one.
  function update() {
    const w = win.innerWidth;
    const h = win.innerHeight;
    const now = orientationOf(w, h);
    if (now === last) return;
    last = now;
    if (wantsTurnHint({ touch, width: w, height: h })) {
      hint.hidden = false;
      clearTimeout(timer);
      if (hintMs > 0) timer = setTimeout(hide, hintMs);
    } else hide();
  }
  win.addEventListener("resize", update);
  if (after) after.then(update, update);
  else update();
  return { button, hint, update };
}
