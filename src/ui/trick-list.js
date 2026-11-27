// The trick list screen (#330, docs/ux/trick-hud.md section 9, E6): every
// slot per skater and per context, with the dance origins (R13). Its own
// dialog, as the settings dialog (owner choice 2026-11-26, Q2). The game
// pauses while it is open. The content is pure (src/ui/trick-map.js).
//
// Open: the T key, the TRICKS button, the "Trick list" button in the
// settings dialog, or the gamepad View/Back button (button 8, Q1).
// Close: Escape, T, B on the gamepad, View/Back, or the close button.

import { ARROWS } from "./trick-hud-text.js";
import { inputLine, originText, trickListSections } from "./trick-map.js";

export const TRICK_LIST_KEY_CODE = "KeyT";
export const PAD_VIEW = 8; // standard gamepad View/Back
const PAD = { a: 0, b: 1, lb: 4, rb: 5, up: 12, down: 13, left: 14, right: 15 };
export const SKATERS = Object.freeze([
  ["nia", "Nia"],
  ["marcus", "Marcus"],
]);

// Colors: paper #f3f3f7 on #14141c is 17:1, the pink #ff5fb2 6.9:1, the
// muted #c4c4d0 11:1 (WCAG AA). Touch targets are 44 px or larger.
const STYLE = `
#tricks-toggle {
  position: fixed; right: 16px; bottom: 108px; z-index: 20;
  min-width: 44px; min-height: 36px; padding: 8px 14px; border: 2px solid rgba(255, 255, 255, 0.35); border-radius: 8px;
  background: rgba(11, 11, 18, 0.7); color: #f3f3f7; font: 600 13px system-ui, sans-serif; letter-spacing: 0.08em; cursor: pointer;
}
#tricks-toggle kbd { font: inherit; opacity: 0.75; margin-left: 6px; }
#tricks-toggle:focus-visible, #trick-list :focus-visible { outline: 3px solid #ff5fb2; outline-offset: 2px; }
body:not(.touch):has(#minimap) #tricks-toggle { right: calc(16px + 180px + 10px + env(safe-area-inset-right)); }
body.photo-open #tricks-toggle { visibility: hidden; }
body.touch #tricks-toggle { min-height: 44px; }
body.touch #tricks-toggle kbd { display: none; }
#trick-list {
  width: min(960px, calc(100vw - 16px)); max-height: min(600px, calc(100dvh - 16px)); box-sizing: border-box; padding: 0;
  border: 2px solid rgba(255, 255, 255, 0.25); border-radius: 12px; background: #14141c; color: #f3f3f7; font: 15px/1.4 system-ui, sans-serif;
  overflow: hidden;
}
#trick-list[open] { display: flex; flex-direction: column; }
#trick-list::backdrop { background: rgba(0, 0, 0, 0.55); }
#trick-list .tl-head { display: flex; align-items: center; gap: 12px; padding: 10px 14px 6px; flex: none; flex-wrap: wrap; }
#trick-list h2 { margin: 0; font-size: 18px; letter-spacing: 0.1em; color: #ff5fb2; }
#trick-list [role="tablist"] { display: flex; gap: 6px; }
#trick-list [role="tab"], #trick-list .tl-close, #trick-list .tl-back {
  min-height: 44px; min-width: 44px; padding: 6px 14px; border: 2px solid rgba(255, 255, 255, 0.4); border-radius: 8px;
  background: #22222e; color: #f3f3f7; font: 600 15px system-ui, sans-serif; cursor: pointer;
}
#trick-list [role="tab"][aria-selected="true"] { border-color: #f3f3f7; box-shadow: inset 0 -3px 0 #ff5fb2; text-decoration: underline; text-decoration-thickness: 3px; text-underline-offset: 5px; }
#trick-list .tl-close { margin-left: auto; }
#trick-list .tl-input { margin: 0; padding: 0 14px 8px; color: #c4c4d0; font-size: 15px; flex: none; }
#trick-list .tl-body { overflow: auto; padding: 0 14px 14px; flex: 1; }
#trick-list .tl-sections { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }
#trick-list section { border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 8px; padding: 6px 10px 8px; }
#trick-list h3 { margin: 0 0 4px; font-size: 18px; }
#trick-list h3 small { font-size: 15px; font-weight: 600; color: #c4c4d0; margin-left: 6px; }
#trick-list ul.tl-compass { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-areas: ". u ." "l n r" ". d ."; gap: 4px; }
#trick-list ul.tl-compass li[data-dir="n"] { grid-area: n; } #trick-list ul.tl-compass li[data-dir="u"] { grid-area: u; }
#trick-list ul.tl-compass li[data-dir="l"] { grid-area: l; } #trick-list ul.tl-compass li[data-dir="r"] { grid-area: r; }
#trick-list ul.tl-compass li[data-dir="d"] { grid-area: d; }
#trick-list .tl-cell { display: block; width: 100%; min-height: 44px; box-sizing: border-box; padding: 4px 6px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; background: #1b1b26; color: #f3f3f7; font: 600 15px/1.25 system-ui, sans-serif; text-align: center; }
#trick-list button.tl-cell { cursor: pointer; border-color: rgba(255, 255, 255, 0.45); }
#trick-list .tl-cell small { display: block; color: #c4c4d0; font-size: 13px; font-weight: 500; }
#trick-list .tl-note { margin: 6px 0 0; color: #c4c4d0; font-size: 15px; }
#trick-list .tl-ob ol { margin: 2px 0 6px 20px; padding: 0; }
#trick-list .tl-detail { padding: 4px 0; }
#trick-list .tl-detail[hidden], #trick-list .tl-sections[hidden] { display: none; }
#trick-list .tl-detail a { color: #ff80c4; }
@media (max-width: 600px), (orientation: portrait) { #trick-list .tl-sections { grid-template-columns: 1fr; } }
@media (orientation: landscape) and (max-height: 500px) { #trick-list { max-height: calc(100dvh - 16px); } }
`;

function el(tag, parent, props = {}) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  parent.appendChild(node);
  return node;
}

// `skater()` is the skater in play; `source()` the input device in use
// ("keyboard", "gamepad", "touch"); `bindings()` the present bindings;
// `oneButton()` one-button mode; `canOpen()` false on the front screen, in
// photo mode, on the results screen, and while another dialog is open.
export function createTrickList({ root = document.body, skater = () => "nia", source = () => "keyboard", bindings = () => null, oneButton = () => false, canOpen = () => true, onChange = () => {}, touch = false } = {}) {
  if (!document.getElementById("trick-list-style")) el("style", document.head, { id: "trick-list-style", textContent: STYLE });

  const toggle = el("button", root, { id: "tricks-toggle", type: "button", innerHTML: "TRICKS<kbd>T</kbd>", title: "Trick list (T)" });
  toggle.setAttribute("aria-label", "Trick list");
  toggle.setAttribute("aria-keyshortcuts", "T");
  toggle.setAttribute("aria-haspopup", "dialog");
  toggle.setAttribute("aria-controls", "trick-list");
  toggle.setAttribute("aria-expanded", "false");

  const dialog = el("dialog", root, { id: "trick-list" });
  dialog.setAttribute("aria-labelledby", "trick-list-title");
  dialog.setAttribute("aria-modal", "true");
  const head = el("div", dialog, { className: "tl-head" });
  el("h2", head, { id: "trick-list-title", textContent: "TRICKS" });
  const tablist = el("div", head);
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Skater");
  const tabs = {};
  for (const [id, name] of SKATERS) {
    const t = el("button", tablist, { type: "button", id: `trick-list-tab-${id}`, textContent: name });
    t.setAttribute("role", "tab");
    t.setAttribute("aria-controls", "trick-list-body");
    t.dataset.skater = id;
    t.addEventListener("click", () => select(id));
    tabs[id] = t;
  }
  const closeButton = el("button", head, { type: "button", className: "tl-close", textContent: "Close" });
  closeButton.setAttribute("aria-label", "Close the trick list");
  const input = el("p", dialog, { className: "tl-input", id: "trick-list-input" });
  const body = el("div", dialog, { className: "tl-body", id: "trick-list-body" });
  body.setAttribute("role", "tabpanel");
  const list = el("div", body, { className: "tl-sections" });
  const detail = el("div", body, { className: "tl-detail", hidden: true });
  detail.setAttribute("aria-live", "polite");

  let current = "nia";
  let opener = null;
  let detailFrom = null;
  let padPrev = [];

  function cellNode(parent, c, sectionId) {
    const li = el("li", parent);
    li.dataset.dir = c.dir;
    const text = `${ARROWS[c.dir]} ${c.name}`;
    if (c.origin) {
      const b = el("button", li, { type: "button", className: "tl-cell" });
      b.setAttribute("aria-label", `${c.label}. ${originText(c.origin)}. Show the origin`);
      el("span", b, { textContent: text });
      el("small", b, { textContent: originText(c.origin) });
      b.dataset.dance = c.name;
      b.addEventListener("click", () => showDetail(c, b));
    } else {
      const d = el("div", li, { className: "tl-cell" });
      d.setAttribute("aria-label", c.label);
      d.textContent = text;
    }
    li.dataset.section = sectionId;
  }

  function render() {
    const device = source() === "gamepad" ? "gamepad" : touch || source() === "touch" ? "touch" : "keyboard";
    input.textContent = inputLine(device, bindings());
    list.replaceChildren();
    for (const s of trickListSections(current, { device, bindings: bindings(), oneButton: oneButton() })) {
      const sec = el("section", list, { className: `tl-${s.id}` });
      sec.dataset.id = s.id;
      const h = el("h3", sec, { textContent: s.title });
      el("small", h, { textContent: s.button });
      if (s.list) {
        sec.classList.add("tl-ob");
        for (const part of s.list) {
          el("strong", sec, { textContent: part.title });
          const ol = el("ol", sec);
          for (const item of part.items) el("li", ol, { textContent: item });
        }
      } else {
        const ul = el("ul", sec, { className: "tl-compass" });
        for (const c of s.cells) cellNode(ul, c, s.id);
      }
      if (s.note) el("p", sec, { className: "tl-note", textContent: s.note });
    }
    for (const [id, t] of Object.entries(tabs)) {
      t.setAttribute("aria-selected", id === current ? "true" : "false");
      t.tabIndex = id === current ? 0 : -1;
    }
  }

  function showDetail(c, from) {
    detailFrom = from;
    detail.replaceChildren();
    const back = el("button", detail, { type: "button", className: "tl-back", textContent: "Back" });
    back.addEventListener("click", hideDetail);
    el("h3", detail, { textContent: c.name });
    el("p", detail, { textContent: c.origin.detail ?? originText(c.origin) });
    if (c.origin.sources.length) {
      const p = el("p", detail, { textContent: "Sources: " });
      c.origin.sources.forEach((src, i) => {
        if (i) p.append("; ");
        const a = el("a", p, { href: src.url, textContent: src.name, target: "_blank", rel: "noopener" });
        a.dataset.source = src.name;
      });
    }
    list.hidden = true;
    detail.hidden = false;
    back.focus();
  }

  function hideDetail() {
    detail.hidden = true;
    list.hidden = false;
    const back = detailFrom;
    detailFrom = null;
    if (back?.isConnected) back.focus();
  }

  function select(id) {
    if (!tabs[id] || id === current) return;
    current = id;
    hideDetail();
    render();
    tabs[id].focus();
  }

  function open() {
    if (dialog.open || !canOpen()) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    current = tabs[skater()] ? skater() : "nia";
    detail.hidden = true;
    list.hidden = false;
    render();
    dialog.showModal();
    tabs[current].focus();
    toggle.setAttribute("aria-expanded", "true");
    onChange(true);
  }

  function close() {
    if (!dialog.open) return;
    dialog.close();
  }
  dialog.addEventListener("close", () => {
    toggle.setAttribute("aria-expanded", "false");
    onChange(false);
    const back = opener;
    opener = null;
    if (back?.isConnected) back.focus();
  });
  // Escape closes the detail first, then the dialog.
  dialog.addEventListener("cancel", (e) => {
    if (!detail.hidden) {
      e.preventDefault();
      hideDetail();
    }
  });
  dialog.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.code === TRICK_LIST_KEY_CODE && !e.repeat && !(e.ctrlKey || e.metaKey || e.altKey)) {
      e.preventDefault();
      close();
      return;
    }
    if (e.target?.getAttribute?.("role") === "tab" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const ids = SKATERS.map(([id]) => id);
      const i = ids.indexOf(current);
      select(ids[(i + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length]);
    }
  });
  // A tap outside the dialog box (on the backdrop) closes it.
  dialog.addEventListener("click", (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });
  closeButton.addEventListener("click", close);
  toggle.addEventListener("click", () => (dialog.open ? close() : open()));
  window.addEventListener("keydown", (e) => {
    if (e.code !== TRICK_LIST_KEY_CODE || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (!dialog.open) open();
  });

  const focusables = () => [...dialog.querySelectorAll("button, a[href]")].filter((n) => n.offsetParent !== null);
  function moveFocus(step) {
    const all = focusables();
    if (!all.length) return;
    const i = all.indexOf(document.activeElement);
    all[(i + step + all.length) % all.length].focus();
  }

  return {
    toggle,
    dialog,
    open,
    close,
    get isOpen() {
      return dialog.open;
    },
    get skater() {
      return current;
    },
    // The gamepad (once per frame): View/Back opens and closes; in the
    // dialog the d-pad moves the focus, A selects, B goes back, LB and RB
    // change the skater tab (9.6).
    pollPad(pad) {
      const now = pad ? Array.from(pad.buttons ?? [], (b) => Boolean(b && (b.pressed || b.value > 0.5))) : [];
      const edge = (i) => Boolean(now[i]) && !padPrev[i];
      if (edge(PAD_VIEW)) {
        if (dialog.open) close();
        else open();
      } else if (dialog.open) {
        if (edge(PAD.b)) {
          if (!detail.hidden) hideDetail();
          else close();
        } else if (edge(PAD.a)) document.activeElement?.click?.();
        else if (edge(PAD.lb) || edge(PAD.rb)) {
          const ids = SKATERS.map(([id]) => id);
          const i = ids.indexOf(current);
          select(ids[(i + (edge(PAD.rb) ? 1 : ids.length - 1)) % ids.length]);
        } else if (edge(PAD.down) || edge(PAD.right)) moveFocus(1);
        else if (edge(PAD.up) || edge(PAD.left)) moveFocus(-1);
      }
      padPrev = now;
    },
  };
}
