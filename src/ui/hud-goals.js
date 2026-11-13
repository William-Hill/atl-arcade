// The round goals on the HUD (#268): one chip per goal row in the score
// line, and a short confirmation when a goal is met. Plain DOM; the rows
// come from the pure helper in goal-progress.js. The landmark goal line
// (#hud-goal, #219) is a different element and this module does not touch it.

import { goalRows, goalStatus, metText, newlyMet, rowText } from "./goal-progress.js";
import { isCompact } from "./layout.js";

// How long one confirmation shows (ms).
export const MET_MS = 2600;

// `top` is the HUD score line; `root` takes the confirmation line.
// `compact()` is true on the phone tier: the numbers get shorter.
export function createHudGoals(top, root, { compact = () => isCompact(innerWidth, innerHeight) } = {}) {
  const list = document.createElement("div");
  list.className = "hud-goals";
  list.id = "hud-goals";
  list.hidden = true;
  top.appendChild(list);
  const chips = new Map();

  const met = document.createElement("div");
  met.className = "hud-met";
  met.id = "hud-met";
  met.setAttribute("role", "status");
  met.hidden = true;
  root.appendChild(met);

  let before = null;
  let ofState = null;
  let queue = [];
  let until = 0;

  return {
    // `def` and `state` are the goal definition and state, or null for free skate.
    update(def, state, nowMs) {
      if (!def || !state) {
        list.hidden = true;
        met.hidden = true;
        before = null;
        return;
      }
      list.hidden = false;
      if (state !== ofState) {
        ofState = state;
        const status = goalStatus(def, state);
        // A replay starts a new run: the old confirmations go.
        if (state.time === 0 || (before && status.some((g, i) => before[i].done && !g.done))) queue = [];
        queue.push(...newlyMet(before, status).map(metText));
        before = status;
        const small = compact();
        for (const row of goalRows(status)) {
          let chip = chips.get(row.key);
          if (!chip) {
            chip = document.createElement("span");
            chip.className = "hud-goal-chip";
            chip.dataset.goal = row.key;
            list.appendChild(chip);
            chips.set(row.key, chip);
          }
          const text = rowText(row, small);
          if (chip.textContent !== text) chip.textContent = text;
          chip.dataset.done = row.done ? "1" : "0";
        }
      }
      if (nowMs >= until && queue.length) {
        met.textContent = queue.shift();
        until = nowMs + MET_MS;
      }
      met.hidden = nowMs >= until;
    },
    elements: { list, met, chips },
  };
}
