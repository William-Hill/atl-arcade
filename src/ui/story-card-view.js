// The story card view of the results screen (#220): one landmark story card
// over the results panel. A tap or a click on a card of the results row
// opens it. It closes with Escape, its close button, or a tap outside the
// card, and the focus goes back to the card button that opened it.
//
// The card markup is the full map panel (src/ui/landmark-guide.js
// createSpotCard(), class `is-story`), so both places show the same card.
// The model is storyCardModel() of src/landmarks/story-card.js. The results
// screen shows after the run, so play never pauses for a card (GDD AC-7).

import { createSpotCard } from "./landmark-guide.js";

const FOCUSABLE = "a[href], button:not([disabled])";

export function createStoryView(parent, { reducedMotion = () => false } = {}) {
  const root = document.createElement("div");
  root.id = "story-view";
  root.hidden = true;
  parent.appendChild(root);
  let from = null;
  let current = null;

  const card = createSpotCard(root, { onClose: () => close(), titleId: "story-view-title", reducedMotion });
  card.root.setAttribute("aria-modal", "true");

  function open(model, opener = null) {
    if (!model) return false;
    current = model;
    from = opener;
    card.show({ ...model, short: null, hint: null, prompt: null }, model);
    root.hidden = false;
    card.closeBtn.focus({ preventScroll: true });
    return true;
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    card.hide();
    current = null;
    const back = from;
    from = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }

  // A tap on the dim backdrop, outside the card, closes it.
  root.addEventListener("click", (e) => {
    if (e.target === root) close();
  });
  // Keys stay in the view: the results screen and the game do not see them.
  // Tab and Shift+Tab go around the card.
  root.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      e.preventDefault();
      close();
    } else if (e.code === "Tab") {
      const items = [...card.root.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (items.length) {
        const i = items.indexOf(document.activeElement);
        const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
        e.preventDefault();
        items[next].focus();
      }
    }
    e.stopPropagation();
  });
  root.addEventListener("keyup", (e) => e.stopPropagation());

  return {
    open,
    close,
    get isOpen() {
      return !root.hidden;
    },
    get state() {
      return { open: !root.hidden, id: current?.id ?? null, stamp: current?.stamp ?? null, foil: Boolean(current?.foil) };
    },
    root,
    card,
  };
}
