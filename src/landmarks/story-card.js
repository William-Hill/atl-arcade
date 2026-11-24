// The landmark story card (#220). Pure: no DOM, no Three.js.
//
// Design: design/gdd/landmark-discovery.md ("Story card", "UI Requirements",
// rule 7). A portrait 3:4 trading card on paper #f5ecd7 with an ink border:
// a header band in the district accent, the in-game art, the name and the
// kind glyph, 3 to 5 facts with source links, a "NEW" stamp on a first
// claim, and a foil edge on a hard spot (off with reduced motion, in CSS).
//
// The card shows only on the full map and on the results screen, never
// during play (rule 7, AC-7). This module only makes the model: the DOM is
// src/ui/landmark-guide.js (the panel) and src/ui/story-card-view.js.

import { spotPanel } from "../ui/landmark-icons.js";
import { claimedFill, contrast } from "../ui/landmark-banner.js";

export const STORY_CARD = {
  paper: "#f5ecd7",
  ink: "#0b0b12",
  maxFacts: 5,
  stamp: "NEW",
  foilTier: "hard",
  band: "#c9962e", // the band with no district accent
  minContrast: 4.5,
};

// The band color for a district accent: the accent, made lighter until the
// ink reads on it at 4.5:1 (the rule of the Claimed banner).
export function bandColor(accent, k = STORY_CARD) {
  return claimedFill(typeof accent === "string" && /^#[0-9a-f]{6}$/i.test(accent) ? accent : k.band);
}

// The ids of the spots that this run claimed, in claim order, with `first`
// (true on the first claim of the save). `run` is landmarkView().run.
export function runClaims(run) {
  const seen = new Set();
  const out = [];
  for (const c of run?.claimed ?? []) {
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, first: Boolean(c.first) });
  }
  return out;
}

// True when this run claimed `id` for the first time: the card gets "NEW".
export function isFirstClaim(run, id) {
  return runClaims(run).some((c) => c.id === id && c.first);
}

// The story card of a spot of landmarkView(), or null when its card is not
// unlocked (a Found claim spot, an Unknown spot). `card` is its fact list
// from landmarks.json. Options:
//   first: true on a first claim in this run ("NEW" stamp).
//   accent: the district accent (a hex color) for the band.
//   art: the URL of the render (src/landmarks/card-art.js cardArtUrl()).
export function storyCardModel(spot, card = [], { first = false, accent = null, art = null } = {}, k = STORY_CARD) {
  if (!spot || !spot.cardUnlocked) return null;
  const panel = spotPanel(spot, card);
  const tier = spot.challenge?.tier ?? null;
  const band = bandColor(accent, k);
  return {
    id: spot.id,
    look: panel.look,
    kind: spot.kind,
    kindLabel: panel.kindLabel,
    title: panel.title,
    tier,
    foil: tier === k.foilTier,
    stamp: first ? k.stamp : null,
    band,
    bandContrast: Math.round(contrast(band, k.ink) * 100) / 100,
    art: typeof art === "string" && art ? { src: art, alt: `${panel.title}, a view in the game` } : null,
    facts: panel.facts.slice(0, k.maxFacts),
  };
}

// The cards of the results row: one for each spot that this run claimed, in
// claim order. `view` is landmarkView(); `cardOf(id)` gives the fact list;
// `accentOf(spot)` and `artOf(id)` give the band accent and the render.
export function resultsCards(view, { cardOf = () => [], accentOf = () => null, artOf = () => null } = {}, k = STORY_CARD) {
  if (!view) return [];
  const out = [];
  for (const c of runClaims(view.run)) {
    const spot = view.spots.find((s) => s.id === c.id);
    const model = storyCardModel(spot, cardOf(c.id), { first: c.first, accent: accentOf(spot), art: artOf(c.id) }, k);
    if (model) out.push(model);
  }
  return out;
}

// The label of a card button in the results row, for a screen reader.
export function cardButtonLabel(model) {
  return `${model.title}${model.stamp ? ", new" : ""}. Open the story card`;
}
