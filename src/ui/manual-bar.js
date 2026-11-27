// The manual balance bar (#330, docs/ux/trick-hud.md section 7, E4): a
// vertical track beside the skater, with a marker at the lean of F1. The
// math is in src/ui/manual-bar-math.js. Plain DOM, updated once per frame.
// The sim never sees this.
//
// The zones differ by pattern first (solid, horizontal lines, diagonal
// hatching) and color second, so they read in grayscale (R12.4).

import { keyName } from "../input/remap.js";
import { MANUAL_BAR, barHeight, barTarget, fixedPlace, markerLook, markerTop, pickSide, safeRect, smoothToward, zoneOf } from "./manual-bar-math.js";

const STYLE = `
#manual-bar { position: fixed; left: 0; top: 0; z-index: 12; width: 16px; pointer-events: none; opacity: 0; transition: opacity 0.1s; will-change: transform; }
#manual-bar[data-show="1"] { opacity: 1; }
#manual-bar[data-show="0"] { transition-duration: 0.15s; }
#manual-bar[data-rm="1"] { transition: none; }
#manual-bar .mb-label { display: block; height: 16px; width: 40px; margin-left: -12px; text-align: center; font: 700 13px/16px system-ui, sans-serif; color: #f3f3f7; text-shadow: 0 1px 2px #000, 0 0 3px #000; }
#manual-bar .mb-track { position: relative; box-sizing: border-box; width: 16px; border: 2px solid #f3f3f7; border-radius: 4px; overflow: visible; background: #2f9e6e; }
#manual-bar .mb-zone { position: absolute; left: 0; right: 0; }
#manual-bar .mb-warn { background: repeating-linear-gradient(180deg, #d98c1f 0 2px, #4a2c00 2px 4px); }
#manual-bar .mb-limit { background: repeating-linear-gradient(45deg, #9a2d2d 0 4px, #1a0606 4px 7px); }
#manual-bar .mb-tick { position: absolute; left: -2px; right: -2px; height: 1px; background: #0b0b12; }
#manual-bar .mb-marker { position: absolute; width: 14px; height: 20px; margin-top: -10px; }
#manual-bar .mb-marker::before, #manual-bar .mb-marker::after { content: ""; position: absolute; inset: 0; }
#manual-bar .mb-marker::before { background: #0b0b12; }
#manual-bar .mb-marker::after { inset: 3px 3px 3px 2px; background: #f3f3f7; }
#manual-bar[data-side="right"] .mb-marker { right: calc(100% + 1px); }
#manual-bar[data-side="right"] .mb-marker::before, #manual-bar[data-side="right"] .mb-marker::after { clip-path: polygon(0 0, 100% 50%, 0 100%); }
#manual-bar[data-side="left"] .mb-marker { left: calc(100% + 1px); }
#manual-bar[data-side="left"] .mb-marker::before, #manual-bar[data-side="left"] .mb-marker::after { clip-path: polygon(100% 0, 0 50%, 100% 100%); }
#manual-bar[data-alert="1"] .mb-marker::after { inset: 4px 4px 4px 3px; }
#manual-bar[data-alert="1"] .mb-marker { outline: 3px solid #0b0b12; outline-offset: 0; }
#manual-bar .mb-alert { position: absolute; top: -9px; font: 900 16px/18px system-ui, sans-serif; color: #f3f3f7; text-shadow: 0 0 3px #000, 0 1px 2px #000; }
#manual-bar[data-side="right"] .mb-alert { right: calc(100% + 18px); }
#manual-bar[data-side="left"] .mb-alert { left: calc(100% + 18px); }
#manual-bar .mb-alert[hidden] { display: none; }
`;

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

// The end labels per device (7.3): the bound keys on a keyboard, else the
// stick arrows.
export function barLabels(source, bindings) {
  if (source === "keyboard") {
    const up = bindings?.keyboard?.dirUp?.[0];
    const down = bindings?.keyboard?.dirDown?.[0];
    return { top: up ? keyName(up) : "↑", bottom: down ? keyName(down) : "↓" };
  }
  if (source === "gamepad") return { top: "↑○", bottom: "↓○" };
  return { top: "↑", bottom: "↓" };
}

// `blockers()` returns the rectangles the bar must not cover. It is read at
// the manual start and after a resize, not each frame.
export function createManualBar(parent = document.body, { reducedMotion = () => false, blockers = () => [] } = {}) {
  if (!document.getElementById("manual-bar-style")) {
    const style = el("style", "", document.head);
    style.id = "manual-bar-style";
    style.textContent = STYLE;
  }
  const root = el("div", "", parent);
  root.id = "manual-bar";
  root.setAttribute("aria-hidden", "true");
  root.dataset.show = "0";
  root.dataset.side = "right";
  const top = el("span", "mb-label mb-top", root);
  const track = el("div", "mb-track", root);
  const zones = { limTop: el("div", "mb-zone mb-limit", track), warnTop: el("div", "mb-zone mb-warn", track), warnBot: el("div", "mb-zone mb-warn", track), limBot: el("div", "mb-zone mb-limit", track) };
  const ticks = [el("div", "mb-tick", track), el("div", "mb-tick", track), el("div", "mb-tick", track), el("div", "mb-tick", track)];
  const marker = el("div", "mb-marker", track);
  const alert = el("span", "mb-alert", marker);
  alert.textContent = "!";
  alert.hidden = true;
  const bottom = el("span", "mb-label mb-bottom", root);

  let trackH = 0;
  let side = "right";
  let pos = null;
  let active = false;
  let lastM = 0;
  let outUntil = -Infinity;
  let blocks = null;
  window.addEventListener("resize", () => (blocks = null));

  function layout(h) {
    if (h === trackH) return;
    trackH = h;
    track.style.height = `${h}px`;
    const inner = h - 4;
    const at = (m) => markerTop(m, inner);
    const [w0, w1] = MANUAL_BAR.zones;
    zones.limTop.style.cssText = `top:0;height:${at(-w1)}px`;
    zones.warnTop.style.cssText = `top:${at(-w1)}px;height:${at(-w0) - at(-w1)}px`;
    zones.warnBot.style.cssText = `top:${at(w0)}px;height:${at(w1) - at(w0)}px`;
    zones.limBot.style.cssText = `top:${at(w1)}px;height:${inner - at(w1)}px`;
    [-w1, -w0, w0, w1].forEach((m, i) => (ticks[i].style.top = `${at(m)}px`));
  }

  const state = { visible: false, side, zone: "safe", near: false, alert: false, x: 0, y: 0, height: 0 };

  return {
    element: root,
    get state() {
      return { ...state };
    },
    // `manual` is state.manual or null; `anchor` is the skater hip on the
    // screen { x, y } (CSS px) or null; `dt` is the frame time in s.
    update({ manual, anchor, dt = 0, nowMs = performance.now(), compact = false, labels = { top: "W", bottom: "S" }, viewW = window.innerWidth, viewH = window.innerHeight }) {
      const rm = Boolean(reducedMotion());
      root.dataset.rm = rm ? "1" : "0";
      layout(compact ? MANUAL_BAR.h.compact : MANUAL_BAR.h.desktop);
      const size = { w: MANUAL_BAR.w, h: barHeight(compact) };
      const safe = safeRect(viewW, viewH);
      if (manual && !active) {
        active = true;
        blocks = null;
        pos = null;
        side = anchor && !rm ? pickSide(anchor, size, safe) : "right";
      }
      if (!manual && active) {
        active = false;
        // A balance out (|m| at 1): the marker stays at the end for 300 ms.
        if (Math.abs(lastM) >= 1 - 1e-6) outUntil = nowMs + MANUAL_BAR.outMs;
      }
      const holding = !manual && nowMs < outUntil;
      const show = Boolean(manual) || holding;
      root.dataset.show = show ? "1" : "0";
      state.visible = show;
      if (!show) return;
      if (blocks === null) blocks = blockers();
      const m = manual ? manual.balance : lastM;
      if (manual) lastM = m;
      if (top.textContent !== labels.top) top.textContent = labels.top;
      if (bottom.textContent !== labels.bottom) bottom.textContent = labels.bottom;
      root.dataset.side = side;
      const target = rm || !anchor ? fixedPlace(viewW, viewH, size, safe) : barTarget(anchor, side, size, safe, blocks);
      pos = rm || !anchor ? target : smoothToward(pos, target, dt);
      root.style.transform = `translate(${Math.round(pos.x - size.w / 2)}px, ${Math.round(pos.y - size.h / 2)}px)`;
      marker.style.top = `${markerTop(m, trackH - 4)}px`;
      const look = markerLook(m, nowMs / 1000, rm);
      marker.style.opacity = String(look.opacity);
      root.dataset.alert = look.alert ? "1" : "0";
      alert.hidden = !look.alert;
      const zone = zoneOf(m);
      Object.assign(state, { side, zone, near: look.near, alert: look.alert, x: pos.x, y: pos.y, height: trackH });
      root.dataset.zone = zone;
    },
    dispose() {
      root.remove();
    },
  };
}
