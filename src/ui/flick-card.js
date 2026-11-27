// The touch flick card (#330, docs/ux/trick-hud.md 8.3, E5). The thumb
// covers the ring, so the trick names go in a card away from the thumb:
// above the buttons in portrait, to their left in landscape. The cells come
// from src/ui/trick-map.js (pure). Plain DOM, updated once per frame.

import { CELL_ORDER, cardPlace, cellText, contextOf, flickCard, oneButtonNext } from "./trick-map.js";
import { GLYPHS } from "./trick-hud-text.js";

const STYLE = `
#flick-card { position: fixed; left: 0; top: 0; z-index: 14; box-sizing: border-box; max-width: 220px; max-height: 100px; padding: 4px 6px;
  border-radius: 8px; background: var(--hud-pill, rgba(11, 11, 18, 0.82)); color: #f3f3f7; font: 700 13px/1.2 system-ui, sans-serif; pointer-events: none;
  display: grid; grid-template-columns: auto auto; grid-template-areas: "u u" "l r" "n n" "d d"; gap: 2px 8px; justify-items: center; }
#flick-card[hidden] { display: none; }
#flick-card[data-line="1"] { display: block; }
#flick-card .fc-cell { padding: 1px 4px; border: 2px solid transparent; border-radius: 4px; white-space: nowrap; }
#flick-card .fc-n { grid-area: n; } #flick-card .fc-u { grid-area: u; } #flick-card .fc-l { grid-area: l; } #flick-card .fc-r { grid-area: r; } #flick-card .fc-d { grid-area: d; }
#flick-card .fc-cell[data-lit="1"] { background: #f3f3f7; color: #0b0b12; border-color: #0b0b12; }
`;

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

export function createFlickCard(parent = document.body) {
  if (!document.getElementById("flick-card-style")) {
    const style = el("style", "", document.head);
    style.id = "flick-card-style";
    style.textContent = STYLE;
  }
  const root = el("div", "", parent);
  root.id = "flick-card";
  root.setAttribute("aria-hidden", "true");
  root.hidden = true;
  const line = el("div", "fc-line", root);
  const cellEls = Object.fromEntries(CELL_ORDER.map((d) => [d, el("div", `fc-cell fc-${d}`, root)]));
  let key = "";
  let size = null;
  window.addEventListener("resize", () => (size = null));
  const state = { visible: false, button: null, ctx: null, lit: null, text: [] };

  return {
    element: root,
    get state() {
      return { ...state, text: [...state.text] };
    },
    // `flicks` is touch.flicks; `skater` the run skater state; `skaterId`
    // "nia" or "marcus"; `ob` the one-button state or null.
    update({ flicks = [], skater = null, skaterId = "nia", oneButton = false, ob = null, buttons = null }) {
      const f = flicks[0] ?? null;
      if (!f) {
        root.hidden = true;
        state.visible = false;
        key = "";
        return;
      }
      const ctx = contextOf(skater);
      const card = flickCard(f.button, ctx, skaterId, { oneButton, next: oneButton ? oneButtonNext(ob, ctx, skaterId) : null });
      const k = `${f.button}|${ctx}|${skaterId}|${oneButton}|${card.line ?? ""}`;
      if (k !== key) {
        key = k;
        size = null;
        root.dataset.line = card.line != null ? "1" : "0";
        line.hidden = card.line == null;
        line.textContent = card.line ?? "";
        for (const d of CELL_ORDER) {
          cellEls[d].hidden = !card.cells;
          cellEls[d].dataset.text = card.cells ? cellText(d, card.cells[d]) : "";
        }
      }
      const lit = card.cells && f.dir ? f.dir : null;
      for (const d of CELL_ORDER) {
        const c = cellEls[d];
        const on = lit === d;
        const text = card.cells ? `${on ? `${GLYPHS.cut} ` : ""}${c.dataset.text}` : "";
        if (c.textContent !== text) c.textContent = text;
        c.dataset.lit = on ? "1" : "0";
      }
      root.hidden = false;
      if (buttons) {
        if (!size) {
          const r = root.getBoundingClientRect();
          size = { w: r.width, h: r.height };
        }
        const p = cardPlace(buttons, size, window.innerWidth, window.innerHeight);
        root.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
        root.dataset.side = p.side;
      }
      Object.assign(state, { visible: true, button: f.button, ctx, lit, text: card.cells ? CELL_ORDER.map((d) => cellEls[d].textContent) : [card.line] });
    },
    dispose() {
      root.remove();
    },
  };
}
