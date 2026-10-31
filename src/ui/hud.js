// HUD: combo string, pending score and multiplier, banked score, style
// meter, balance meter while grinding. Plain DOM, updated once per frame
// from the run state. The simulation never sees this.

import { comboString, comboValue } from "../sim/skate/combo.js";

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent.appendChild(node);
  return node;
}

export function createHud(root) {
  root.innerHTML = "";
  const score = el("div", "hud-score", root);
  score.id = "hud-score";
  const combo = el("div", "hud-combo", root);
  combo.id = "hud-combo";
  const pending = el("div", "hud-pending", root);
  pending.id = "hud-pending";
  const tag = el("div", "hud-tag", root);
  tag.id = "hud-tag";

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

  return {
    update(run, nowMs = performance.now()) {
      const c = run.combo;
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
      if (s.state === "grind" && s.grind) {
        balanceWrap.style.display = "";
        balanceDot.style.left = `${50 + Math.max(-1, Math.min(1, s.grind.balance)) * 48}%`;
      } else {
        balanceWrap.style.display = "none";
      }

      // Flash the last on-beat tag (M0-07) or the last move name for a moment.
      const last = run.moves && run.moves[run.moves.length - 1];
      if (last) {
        tag.textContent = last.beatTag ? `${last.beatTag} ${last.name}` : last.name;
        tag.dataset.beat = last.beatTag ?? "";
        tagUntil = nowMs + 900;
      }
      tag.style.opacity = nowMs < tagUntil ? "1" : "0";
    },
    elements: { score, combo, pending, tag, styleFill, balanceWrap, balanceDot },
  };
}
