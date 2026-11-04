// The results screen (M1-05): the medal, the score, the best combo, the goal
// list, and a replay button. Plain DOM. It shows a `computeResults` object
// (src/sim/skate/goals.js); it does not compute anything.
//
// The panel keeps clear of the minimap and the safe areas (src/shell.css).
// Enter or the replay button starts a new run.

const MEDAL_NAMES = { gold: "Gold", silver: "Silver", bronze: "Bronze" };

function el(tag, className, parent, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent.appendChild(node);
  return node;
}

const fmt = (n) => Math.round(n).toLocaleString("en-US");

export function createResults(parent, { title = "", onReplay = () => {} } = {}) {
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

  const replay = el("button", "results-replay", card, "Skate again");
  replay.id = "results-replay";
  replay.type = "button";

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
    if (shown && e.code === "Enter" && document.activeElement !== replay) {
      e.preventDefault();
      doReplay();
    }
  });

  return {
    show(results) {
      shown = results;
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
    root,
  };
}
