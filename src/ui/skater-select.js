// Skater select menu. The pure part (the roster, the query parse, and the URL)
// has Vitest tests. The DOM part is a row of buttons in the shell.

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

// Adds the menu to `root`. A click on a skater loads the page again with that
// skater. Each button removes its focus at once, so that Space and the arrow
// keys stay with the game.
export function createSkaterSelect(root, current, { location = window.location } = {}) {
  const nav = document.createElement("nav");
  nav.id = "skater-select";
  nav.setAttribute("aria-label", "Skater select");
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
      if (s.id !== current) location.assign(skaterUrl(location.href, s.id));
    });
    nav.appendChild(b);
  }
  root.appendChild(nav);
  return nav;
}
