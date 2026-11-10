// HUD: combo string, pending score and multiplier, banked score, style
// meter, balance meter while grinding. Plain DOM, updated once per frame
// from the run state. The simulation never sees this.

import { comboString, comboValue } from "../sim/skate/combo.js";
import { formatClock } from "../sim/skate/goals.js";
import { startHint } from "./layout.js";
import { nearEdge } from "../level/edge-fence.js";

// The hint near the level edge fence (#229).
export const EDGE_HINT = "Edge of the map. Turn around and keep skating.";

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

// `touch` is true when the touch controls show: the hints name a tap.
// `fence` is the level edge fence (src/level/edge-fence.js), or null.
export function createHud(root, { touch = false, fence = null } = {}) {
  root.innerHTML = "";
  // The score and the run timer (M1-05) share the top line.
  const top = el("div", "hud-top", root);
  const score = el("div", "hud-score", top);
  score.id = "hud-score";
  const timer = el("div", "hud-timer", top);
  timer.id = "hud-timer";
  timer.hidden = true;
  const combo = el("div", "hud-combo", root);
  combo.id = "hud-combo";
  const pending = el("div", "hud-pending", root);
  pending.id = "hud-pending";
  const tag = el("div", "hud-tag", root);
  tag.id = "hud-tag";
  const pulse = el("div", "hud-pulse", root);
  pulse.id = "hud-pulse";
  const hint = el("div", "hud-hint", root);
  hint.id = "hud-hint";
  hint.textContent = startHint(touch);
  const edge = el("div", "hud-hint hud-edge", root);
  edge.id = "hud-edge";
  edge.textContent = EDGE_HINT;
  edge.hidden = true;
  // A one-time line from the game, for example the look step-down (#246).
  const notice = el("div", "hud-hint hud-notice", root);
  notice.id = "hud-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  let noticeTimer = null;

  const styleWrap = el("div", "hud-meter hud-style", root);
  el("span", "hud-label", styleWrap).textContent = "STYLE";
  const styleBar = el("div", "hud-bar", styleWrap);
  const styleFill = el("div", "hud-fill", styleBar);
  styleFill.id = "hud-style-fill";

  const balanceWrap = el("div", "hud-meter hud-balance", root);
  balanceWrap.id = "hud-balance";
  el("span", "hud-label", balanceWrap).textContent = "BALANCE";
  const balanceBar = el("div", "hud-bar", balanceWrap);
  const balanceDot = el("div", "hud-dot", balanceBar);
  balanceDot.id = "hud-balance-dot";

  let tagUntil = 0;
  let seenSeq = 0;

  return {
    // `goals` is the goal state (src/sim/skate/goals.js), or null for free skate.
    update(run, nowMs = performance.now(), beatPhase = null, goals = null) {
      const c = run.combo;
      timer.hidden = !goals;
      if (goals) {
        timer.textContent = formatClock(goals.timeLeft);
        timer.dataset.low = goals.timeLeft <= 10 ? "1" : "0";
      }
      score.textContent = c.score.toLocaleString("en-US");
      if (c.active) {
        combo.textContent = comboString(c);
        pending.textContent = `${c.pending.toLocaleString("en-US")} x ${c.multiplier}`;
        combo.dataset.active = "1";
      } else {
        combo.textContent = c.lastBanked ? `+${comboValue({ pending: c.lastBanked, multiplier: 1 }).toLocaleString("en-US")}` : "";
        pending.textContent = "";
        combo.dataset.active = "0";
      }
      styleFill.style.width = `${Math.round(c.style * 100)}%`;
      styleWrap.dataset.ready = c.signatureReady ? "1" : "0";

      const s = run.skater;
      edge.hidden = !nearEdge(fence, s.position[0], s.position[2]);
      if (s.state === "grind" && s.grind) {
        balanceWrap.style.display = "";
        balanceDot.style.left = `${50 + Math.max(-1, Math.min(1, s.grind.balance)) * 48}%`;
      } else {
        balanceWrap.style.display = "none";
      }

      // Flash the last move name (and its on-beat tag, M0-07) for a moment.
      // moveSeq counts every scored move, so a move on any tick of a
      // multi-tick frame still shows.
      const last = run.moveSeq !== seenSeq ? run.lastMove : null;
      seenSeq = run.moveSeq;
      if (last) {
        tag.textContent = last.beatTag ? `${last.beatTag} ${last.name}` : last.name;
        tag.dataset.beat = last.beatTag ?? "";
        tagUntil = nowMs + 900;
      }
      tag.style.opacity = nowMs < tagUntil ? "1" : "0";

      // Beat pulse: a ring that flashes on each beat and fades through the beat.
      // Browsers start audio only after a key or a click, and a gamepad
      // press does not count, so the hint stays until the beat runs.
      hint.style.display = beatPhase === null ? "" : "none";
      if (beatPhase === null) {
        pulse.style.display = "none";
      } else {
        pulse.style.display = "";
        const fade = 1 - beatPhase;
        pulse.style.opacity = String(0.25 + 0.75 * fade * fade);
        pulse.style.transform = `scale(${1 + 0.6 * fade * fade})`;
      }
    },
    // Shows one plain line for `ms`, then hides it.
    notice(text, ms = 6000) {
      notice.textContent = text;
      notice.hidden = false;
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        notice.hidden = true;
      }, ms);
    },
    elements: { score, timer, combo, pending, tag, pulse, edge, notice, styleFill, balanceWrap, balanceDot },
  };
}
