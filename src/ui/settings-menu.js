// The settings menu (#94): the button, the dialog, and the O key. The pure
// logic is in src/ui/settings.js.
//
// A native <dialog> opened with showModal(): the browser keeps the focus in
// it, Escape closes it, and the page behind it is inert. The game stops while
// it is open. Each change saves at once. The ink and the bloom apply at
// once; the tier, the look, the walkers and the shadows need a reload, and
// the menu says so and offers a "Reload now" button.

import { PED_CHOICES, TIERS, applicableKeys, effectiveSettings, liveToggles, normalizeSettings, reloadKeys, tierPeds } from "./settings.js";

export const SETTINGS_KEY_CODE = "KeyO";

const TIER_TEXT = {
  low: ["Low", "Fastest. No shadows, no effects."],
  phone: ["Phone", "Ink outlines, no shadows."],
  high: ["High", "Shadows, soft light, bloom, longer view."],
};
const LOOK_TEXT = { toon: "Toon (cel shading)", pbr: "PBR (realistic light)" };
const KEY_TEXT = { quality: "the quality tier", look: "the look", peds: "the walkers", shadows: "the shadows" };

// Colors: paper #f3f3f7 on #14141c is 17:1, the pink #ff5fb2 is 6.9:1,
// and the muted text #c4c4d0 is 11:1. All pass WCAG AA (4.5:1).
const STYLE = `
#settings-toggle {
  position: fixed; right: 16px; bottom: 60px; z-index: 20;
  min-width: 44px; min-height: 36px; padding: 8px 14px; border: 2px solid rgba(255, 255, 255, 0.35); border-radius: 8px;
  background: rgba(11, 11, 18, 0.7); color: var(--atl-paper, #f3f3f7);
  font: 600 13px system-ui, sans-serif; letter-spacing: 0.08em; cursor: pointer;
}
#settings-toggle kbd { font: inherit; opacity: 0.75; margin-left: 6px; }
#settings-toggle:focus-visible, #settings-menu :focus-visible { outline: 3px solid #ff5fb2; outline-offset: 2px; }
#settings-menu {
  width: min(420px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; box-sizing: border-box;
  padding: 16px 18px; border: 2px solid rgba(255, 255, 255, 0.25); border-radius: 12px;
  background: #14141c; color: #f3f3f7; font: 15px/1.4 system-ui, sans-serif;
}
#settings-menu::backdrop { background: rgba(0, 0, 0, 0.55); }
#settings-menu h2 { margin: 0 0 8px; font-size: 18px; letter-spacing: 0.1em; color: #ff5fb2; }
#settings-menu fieldset { margin: 0 0 12px; padding: 8px 10px 10px; border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 8px; }
#settings-menu legend { padding: 0 4px; font-weight: 700; }
#settings-menu .settings-option { display: flex; align-items: flex-start; gap: 10px; min-height: 32px; padding: 4px 0; cursor: pointer; }
#settings-menu .settings-option input { width: 20px; height: 20px; margin: 2px 0 0; flex: none; accent-color: #ff5fb2; }
#settings-menu .settings-option small { display: block; color: #c4c4d0; font-size: 13px; }
#settings-menu .settings-option.is-off { cursor: default; }
#settings-menu .settings-option.is-off span { color: #c4c4d0; }
#settings-menu .settings-field { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 12px; font-weight: 700; }
#settings-menu select { min-height: 36px; padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.4); background: #22222e; color: #f3f3f7; font: inherit; }
#settings-menu .settings-note { margin: 4px 0 0; color: #c4c4d0; font-size: 13px; }
#settings-menu .settings-status { min-height: 1.4em; margin: 0 0 10px; font-size: 14px; }
#settings-menu .settings-status.is-reload { color: #ffd166; }
#settings-menu .settings-row { display: flex; gap: 8px; }
#settings-menu .settings-row button {
  flex: 1; min-height: 44px; padding: 8px 12px; border: 2px solid rgba(255, 255, 255, 0.4); border-radius: 8px;
  background: #22222e; color: #f3f3f7; font: 600 15px system-ui, sans-serif; cursor: pointer;
}
#settings-menu #settings-reload { border-color: #ff5fb2; background: #ff5fb2; color: #14141c; }
#settings-menu #settings-reload[hidden] { display: none; }
/* Over the photo button, at the same right edge (src/shell.css moves that
   button left of the minimap). */
body:not(.touch):has(#minimap) #settings-toggle { right: calc(16px + 180px + 10px + env(safe-area-inset-right)); }
body.photo-open #settings-toggle { visibility: hidden; }
/* On a touch screen the photo button sits at the top center; this one sits
   to its right. */
body.touch #settings-toggle { bottom: auto; top: calc(30px + env(safe-area-inset-top)); right: auto; left: calc(50% + 56px); min-height: 44px; }
/* Tap targets of 44 px on a touch screen (WCAG 2.5.5). The button above
   starts 10 px higher than the photo button, so its 44 px end above the map. */
body.touch #settings-menu .settings-option, body.touch #settings-menu select { min-height: 44px; }
body.touch #settings-menu .settings-option { align-items: center; }
body.touch #settings-menu .settings-option input { margin: 0; }
`;

function el(tag, parent, props = {}) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  parent.appendChild(node);
  return node;
}

function option(parent, { type, name, value, id, title, hint }) {
  const label = el("label", parent, { className: "settings-option" });
  const input = el("input", label, { type, name, value, id });
  if (hint) input.setAttribute("aria-describedby", `${id}-hint`);
  const text = el("span", label, { textContent: title });
  const small = hint ? el("small", text, { id: `${id}-hint`, textContent: hint }) : null;
  return { label, input, text, small };
}

// running: effectiveSettings() of what runs now. choice: the menu's start
// (choiceFrom()). sources: sourcesOf(). autoQuality: the device tier.
// post(): { kind, look } of the running chain, for the live toggles.
// onSave(settings): saves. onLive(settings): applies the ink and the bloom.
// reload(keys, carry): reloads the page; `carry` is the choice when storage
// did not keep it, else null. canOpen(): false while photo mode or the
// full map is open. onChange(open).
export function createSettingsMenu({ root = document.body, running, choice, sources, autoQuality, post = () => ({ kind: null, look: running.look }), onSave = () => {}, onLive = () => {}, reload = () => {}, canOpen = () => true, onChange = () => {} }) {
  if (!document.getElementById("settings-menu-style")) el("style", document.head, { id: "settings-menu-style", textContent: STYLE });

  let state = normalizeSettings(choice);
  let pending = [];
  // False after a save fails: then a reload carries the choice in the URL
  // flags, and the shadows (no URL flag) cannot apply.
  let stored = true;
  let blocked = [];

  const toggleButton = el("button", root, { id: "settings-toggle", type: "button", innerHTML: "SETTINGS<kbd>O</kbd>", title: "Settings (O)" });
  toggleButton.setAttribute("aria-label", "Settings");
  toggleButton.setAttribute("aria-keyshortcuts", "O");
  toggleButton.setAttribute("aria-haspopup", "dialog");
  toggleButton.setAttribute("aria-controls", "settings-menu");
  toggleButton.setAttribute("aria-expanded", "false");

  const dialog = el("dialog", root, { id: "settings-menu" });
  dialog.setAttribute("aria-labelledby", "settings-title");
  el("h2", dialog, { id: "settings-title", textContent: "SETTINGS" });

  const tierSet = el("fieldset", dialog, { id: "settings-quality" });
  el("legend", tierSet, { textContent: "Render quality" });
  const tierInputs = {};
  const autoTier = option(tierSet, { type: "radio", name: "settings-quality", value: "auto", id: "settings-quality-auto", title: `Auto: ${TIER_TEXT[autoQuality][0]}`, hint: "The tier the game picked for this device." });
  tierInputs.auto = autoTier.input;
  for (const t of TIERS) tierInputs[t] = option(tierSet, { type: "radio", name: "settings-quality", value: t, id: `settings-quality-${t}`, title: TIER_TEXT[t][0], hint: TIER_TEXT[t][1] }).input;
  const tierNote = el("p", tierSet, { className: "settings-note", id: "settings-quality-note" });

  const lookSet = el("fieldset", dialog, { id: "settings-look" });
  el("legend", lookSet, { textContent: "Look" });
  const lookInputs = { auto: option(lookSet, { type: "radio", name: "settings-look", value: "auto", id: "settings-look-auto", title: "Auto" }) };
  for (const l of ["toon", "pbr"]) lookInputs[l] = option(lookSet, { type: "radio", name: "settings-look", value: l, id: `settings-look-${l}`, title: LOOK_TEXT[l] });
  const lookNote = el("p", lookSet, { className: "settings-note", id: "settings-look-note" });

  const pedsField = el("div", dialog, { className: "settings-field" });
  el("label", pedsField, { htmlFor: "settings-peds", textContent: "Walkers" });
  const peds = el("select", pedsField, { id: "settings-peds" });
  const pedsAuto = el("option", peds, { value: "auto" });
  for (const n of PED_CHOICES) el("option", peds, { value: String(n), textContent: n === 0 ? "None" : String(n) });
  const pedsNote = el("p", dialog, { className: "settings-note", id: "settings-peds-note" });
  pedsNote.style.margin = "-8px 0 12px";
  peds.setAttribute("aria-describedby", "settings-peds-note");

  const fxSet = el("fieldset", dialog, { id: "settings-effects" });
  el("legend", fxSet, { textContent: "Effects" });
  const fx = {
    shadows: option(fxSet, { type: "checkbox", name: "shadows", value: "on", id: "settings-shadows", title: "Shadows", hint: "Sun shadows. Applies after a reload." }),
    ink: option(fxSet, { type: "checkbox", name: "ink", value: "on", id: "settings-ink", title: "Ink outlines", hint: "Applies at once." }),
    bloom: option(fxSet, { type: "checkbox", name: "bloom", value: "on", id: "settings-bloom", title: "Bloom", hint: "Applies at once." }),
  };

  const status = el("p", dialog, { className: "settings-status", id: "settings-status" });
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const row = el("div", dialog, { className: "settings-row" });
  const reloadButton = el("button", row, { id: "settings-reload", type: "button", textContent: "Reload now", hidden: true });
  const closeButton = el("button", row, { id: "settings-close", type: "button", textContent: "Close" });

  const urlNote = (key) => (sources[key] === "url" ? "The page address set this. A reload from here uses your choice." : "");

  function show() {
    const next = effectiveSettings(state, autoQuality);
    const nextAuto = effectiveSettings({ ...state, look: "auto", peds: "auto", shadows: "auto" }, autoQuality);
    for (const [k, input] of Object.entries(tierInputs)) input.checked = state.quality === k;
    tierNote.textContent = urlNote("quality");
    tierNote.hidden = !tierNote.textContent;
    for (const [k, o] of Object.entries(lookInputs)) o.input.checked = state.look === k;
    lookInputs.auto.text.textContent = `Auto: ${nextAuto.look === "pbr" ? "PBR" : "Toon"}`;
    lookNote.textContent = urlNote("look");
    lookNote.hidden = !lookNote.textContent;
    pedsAuto.textContent = `Auto (${tierPeds(next.quality)})`;
    peds.value = state.peds === "auto" ? "auto" : String(state.peds);
    if (peds.value !== String(state.peds) && state.peds !== "auto") {
      // A count from the URL that is not in the list.
      el("option", peds, { value: String(state.peds), textContent: String(state.peds) });
      peds.value = String(state.peds);
    }
    pedsNote.textContent = urlNote("peds");
    pedsNote.hidden = !pedsNote.textContent;

    fx.shadows.input.checked = next.shadows;
    // The live toggles need the matching pass in the running chain.
    const p = post();
    const live = liveToggles(p.kind, p.look);
    for (const key of ["ink", "bloom"]) {
      const o = fx[key];
      o.input.checked = state[key];
      o.input.disabled = !live[key];
      o.label.classList.toggle("is-off", !live[key]);
      o.small.textContent = live[key] ? "Applies at once." : key === "bloom" ? "Needs the High tier." : p.look === "pbr" && p.kind === "full" ? "The PBR look has no ink outlines." : "Needs the Phone or High tier.";
    }

    const wanted = reloadKeys(running, next);
    pending = applicableKeys(wanted, stored);
    blocked = wanted.filter((k) => !pending.includes(k));
    reloadButton.hidden = pending.length === 0;
    toggleButton.setAttribute("aria-expanded", String(dialog.open));
  }

  function say(text, reload) {
    status.textContent = text;
    status.classList.toggle("is-reload", Boolean(reload));
  }

  function change(patch, key) {
    state = normalizeSettings({ ...state, ...patch });
    const saved = onSave(state) !== false;
    stored = saved;
    if (key === "ink" || key === "bloom") onLive(state);
    show();
    const note = saved ? "Saved." : "Your browser does not keep settings, so this lasts for this page only.";
    const list = blocked.map((k) => KEY_TEXT[k]).join(", ");
    const cannot = blocked.length ? ` ${list[0].toUpperCase()}${list.slice(1)} cannot apply without saved settings.` : "";
    if (pending.length) say(`${note} Reload to apply ${pending.map((k) => KEY_TEXT[k]).join(", ")}.${cannot}`, true);
    else say(`${note}${cannot || " Applied."}`, Boolean(cannot));
  }

  function open() {
    if (dialog.open || !canOpen()) return;
    say("", false);
    show();
    dialog.showModal();
    onChange(true);
    show();
  }
  function close() {
    if (!dialog.open) return;
    dialog.close();
  }
  function toggle() {
    if (dialog.open) close();
    else open();
  }

  for (const [k, input] of Object.entries(tierInputs)) input.addEventListener("change", () => input.checked && change({ quality: k }, "quality"));
  for (const [k, o] of Object.entries(lookInputs)) o.input.addEventListener("change", () => o.input.checked && change({ look: k }, "look"));
  peds.addEventListener("change", () => change({ peds: peds.value === "auto" ? "auto" : Number(peds.value) }, "peds"));
  fx.shadows.input.addEventListener("change", () => {
    const def = effectiveSettings({ ...state, shadows: "auto" }, autoQuality).shadows;
    change({ shadows: fx.shadows.input.checked === def ? "auto" : fx.shadows.input.checked }, "shadows");
  });
  for (const key of ["ink", "bloom"]) fx[key].input.addEventListener("change", () => change({ [key]: fx[key].input.checked }, key));

  toggleButton.addEventListener("click", () => toggle());
  closeButton.addEventListener("click", () => close());
  reloadButton.addEventListener("click", () => reload(pending, stored ? null : { ...state }));
  // The browser closes the dialog on Escape ("cancel") and returns the focus
  // to the button that opened it.
  dialog.addEventListener("close", () => {
    show();
    onChange(false);
    toggleButton.focus();
  });
  // Keys in the menu stay in the menu: the game, photo mode and the map do
  // not see them. O closes it.
  dialog.addEventListener("keydown", (e) => {
    if (e.code === SETTINGS_KEY_CODE && !e.repeat && !(e.ctrlKey || e.metaKey || e.altKey)) {
      e.preventDefault();
      close();
    }
    e.stopPropagation();
  });
  dialog.addEventListener("keyup", (e) => e.stopPropagation());
  window.addEventListener("keydown", (e) => {
    if (e.code !== SETTINGS_KEY_CODE || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) return;
    e.preventDefault();
    toggle();
  });
  show();

  return {
    get isOpen() {
      return dialog.open;
    },
    get state() {
      return { ...state };
    },
    get pending() {
      return [...pending];
    },
    open,
    close,
    toggle,
  };
}
