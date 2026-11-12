// The DOM of the landmark spots on the full map (#218): the Guide tab (the
// spots by kind, with "n of N claimed" and "m of M found") and the panel of
// one spot. The text and the rows come from src/ui/landmark-icons.js (pure).
//
// Every string of the data file (a name, a `short` line, a fact, a source
// name) goes in with textContent, never as HTML. A source link is an https
// URL of the file (safeSourceUrl()), or the source shows as plain text.
//
// The panel here is plain. The trading card design, the "NEW" stamp and
// the card art are #220.

import { guideModel } from "./landmark-icons.js";
import { iconCanvas } from "./spot-icon.js";

function el(tag, className, parent, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// The Guide tab panel. `onPick(id, event)` is called for a row.
export function createGuide(parent, { onPick }) {
  const root = el("div", "fullmap-guide", parent);
  root.id = "fullmap-guide";
  root.hidden = true;
  root.setAttribute("role", "tabpanel");
  root.setAttribute("aria-labelledby", "fullmap-tab-guide");
  const counts = el("div", "fullmap-guide-counts", root);
  const claimed = el("p", "fullmap-guide-claimed", counts);
  const found = el("p", "fullmap-guide-found", counts);
  const list = el("div", "fullmap-guide-list", root);

  return {
    root,
    // Draws the rows again. The focus stays on the row of the same spot.
    render(view) {
      const model = guideModel(view);
      const focused = document.activeElement?.closest?.(".fullmap-guide-row")?.dataset.spot ?? null;
      claimed.textContent = model.counts.claimed;
      found.textContent = model.counts.found;
      list.replaceChildren();
      for (const group of model.groups) {
        const section = el("section", "fullmap-guide-group", list);
        section.dataset.kind = group.kind;
        const title = el("h3", "fullmap-guide-kind", section, group.title);
        title.id = `fullmap-guide-kind-${group.kind}`;
        const ul = el("ul", null, section);
        ul.setAttribute("aria-labelledby", title.id);
        for (const row of group.rows) {
          const li = el("li", null, ul);
          const b = el("button", "fullmap-guide-row", li);
          b.type = "button";
          b.dataset.spot = row.id;
          b.dataset.look = row.look;
          b.appendChild(iconCanvas(row, 24));
          const text = el("span", "fullmap-guide-text", b);
          el("span", "fullmap-guide-name", text, row.title);
          el("span", "fullmap-guide-status", text, row.status);
          b.setAttribute("aria-label", row.look === "unknown" ? `A spot. ${row.status}` : `${row.title}. ${row.status}`);
          b.addEventListener("click", (e) => onPick(row.id, e));
          if (row.id === focused) b.focus({ preventScroll: true });
        }
      }
    },
    row: (id) => [...list.querySelectorAll(".fullmap-guide-row")].find((b) => b.dataset.spot === id) ?? null,
  };
}

// The panel of one spot. `onClose()` is called by its close button.
export function createSpotCard(parent, { onClose }) {
  const root = el("div", "fullmap-card", parent);
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-labelledby", "fullmap-card-title");
  const head = el("div", "fullmap-card-head", root);
  const iconBox = el("span", "fullmap-card-icon", head);
  const names = el("div", "fullmap-card-names", head);
  const title = el("h2", "fullmap-card-title", names);
  title.id = "fullmap-card-title";
  const kind = el("div", "fullmap-card-kind", names);
  const closeBtn = el("button", "fullmap-card-close", head, "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close (Escape)");
  const body = el("div", "fullmap-card-body", root);
  const foot = el("div", "fullmap-card-foot", root);
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClose();
  });

  return {
    root,
    closeBtn,
    foot,
    // `panel` is spotPanel() of landmark-icons.js.
    show(panel) {
      root.hidden = false;
      root.dataset.look = panel.look;
      root.dataset.spot = panel.id;
      iconBox.replaceChildren(iconCanvas({ kind: panel.kind ?? "building", look: panel.look }, 32));
      title.textContent = panel.title;
      kind.textContent = panel.kindLabel ?? "";
      kind.hidden = !panel.kindLabel;
      body.replaceChildren();
      if (panel.short) el("p", "fullmap-card-short", body, panel.short);
      if (panel.hint) el("p", "fullmap-card-hint", body, panel.hint);
      if (panel.prompt) el("p", "fullmap-card-prompt", body, panel.prompt);
      if (panel.facts.length) {
        const ol = el("ol", "fullmap-card-facts", body);
        for (const fact of panel.facts) {
          const li = el("li", null, ol);
          el("span", "fullmap-card-fact", li, fact.text);
          if (!fact.source) continue;
          const line = el("span", "fullmap-card-source", li, "Source: ");
          if (fact.source.url) {
            const a = el("a", null, line, fact.source.name);
            a.href = fact.source.url;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
          } else el("span", null, line, fact.source.name);
        }
      }
      body.scrollTop = 0;
    },
    hide() {
      root.hidden = true;
      delete root.dataset.spot;
    },
  };
}
