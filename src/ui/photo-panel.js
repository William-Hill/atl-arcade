// Photo mode (#90): the button, the panel, the keys, and the free camera.
// The pure state is in src/ui/photo-mode.js; the blur is in
// src/render/tilt-shift.js. The PNG holds the canvas only: the HUD and this
// panel are DOM, so they never show in a photo.
//
// Keys while photo mode is open: WASD or arrows fly, E and Q go up and
// down, Shift goes fast, a drag turns the camera, [ and ] (or the wheel)
// move the sharp band, - and = change the blur. P or Escape closes it.

import { PHOTO_KEY, closePhoto, createPhotoState, lookDirection, nudgeBand, nudgeStrength, openPhoto, photoFileName, setBand, setStrength, stepFreeCam } from "./photo-mode.js";

const STYLE = `
#photo-toggle {
  position: fixed; right: 16px; bottom: 16px; z-index: 20;
  padding: 8px 14px; border: 2px solid rgba(255, 255, 255, 0.35); border-radius: 8px;
  background: rgba(11, 11, 18, 0.7); color: var(--atl-paper, #f3f3f7);
  font: 600 13px system-ui, sans-serif; letter-spacing: 0.08em; cursor: pointer;
}
#photo-toggle[aria-pressed="true"] { border-color: var(--atl-pink, #ff5fb2); color: var(--atl-pink, #ff5fb2); }
#photo-toggle kbd { font: inherit; opacity: 0.6; margin-left: 6px; }
#photo-panel {
  position: fixed; right: 16px; bottom: 64px; z-index: 20; width: 260px;
  display: flex; flex-direction: column; gap: 8px; padding: 12px;
  border-radius: 10px; background: rgba(11, 11, 18, 0.78); color: var(--atl-paper, #f3f3f7);
  font: 13px/1.4 system-ui, sans-serif;
}
#photo-panel[hidden] { display: none; }
#photo-panel strong { color: var(--atl-pink, #ff5fb2); letter-spacing: 0.1em; }
#photo-panel label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
#photo-panel input[type="range"] { width: 100%; accent-color: var(--atl-pink, #ff5fb2); }
#photo-panel .photo-row { display: flex; gap: 8px; }
#photo-panel button {
  flex: 1; padding: 6px 10px; border: 2px solid rgba(255, 255, 255, 0.35); border-radius: 8px;
  background: rgba(255, 255, 255, 0.08); color: inherit; font: inherit; cursor: pointer;
}
#photo-panel .photo-help, #photo-panel .photo-note { font-size: 11px; opacity: 0.75; margin: 0; }
#photo-band-guide {
  position: fixed; left: 0; right: 0; z-index: 5; pointer-events: none;
  border-top: 1px dashed rgba(255, 255, 255, 0.45); border-bottom: 1px dashed rgba(255, 255, 255, 0.45);
}
#photo-band-guide[hidden] { display: none; }
body.photo-open #hud, body.photo-open #shell-info, body.photo-open #skater-select { visibility: hidden; }
`;

const MOVE_KEYS = {
  forward: [["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]],
  right: [["KeyD", "ArrowRight"], ["KeyA", "ArrowLeft"]],
  up: [["KeyE", "Space"], ["KeyQ", "KeyC"]],
};
const FAST_KEYS = ["ShiftLeft", "ShiftRight"];

function el(tag, parent, props = {}) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  parent.appendChild(node);
  return node;
}

// camera: the Three.js camera. tiltShift: from addTiltShift(), or null on
// the low tier. render(): draws one frame. sampleLook(dt): { yaw, pitch }
// in rad, or null. floor(x, z): the ground height, or null. onChange(open).
export function createPhotoPanel({ root = document.body, canvas, camera, tiltShift = null, render, sampleLook = () => null, floor = null, onChange = () => {} }) {
  if (!document.getElementById("photo-mode-style")) el("style", document.head, { id: "photo-mode-style", textContent: STYLE });

  let state = createPhotoState();
  const keys = new Set();
  const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };

  const toggleButton = el("button", root, { id: "photo-toggle", type: "button", innerHTML: "PHOTO<kbd>P</kbd>", title: "Photo mode (P)" });
  toggleButton.setAttribute("aria-pressed", "false");
  const guide = el("div", root, { id: "photo-band-guide", hidden: true });
  const panel = el("div", root, { id: "photo-panel", hidden: true });
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Photo mode");
  el("strong", panel, { textContent: "PHOTO MODE" });
  const bandLabel = el("label", panel, { textContent: "Sharp band height" });
  const band = el("input", bandLabel, { id: "photo-band", type: "range", min: "10", max: "90", step: "1" });
  const strengthLabel = el("label", panel, { textContent: "Blur strength" });
  const strength = el("input", strengthLabel, { id: "photo-strength", type: "range", min: "0", max: "100", step: "1" });
  if (!tiltShift) {
    band.disabled = true;
    strength.disabled = true;
    el("p", panel, { className: "photo-note", textContent: "The blur needs the high render tier. Photos save with no blur." });
  }
  const row = el("div", panel, { className: "photo-row" });
  const saveButton = el("button", row, { id: "photo-save", type: "button", textContent: "Save PNG" });
  const closeButton = el("button", row, { id: "photo-close", type: "button", textContent: "Close" });
  el("p", panel, { className: "photo-help", textContent: "WASD fly, E and Q up and down, Shift fast, drag to look. [ and ] or the wheel move the band, - and = change the blur. P or Esc closes." });

  function show() {
    const open = state.open;
    toggleButton.setAttribute("aria-pressed", String(open));
    panel.hidden = !open;
    guide.hidden = !(open && tiltShift);
    document.body.classList.toggle("photo-open", open);
    band.value = String(Math.round(state.center * 100));
    strength.value = String(Math.round(state.strength * 100));
    if (tiltShift) {
      tiltShift.set({ center: state.center, strength: state.strength });
      tiltShift.enabled = open;
      const { halfWidth } = tiltShift.params;
      guide.style.bottom = `${(state.center - halfWidth) * 100}%`;
      guide.style.height = `${2 * halfWidth * 100}%`;
    }
  }

  function placeCamera() {
    const { position, yaw, pitch } = state.camera;
    const d = lookDirection(yaw, pitch);
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(position[0] + d[0], position[1] + d[1], position[2] + d[2]);
  }

  function open() {
    if (state.open) return;
    saved.position.copy(camera.position);
    saved.quaternion.copy(camera.quaternion);
    const dir = camera.getWorldDirection(camera.position.clone());
    state = openPhoto(state, camera.position.toArray(), dir.toArray());
    keys.clear();
    sampleLook(0); // Drop a drag from before photo mode.
    show();
    onChange(true);
  }

  function close() {
    if (!state.open) return;
    state = closePhoto(state);
    keys.clear();
    // The follow camera places itself on the next frame; a fixed or an
    // orbit camera gets its old place back.
    camera.position.copy(saved.position);
    camera.quaternion.copy(saved.quaternion);
    show();
    onChange(false);
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  function setParams({ center, strength: s } = {}) {
    if (center !== undefined) state = setBand(state, center);
    if (s !== undefined) state = setStrength(state, s);
    show();
  }

  // Draws one frame and saves the canvas as a PNG. The canvas is read in
  // the same task as the draw, so the WebGL buffer still holds the frame.
  function save() {
    render();
    const name = photoFileName();
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("photo mode: the canvas gave no PNG"));
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        state = { ...state, saved: state.saved + 1 };
        resolve({ name, bytes: blob.size });
      }, "image/png");
    });
  }

  const typing = (e) => e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
  const onKeyDown = (e) => {
    if (e.code === PHOTO_KEY && !e.repeat) {
      e.preventDefault();
      toggle();
      return;
    }
    if (!state.open) return;
    if (e.code === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.code === "BracketLeft" || e.code === "BracketRight") {
      setParams({ center: nudgeBand(state, e.code === "BracketRight" ? 1 : -1).center });
      return;
    }
    if (e.code === "Minus" || e.code === "Equal") {
      setParams({ strength: nudgeStrength(state, e.code === "Equal" ? 1 : -1).strength });
      return;
    }
    if (!typing(e)) keys.add(e.code);
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  const onWheel = (e) => {
    if (!state.open || !tiltShift) return;
    e.preventDefault();
    setParams({ center: nudgeBand(state, e.deltaY < 0 ? 1 : -1).center });
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  toggleButton.addEventListener("click", () => toggle());
  closeButton.addEventListener("click", () => close());
  saveButton.addEventListener("click", () => save().catch((err) => console.error(err)));
  band.addEventListener("input", () => setParams({ center: Number(band.value) / 100 }));
  strength.addEventListener("input", () => setParams({ strength: Number(strength.value) / 100 }));
  show();

  const axis = ([plus, minus]) => (plus.some((k) => keys.has(k)) ? 1 : 0) - (minus.some((k) => keys.has(k)) ? 1 : 0);

  return {
    get isOpen() {
      return state.open;
    },
    get state() {
      return state;
    },
    open,
    close,
    toggle,
    set: setParams,
    save,
    // Call once per frame while photo mode is open, before the render.
    update(dt) {
      if (!state.open) return;
      const move = { forward: axis(MOVE_KEYS.forward), right: axis(MOVE_KEYS.right), up: axis(MOVE_KEYS.up), fast: FAST_KEYS.some((k) => keys.has(k)), look: sampleLook(dt) };
      state = stepFreeCam(state, move, dt, floor);
      placeCamera();
      if (tiltShift) tiltShift.sync();
    },
  };
}
