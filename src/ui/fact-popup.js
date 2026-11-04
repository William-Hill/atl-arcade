// The fact card pop-up (M1-07, #17): one line of text and a source link to
// the dataset page. It shows for FACT_CARDS.showSeconds and never pauses
// play. Plain DOM; shell.css keeps it inside the safe areas and clear of
// the HUD, the minimap, and the touch controls.

import { FACT_CARDS } from "../sim/fact-cards.js";

export function createFactPopup(parent, { showMs = FACT_CARDS.showSeconds * 1000 } = {}) {
  const root = document.createElement("div");
  root.id = "fact-popup";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.hidden = true;
  const label = document.createElement("div");
  label.className = "fact-label";
  const text = document.createElement("div");
  text.className = "fact-text";
  const source = document.createElement("a");
  source.className = "fact-source";
  source.target = "_blank";
  source.rel = "noopener";
  root.append(label, text, source);
  parent.appendChild(root);

  const state = { id: null, until: 0, shown: 0 };
  return {
    // `card` is { id, text, title, publisher, sourceUrl }; `count` and
    // `total` are the cards collected in this run.
    show(card, nowMs, { count, total } = {}) {
      label.textContent = count && total ? `ATL FACT ${count}/${total}` : "ATL FACT";
      text.textContent = card.text;
      source.textContent = `Source: ${card.title}${card.publisher ? `, ${card.publisher}` : ""}`;
      source.href = card.sourceUrl;
      root.hidden = false;
      state.id = card.id;
      state.until = nowMs + showMs;
      state.shown += 1;
    },
    update(nowMs) {
      if (!root.hidden && nowMs >= state.until) {
        root.hidden = true;
        state.id = null;
      }
    },
    get state() {
      return { visible: !root.hidden, id: state.id, text: root.hidden ? null : text.textContent, shown: state.shown };
    },
    element: root,
  };
}
