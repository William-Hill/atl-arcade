// The results screen (M1-05): the medal, the score, the best combo, the goal
// list, and a replay button. Plain DOM. It shows a `computeResults` object
// (src/sim/skate/goals.js); it does not compute anything.
//
// The panel keeps clear of the minimap and the safe areas (src/shell.css).
// Enter or the replay button starts a new run. The music select (#20) lists
// `tracks` ({ id, title }) and calls `onTrack(id)` on a change.

import { cardButtonLabel } from "../landmarks/story-card.js";
import "./story-card.css";

const MEDAL_NAMES = { gold: "Gold", silver: "Silver", bronze: "Bronze" };

function el(tag, className, parent, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent.appendChild(node);
  return node;
}

const fmt = (n) => Math.round(n).toLocaleString("en-US");

// `onTour` (#260), when given, adds a second button that starts a tour: the
// landmark loop with no timer.
export const TOUR_BUTTON = "Tour (no timer)";
//
// The landmark row (#220): the story cards that this run claimed, with a
// "NEW" stamp on a first claim. A tap, a click, Enter or Space on a card
// calls `onCard(model, button)` (the story card view opens over the panel).
// `busy()` is true while that view is open: Enter then does not replay.
export const SPOTS_TITLE = "Spots claimed";
export function createResults(parent, { title = "", onReplay = () => {}, tracks = [], trackId = null, onTrack = () => {}, onTour = null, onCard = () => {}, busy = () => false } = {}) {
  const root = el("div", "results", parent);
  root.id = "results";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "results-title");
  const card = el("div", "results-card", root);

  const head = el("div", "results-head", card);
  const heading = el("h2", "results-title", head, "Time!");
  heading.id = "results-title";
  if (title) el("div", "results-level", head, title);
  const medal = el("div", "results-medal", card);
  medal.id = "results-medal";

  const stats = el("dl", "results-stats", card);
  el("dt", "", stats, "Score");
  const score = el("dd", "", stats);
  score.id = "results-score";
  el("dt", "", stats, "Best combo");
  const best = el("dd", "", stats);
  best.id = "results-best";

  const list = el("ul", "results-goals", card);
  list.id = "results-goals";
  list.setAttribute("aria-label", "Goals");

  // The landmark row: hidden when this run claimed no spot.
  const spots = el("section", "results-spots", card);
  spots.id = "results-spots";
  spots.hidden = true;
  spots.setAttribute("aria-labelledby", "results-spots-title");
  const spotsTitle = el("h3", "results-spots-title", spots, SPOTS_TITLE);
  spotsTitle.id = "results-spots-title";
  const spotRow = el("ul", "results-spot-row", spots);

  let music = null;
  if (tracks.length) {
    const row = el("label", "results-music", card);
    el("span", "results-music-label", row, "Music");
    music = el("select", "results-music-select", row);
    music.id = "results-track";
    for (const t of tracks) {
      const opt = el("option", "", music, t.title);
      opt.value = t.id;
    }
    if (trackId && tracks.some((t) => t.id === trackId)) music.value = trackId;
    music.addEventListener("change", () => onTrack(music.value));
    // The game's keys must not change the track or start a run from the select.
    music.addEventListener("keydown", (e) => e.stopPropagation());
  }

  const replay = el("button", "results-replay", card, "Skate again");
  replay.id = "results-replay";
  replay.type = "button";

  let tour = null;
  if (onTour) {
    tour = el("button", "results-tour", card, TOUR_BUTTON);
    tour.id = "results-tour";
    tour.type = "button";
    tour.addEventListener("click", (e) => {
      e.stopPropagation();
      if (shown) onTour();
    });
  }

  let shown = null;
  const doReplay = () => {
    if (!shown) return;
    onReplay();
  };
  replay.addEventListener("click", (e) => {
    e.stopPropagation();
    doReplay();
  });
  // Enter replays. The keys of the game (Space, R) keep their own meaning.
  window.addEventListener("keydown", (e) => {
    if (shown && !busy() && e.code === "Enter" && !document.activeElement?.closest?.(".results-spot") && document.activeElement !== replay && document.activeElement !== music && document.activeElement !== tour) {
      e.preventDefault();
      doReplay();
    }
  });

  // One button for each card: the art, the name and the stamp.
  function renderSpots(cards) {
    spotRow.replaceChildren();
    spots.hidden = cards.length === 0;
    for (const model of cards) {
      const li = el("li", "", spotRow);
      const b = el("button", "results-spot", li);
      b.type = "button";
      b.dataset.spot = model.id;
      b.dataset.foil = model.foil ? "1" : "0";
      b.style.setProperty("--story-band", model.band);
      b.setAttribute("aria-label", cardButtonLabel(model));
      const art = el("span", "results-spot-art", b);
      if (model.art) {
        const img = el("img", "", art);
        img.alt = "";
        img.decoding = "async";
        img.src = model.art.src;
        img.addEventListener("error", () => img.remove());
      }
      el("span", "results-spot-name", b, model.title);
      if (model.stamp) el("span", "results-spot-stamp", b, model.stamp);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (shown) onCard(model, b);
      });
      // Enter and Space open the card here: the game's keys (Space) do not
      // see them.
      b.addEventListener("keydown", (e) => {
        if ((e.code !== "Enter" && e.code !== "Space") || e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        if (shown) onCard(model, b);
      });
    }
  }

  return {
    // `cards` are the story card models of this run (src/landmarks/
    // story-card.js resultsCards()).
    show(results, cards = []) {
      shown = results;
      renderSpots(cards);
      root.dataset.medal = results.medal ?? "none";
      medal.textContent = results.medal ? `${MEDAL_NAMES[results.medal]} medal` : "No medal";
      if (results.next) medal.textContent += ` · ${MEDAL_NAMES[results.next.medal]} at ${fmt(results.next.score)}`;
      score.textContent = fmt(results.score);
      best.textContent = fmt(results.bestCombo);
      list.replaceChildren(
        ...results.goals.map((g) => {
          const li = document.createElement("li");
          li.dataset.goal = g.id;
          li.dataset.done = g.done ? "1" : "0";
          const mark = el("span", "results-mark", li, g.done ? "✓" : "–");
          mark.setAttribute("aria-hidden", "true");
          el("span", "results-label", li, g.label);
          const progress = g.type === "gap" ? (g.done ? "Done" : "Not yet") : `${fmt(Math.min(g.value, g.target))} / ${fmt(g.target)}`;
          el("span", "results-progress", li, progress);
          li.setAttribute("aria-label", `${g.label}: ${g.done ? "done" : "not done"}`);
          return li;
        }),
      );
      root.hidden = false;
      document.body.classList.add("results-open");
      replay.focus({ preventScroll: true });
    },
    hide() {
      shown = null;
      root.hidden = true;
      document.body.classList.remove("results-open");
      if (document.activeElement === replay) replay.blur();
    },
    get shown() {
      return shown;
    },
    // The ids of the cards in the landmark row.
    get spots() {
      return [...spotRow.querySelectorAll(".results-spot")].map((b) => b.dataset.spot);
    },
    get track() {
      return music ? music.value : null;
    },
    setTrack(id) {
      if (music) music.value = id;
    },
    root,
  };
}
