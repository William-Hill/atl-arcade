// The landmark spots on the maps (#218). Pure: no DOM, no canvas, no file
// access. The canvas part is src/ui/spot-icon.js, the DOM part is
// src/ui/landmark-guide.js. Vitest tests this module.
//
// Design: design/gdd/landmark-discovery.md ("Map icons", "UI Requirements",
// M-1 to M-3). The spots and their states come from the landmark module
// (src/sim/landmarks.js landmarkView()); this module does not compute a
// state. It only turns the view into icons, list rows and panel text.
//
// A spot that is Unknown gives no name, no `short` line and no fact to the
// maps: the functions here leave them out, so the DOM cannot show them.

import { mapParks } from "./minimap-math.js";

// The kinds in list order, with the heading of each group of the Guide tab.
export const SPOT_KINDS = [
  { kind: "building", title: "Buildings", one: "Building" },
  { kind: "bridge", title: "Bridges", one: "Bridge" },
  { kind: "park", title: "Parks", one: "Park" },
  { kind: "skate", title: "Skate spots", one: "Skate spot" },
  { kind: "art", title: "Art", one: "Art" },
  { kind: "edge", title: "Past the map edge", one: "Past the map edge" },
];

export const ICON_SIZE = {
  minimapMin: 14, // CSS px, the least size on the minimap (GDD).
  minimapShare: 0.12, // of the minimap width: 22 px on the 180 px desktop map.
  fullmap: 24, // CSS px (GDD).
};

// The icon size on a minimap of `css` CSS pixels.
export function minimapIconSize(css) {
  return Math.max(ICON_SIZE.minimapMin, Math.round(css * ICON_SIZE.minimapShare));
}

export const ICON_COLORS = { ink: "#0b0b12", paper: "#f3f3f7", white: "#ffffff", gray: "#6f7488", gold: "#ffd166" };

// The 4 looks of the GDD icon table. `line` is the outline width as a share
// of the icon size. The state reads by shape and mark, not by color only:
// a dashed circle with "?", a circle with a thick outline and the kind
// glyph, a circle with the glyph and a check mark, a square with an arrow.
export const ICON_STYLES = {
  unknown: { shape: "circle", fill: ICON_COLORS.gray, stroke: ICON_COLORS.paper, line: 0.08, dashed: true, mark: "?", markColor: ICON_COLORS.paper, check: false },
  found: { shape: "circle", fill: ICON_COLORS.white, stroke: ICON_COLORS.ink, line: 0.12, dashed: false, mark: "glyph", markColor: ICON_COLORS.ink, check: false },
  claimed: { shape: "circle", fill: ICON_COLORS.gold, stroke: ICON_COLORS.ink, line: 0.08, dashed: false, mark: "glyph", markColor: ICON_COLORS.ink, check: true },
  edge: { shape: "square", fill: ICON_COLORS.white, stroke: ICON_COLORS.ink, line: 0.1, dashed: false, mark: "arrow", markColor: ICON_COLORS.ink, check: false },
};

// The look of a spot. An edge marker stops at Found, and then it is the
// square. An Unknown edge marker is a "?" like every other Unknown spot.
export function iconLook(kind, state) {
  if (state === "unknown") return "unknown";
  if (kind === "edge") return "edge";
  return state === "claimed" ? "claimed" : "found";
}

const arc = (cx, cy, r, from, to, steps) => Array.from({ length: steps + 1 }, (_, i) => {
  const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
});

// The kind glyphs: polylines on a 16 px grid (+x right, +y down), drawn with
// one stroke width. The edge arrow points right (+x); the draw turns it.
const GLYPH_GRID = {
  // A flat roof with 2 windows.
  building: [
    [[3, 13.5], [3, 4], [13, 4], [13, 13.5], [3, 13.5]],
    [[1.5, 4], [14.5, 4]],
    [[6.25, 7.5], [6.25, 10]],
    [[9.75, 7.5], [9.75, 10]],
  ],
  // An arch under a deck.
  bridge: [
    [[1.5, 5.5], [14.5, 5.5]],
    [[2.5, 13.5], ...arc(8, 13.5, 5.5, 180, 360, 10).slice(1, -1), [13.5, 13.5]],
  ],
  // A tree: a round crown on a trunk.
  park: [
    [[8, 14.5], [8, 10]],
    arc(8, 6, 4.2, 90, 450, 14),
  ],
  // A quarter pipe: the floor, the curve up, and the back wall.
  skate: [[[1.5, 13.5], ...arc(4.5, 3.5, 10, 90, 0, 8), [14.5, 13.5], [1.5, 13.5]]],
  // A brush on a frame.
  art: [
    [[2.5, 4.5], [10.5, 4.5], [10.5, 12.5], [2.5, 12.5], [2.5, 4.5]],
    [[6, 9], [14, 1.5]],
    [[4.5, 10.5], [6, 9]],
  ],
  // An arrow.
  edge: [
    [[2.5, 8], [13.5, 8]],
    [[9, 3.5], [13.5, 8], [9, 12.5]],
  ],
};

export const GLYPH_KINDS = Object.keys(GLYPH_GRID);

// The strokes of a kind glyph in unit coordinates: the 16 px grid maps to
// -0.5 .. 0.5 around the icon center. An unknown kind gets the building.
// Made once per kind: the maps draw the icons on every frame.
const GLYPH_UNIT = Object.fromEntries(Object.entries(GLYPH_GRID).map(([kind, strokes]) => [kind, strokes.map((line) => line.map(([x, y]) => [(x - 8) / 16, (y - 8) / 16]))]));
export function glyphStrokes(kind) {
  return Object.hasOwn(GLYPH_UNIT, kind) ? GLYPH_UNIT[kind] : GLYPH_UNIT.building;
}

export function rectsOverlap(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

// The share of the icon size that the glyph grid covers, and its stroke.
export const GLYPH = { box: 0.6, line: 0.075 };

// The check mark of a Claimed icon: an ink disc at the lower right with a
// light check. Shares of the icon size, from the icon center.
export const CHECK = {
  at: [0.3, 0.3],
  r: 0.24,
  line: 0.08,
  mark: [[-0.11, 0.0], [-0.03, 0.09], [0.12, -0.08]],
};

// The unit direction [dx, dz] from a point to the nearest side of the level
// bounds: where the arrow of an edge marker points ("out of the map").
export function edgeDirection(at, bounds) {
  const sides = [
    [bounds.maxX - at[0], [1, 0]],
    [at[0] - bounds.minX, [-1, 0]],
    [bounds.maxZ - at[1], [0, 1]],
    [at[1] - bounds.minZ, [0, -1]],
  ];
  return sides.reduce((best, s) => (s[0] < best[0] ? s : best))[1];
}

// The map icons of the spots of a landmark view (landmarkView()).
// [{ id, spot: true, kind, state, look, name, x, z, out }]. `name` is null
// while the spot is Unknown. `out` is the arrow direction of an edge marker.
export function spotIcons(view, bounds = null) {
  return (view?.spots ?? []).map((s) => {
    const look = iconLook(s.kind, s.state);
    return {
      id: s.id,
      spot: true,
      kind: s.kind,
      state: s.state,
      look,
      name: look === "unknown" ? null : s.name,
      x: s.at[0],
      z: s.at[1],
      out: s.kind === "edge" && bounds ? edgeDirection(s.at, bounds) : null,
    };
  });
}

// The named parks of the level that no spot stands for. A park is left out
// when a spot has its name or names one of its areas as footprint.
export function parkIcons(level, data = null) {
  const names = new Set();
  const areaIds = new Set();
  for (const s of data?.spots ?? []) {
    names.add(s.name);
    for (const id of s.footprint?.areas ?? []) areaIds.add(id);
  }
  for (const a of level.areas ?? []) if (a.name && areaIds.has(a.id)) names.add(a.name);
  return mapParks(level).filter((p) => !names.has(p.name));
}

// Every icon of the maps: the spots, then the parks without a spot.
export function mapIcons(level, data, view) {
  return [...spotIcons(view, level.bounds), ...parkIcons(level, data)];
}

// Where the name of an icon goes on the full map: to the right of the icon,
// or to the left when the right side is off the screen or taken. Returns
// { x, align, rect } or null when no side is free. `taken` is the list of
// the rects of the names already drawn; `force` gives the first side that
// is on the screen (the chosen icon always shows its name).
export function namePlace(ix, iy, textWidth, screenWidth, taken = [], { gap = 17, force = false } = {}) {
  const sides = [
    { x: ix + gap, align: "left", rect: { x0: ix + gap - 2, x1: ix + gap + textWidth + 2, y0: iy - 9, y1: iy + 9 } },
    { x: ix - gap, align: "right", rect: { x0: ix - gap - textWidth - 2, x1: ix - gap + 2, y0: iy - 9, y1: iy + 9 } },
  ];
  const onScreen = sides.filter((s) => s.rect.x0 >= 2 && s.rect.x1 <= screenWidth - 2);
  const free = onScreen.find((s) => !taken.some((r) => rectsOverlap(r, s.rect)));
  return free ?? (force ? (onScreen[0] ?? sides[0]) : null);
}

// "n of N claimed" and "m of M found". N is the count of claim spots of the
// file and M the count of all its spots; no number is fixed here.
export function countLines(view) {
  const c = view?.counts ?? { spots: 0, claimSpots: 0, found: 0, claimed: 0 };
  return { claimed: `${c.claimed} of ${c.claimSpots} claimed`, found: `${c.found} of ${c.spots} found` };
}

// The text of the map for a screen reader. It names only the spots that are
// Found or Claimed.
export function mapSummary(view) {
  if (!view || view.spots.length === 0) return "";
  const lines = countLines(view);
  const names = view.spots.filter((s) => s.state !== "unknown").map((s) => s.name);
  return `Landmark spots: ${lines.found}, ${lines.claimed}.${names.length ? ` Found: ${names.join(", ")}.` : ""}`;
}

const STATUS = { unknown: "Not found yet", found: "Found", claimed: "Claimed", edge: "Found" };

// The Guide tab: the 2 counts and the spots by kind. A kind with no spot
// has no group. An Unknown spot has no name in its row.
export function guideModel(view) {
  const spots = view?.spots ?? [];
  const groups = [];
  for (const k of SPOT_KINDS) {
    const rows = spots
      .filter((s) => s.kind === k.kind)
      .map((s) => {
        const look = iconLook(s.kind, s.state);
        return { id: s.id, kind: s.kind, look, title: look === "unknown" ? "?" : s.name, status: STATUS[look] };
      });
    if (rows.length) groups.push({ kind: k.kind, title: k.title, rows });
  }
  return { counts: countLines(view), groups };
}

// A source link is an https URL from the data file, or nothing.
export function safeSourceUrl(url) {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname ? u.href : null;
  } catch {
    return null;
  }
}

export const PANEL_TEXT = {
  unknown: "Not found yet",
  claim: "Claim it to unlock",
  freeRun: "Start a timed run to claim it",
};

// What the panel of a spot shows, by state. `spot` is a spot of the
// landmark view; `card` is the fact list of the data file.
//   Unknown: "?" and "Not found yet". No name, no kind, no fact.
//   Found: the name, the `short` line, the challenge text and "Claim it to
//     unlock". In a free run: "Start a timed run to claim it" in place of
//     the last two (GDD Edge Cases).
//   Claimed, or an edge marker that is Found: the facts with their sources.
export function spotPanel(spot, card = [], { freeRun = false } = {}) {
  const look = iconLook(spot.kind, spot.state);
  if (look === "unknown") return { id: spot.id, look, kind: null, title: "?", kindLabel: null, short: null, hint: null, prompt: PANEL_TEXT.unknown, facts: [] };
  const kindLabel = SPOT_KINDS.find((k) => k.kind === spot.kind)?.one ?? null;
  const base = { id: spot.id, look, kind: spot.kind, title: spot.name, kindLabel, short: spot.short || null };
  if (!spot.cardUnlocked) {
    return { ...base, hint: freeRun ? null : (spot.challenge?.hint || null), prompt: freeRun ? PANEL_TEXT.freeRun : PANEL_TEXT.claim, facts: [] };
  }
  const facts = (card ?? [])
    .filter((f) => f && typeof f.text === "string" && f.text)
    .map((f) => ({ text: f.text, source: f.source && typeof f.source.name === "string" ? { name: f.source.name, url: safeSourceUrl(f.source.url) } : null }));
  return { ...base, hint: null, prompt: null, facts };
}

// The pulse of a newly claimed icon: one swell, then a ring that fades.
export const ICON_PULSE = { seconds: 0.7, swell: 0.4, ring: 1.3 };

// The pulse at `elapsed` seconds: { scale, ring: { r, alpha } } with `r` in
// icon sizes, or null when it is over. Reduced motion has no pulse.
export function pulseAt(elapsed, { reducedMotion = false } = {}, k = ICON_PULSE) {
  if (reducedMotion || !(elapsed >= 0) || elapsed >= k.seconds) return null;
  const t = elapsed / k.seconds;
  return { scale: 1 + k.swell * Math.sin(Math.PI * t), ring: { r: 0.5 + k.ring * t, alpha: 1 - t } };
}

// The ids of the icons that became Claimed since `prev` ({ id: look }).
// The first list (prev null) has none: a saved claim does not pulse on load.
export function newlyClaimed(prev, icons) {
  if (!prev) return [];
  return icons.filter((i) => i.spot && i.look === "claimed" && prev[i.id] !== undefined && prev[i.id] !== "claimed").map((i) => i.id);
}

export function looksOf(icons) {
  return Object.fromEntries(icons.filter((i) => i.spot).map((i) => [i.id, i.look]));
}

// The icons of one level, made again only when a spot changes. `tracker` is
// the landmark tracker (createLandmarkTracker) or null: then the level has
// no spots and the parks keep their icons. `version` goes up on each change.
export function createIconSource({ tracker = null, level, data = null }) {
  const parks = parkIcons(level, data);
  let found = null;
  let claimed = null;
  let view = null;
  let icons = parks;
  let version = 0;
  function sync() {
    if (!tracker) return;
    const s = tracker.state;
    // The state is immutable: the 2 lists change identity when a spot changes.
    if (s.found === found && s.claimed === claimed) return;
    found = s.found;
    claimed = s.claimed;
    view = tracker.view();
    icons = [...spotIcons(view, level.bounds), ...parks];
    version += 1;
  }
  return {
    get icons() {
      sync();
      return icons;
    },
    get view() {
      sync();
      return view;
    },
    get version() {
      sync();
      return version;
    },
    // The fact list of a spot, from the prepared spots of the tracker.
    card: (id) => tracker?.state.spots.find((s) => s.id === id)?.card ?? [],
  };
}
