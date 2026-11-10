// Skater select menu. The pure part (the roster, the query parse, the URL,
// and the in-place switch) has Vitest tests. The DOM part is a row of buttons in the shell.

// The playable skaters, in menu order. `id` is the ?skater= value and the
// key in SKATER_MODELS (src/render/skater-model.js).
export const SKATERS = [
  { id: "nia", name: "Nia", tag: "Sway", home: "West End" },
  { id: "marcus", name: "Marcus", tag: "Tempo", home: "Old Fourth Ward" },
];

export const DEFAULT_SKATER = SKATERS[0].id;

// "capsule" is a debug value: the greybox capsule, no GLB.
export const DEBUG_SKATERS = ["capsule"];

// Returns the skater id for a ?skater= value. An unknown value gives the default.
export function resolveSkater(value) {
  const v = (value ?? "").trim().toLowerCase();
  if (SKATERS.some((s) => s.id === v) || DEBUG_SKATERS.includes(v)) return v;
  return DEFAULT_SKATER;
}

// Returns the URL with ?skater=<id>. The other query values stay.
export function skaterUrl(href, id) {
  const url = new URL(href);
  url.searchParams.set("skater", id);
  return url.toString();
}

// Pure: switches the skater in place (#97, MOB-13), with no page reload.
// `load(id)` gives a promise of the model; `apply(id, model)` puts it in
// the game. A click on a skater while another one loads cancels the first:
// only the last choice applies. A failed load keeps the current skater and
// calls onError(id, error).
export function createSkaterSwitch({ current, load, apply, onError = () => {} }) {
  let active = current;
  let wanted = current;
  let seq = 0;
  return {
    get current() {
      return active;
    },
    // The skater that loads now, or null.
    get pending() {
      return wanted !== active ? wanted : null;
    },
    // Resolves true when `id` is applied, false when it is the current
    // skater, a later choice replaced it, or its load failed.
    async select(id) {
      if (id === wanted) return false;
      wanted = id;
      const mine = ++seq;
      if (id === active) return false;
      let model;
      try {
        model = await load(id);
      } catch (err) {
        if (mine === seq) wanted = active;
        onError(id, err);
        return false;
      }
      if (mine !== seq) return false;
      apply(id, model);
      active = id;
      return true;
    },
  };
}

// Adds the menu to `root`. Each button removes its focus at once, so that
// Space and the arrow keys stay with the game. With `onSelect(id)` a click
// asks the game to switch the skater in place (it returns a promise of
// true when it applies); without it, a click loads the page again with
// that skater. The button of a skater that loads has aria-busy="true".
export function createSkaterSelect(root, current, { location = window.location, onSelect = null } = {}) {
  const nav = document.createElement("nav");
  nav.id = "skater-select";
  nav.setAttribute("aria-label", "Skater select");
  const buttons = new Map();
  const mark = (id) => {
    current = id;
    for (const [k, b] of buttons) b.setAttribute("aria-pressed", String(k === id));
  };
  for (const s of SKATERS) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.skater = s.id;
    b.setAttribute("aria-pressed", String(s.id === current));
    b.title = `${s.name} "${s.tag}", ${s.home}`;
    b.append(Object.assign(document.createElement("strong"), { textContent: s.name }));
    b.append(Object.assign(document.createElement("span"), { textContent: s.tag }));
    b.addEventListener("focus", () => b.blur());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!onSelect) {
        if (s.id !== current) location.assign(skaterUrl(location.href, s.id));
        return;
      }
      for (const other of buttons.values()) other.removeAttribute("aria-busy");
      if (s.id === current) {
        onSelect(s.id);
        return;
      }
      b.setAttribute("aria-busy", "true");
      Promise.resolve(onSelect(s.id))
        .then((applied) => {
          if (applied) mark(s.id);
        })
        .finally(() => b.removeAttribute("aria-busy"));
    });
    buttons.set(s.id, b);
    nav.appendChild(b);
  }
  root.appendChild(nav);
  return nav;
}
