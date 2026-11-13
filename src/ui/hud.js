// HUD: combo string, pending score and multiplier, banked score, style
// meter, balance meter while grinding. Plain DOM, updated once per frame
// from the run state. The simulation never sees this.

import { comboString, comboValue } from "../sim/skate/combo.js";
import { formatClock } from "../sim/skate/goals.js";
import { startHint } from "./layout.js";
import { nearEdge } from "../level/edge-fence.js";
import { createHudGoals } from "./hud-goals.js";

// The hint near the level edge fence (#229).
export const EDGE_HINT = "Edge of the map. Turn around and keep skating.";

// The style meter label, and the label when the signature move is ready
// (#97, MOB-12). The ready label has a text and a star shape, so the cue
// does not need color vision. The full bar also gets stripes (shell.css).
export const STYLE_LABEL = "STYLE";
export const STYLE_READY_LABEL = "\u2605 READY";

export function styleLabel(ready) {
  return ready ? STYLE_READY_LABEL : STYLE_LABEL;
}

// Pure: the beat pulse at a beat phase (0 at the beat, 1 just before the
// next). The ring flashes and grows on each beat. With reduced motion
// (#97, MOB-11) it does not grow; it only gets brighter and darker, so the
// beat still shows.
export function pulseLook(beatPhase, reducedMotion = false) {
  const fade = 1 - beatPhase;
  return { opacity: 0.25 + 0.75 * fade * fade, scale: reducedMotion ? 1 : 1 + 0.6 * fade * fade };
}

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

// `touch` is true when the touch controls show: the hints name a tap.
// `fence` is the level edge fence (src/level/edge-fence.js), or null.
// `reducedMotion()` is true when the beat pulse must not move (#97).
// `goalDef` is the goal definition of the level, or null for free skate.
export function createHud(root, { touch = false, fence = null, reducedMotion = () => false, goalDef = null } = {}) {
  root.innerHTML = "";
  // The score and the run timer (M1-05) share the top line.
  const top = el("div", "hud-top", root);
  const score = el("div", "hud-score", top);
  score.id = "hud-score";
  const timer = el("div", "hud-timer", top);
  timer.id = "hud-timer";
  timer.hidden = true;
  // The round goals and the confirmation of a met goal (#268).
  const roundGoals = createHudGoals(top, root);
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
  // The goal line of landmark discovery (#219): the challenge of the nearest
  // Found spot. The text is plain text from the data file (textContent).
  const goal = el("div", "hud-hint hud-goal", root);
  goal.id = "hud-goal";
  goal.hidden = true;

  const styleWrap = el("div", "hud-meter hud-style", root);
  const styleText = el("span", "hud-label", styleWrap);
  styleText.id = "hud-style-label";
  styleText.textContent = STYLE_LABEL;
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
    // `goalLine` is the landmark goal line (src/landmarks/play.js), or null.
    update(run, nowMs = performance.now(), beatPhase = null, goals = null, goalLine = null) {
      if (goal.hidden !== !goalLine) goal.hidden = !goalLine;
      if (goalLine && goal.textContent !== goalLine) goal.textContent = goalLine;
      const c = run.combo;
      timer.hidden = !goals;
      roundGoals.update(goals ? goalDef : null, goals, nowMs);
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
      const label = styleLabel(c.signatureReady);
      if (styleText.textContent !== label) styleText.textContent = label;

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
        const look = pulseLook(beatPhase, reducedMotion());
        pulse.style.opacity = String(look.opacity);
        pulse.style.transform = `scale(${look.scale})`;
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
    elements: { score, timer, roundGoals: roundGoals.elements.list, goalMet: roundGoals.elements.met, combo, pending, tag, pulse, edge, notice, goal, styleWrap, styleText, styleFill, balanceWrap, balanceDot },
  };
}
