import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STORY_CARD, bandColor, cardButtonLabel, isFirstClaim, resultsCards, runClaims, storyCardModel } from "./story-card.js";
import { createLandmarks, landmarkView, markSpot, prepareLandmarks, startLandmarkRun } from "../sim/landmarks.js";
import { contrast } from "../ui/landmark-banner.js";
import { DISTRICT_LOOKS } from "../render/pbr-palette.js";

const FACT = (n) => ({ text: `Fact ${n}.`, source: { name: `Source ${n}`, url: `https://example.org/${n}` } });
const DATA = {
  v: 1,
  level: "test-level",
  spots: [
    { id: "tower", kind: "building", name: "Tower Market", at: [0, 0], find: { r: 20 }, short: "A tower.", card: [1, 2, 3, 4, 5, 6].map(FACT), challenge: { type: "combo", tier: "hard", hint: "Land a combo", zone: { x: 0, z: 0, r: 10 } } },
    { id: "bridge", kind: "bridge", name: "Trail Bridge", at: [300, 0], find: { r: 20 }, short: "A bridge.", card: [1, 2, 3].map(FACT), challenge: { type: "gap", tier: "easy", hint: "Hop it", zone: { x: 300, z: 0, r: 8 } } },
    { id: "district", kind: "edge", name: "Old District", at: [900, 0], find: { r: 20 }, short: "East of here.", card: [FACT(1), { text: "Bad link.", source: { name: "Plain", url: "javascript:alert(1)" } }, FACT(3)] },
  ],
};
const spotsOf = () => prepareLandmarks(DATA);
const fresh = (progress = {}) => createLandmarks(spotsOf(), { level: DATA.level, progress });
const viewSpot = (state, id) => landmarkView(state).spots.find((s) => s.id === id);
const cardOf = (id) => DATA.spots.find((s) => s.id === id).card;

describe("when a story card model is made", () => {
  it("gives no card for an Unknown spot or a Found claim spot", () => {
    let s = fresh();
    expect(storyCardModel(viewSpot(s, "tower"), cardOf("tower"))).toBeNull();
    s = markSpot(s, "tower", "found");
    expect(storyCardModel(viewSpot(s, "tower"), cardOf("tower"))).toBeNull();
  });

  it("gives the card of a Claimed spot, with at most 5 facts, the foil of a hard spot and the art", () => {
    const s = markSpot(fresh(), "tower", "claimed");
    const m = storyCardModel(viewSpot(s, "tower"), cardOf("tower"), { first: true, accent: "#ff5fb2", art: "/landmark-cards/tower.jpg" });
    expect(m).toMatchObject({ id: "tower", look: "claimed", kind: "building", kindLabel: "Building", title: "Tower Market", tier: "hard", foil: true, stamp: "NEW" });
    expect(m.facts).toHaveLength(STORY_CARD.maxFacts);
    expect(m.facts[0]).toEqual({ text: "Fact 1.", source: { name: "Source 1", url: "https://example.org/1" } });
    expect(m.art).toEqual({ src: "/landmark-cards/tower.jpg", alt: "Tower Market, a view in the game" });
  });

  it("gives no foil to an easy spot, and no stamp when the claim is not new", () => {
    const s = markSpot(fresh(), "bridge", "claimed");
    const m = storyCardModel(viewSpot(s, "bridge"), cardOf("bridge"), { first: false });
    expect(m.foil).toBe(false);
    expect(m.stamp).toBeNull();
    expect(m.art).toBeNull();
  });

  it("opens the card of a Found edge marker, with no foil, and drops a link that is not https", () => {
    const s = markSpot(fresh(), "district", "found");
    const m = storyCardModel(viewSpot(s, "district"), cardOf("district"));
    expect(m).toMatchObject({ look: "edge", tier: null, foil: false });
    expect(m.facts[1].source).toEqual({ name: "Plain", url: null });
  });

  it("makes a band that the ink reads on at 4.5:1 or more, for every district accent", () => {
    for (const look of Object.values(DISTRICT_LOOKS)) {
      for (const accent of look.accent) expect(contrast(bandColor(accent), STORY_CARD.ink)).toBeGreaterThanOrEqual(STORY_CARD.minContrast);
    }
    expect(bandColor("not a color")).toBe(bandColor(STORY_CARD.band));
    const m = storyCardModel(viewSpot(markSpot(fresh(), "tower", "claimed"), "tower"), cardOf("tower"), { accent: "#1d2a6b" });
    expect(m.bandContrast).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the ink on the paper at 4.5:1 or more", () => {
    expect(contrast(STORY_CARD.paper, STORY_CARD.ink)).toBeGreaterThanOrEqual(STORY_CARD.minContrast);
    // The link blue and the stamp pink of src/ui/story-card.css.
    expect(contrast(STORY_CARD.paper, "#1d4f91")).toBeGreaterThanOrEqual(STORY_CARD.minContrast);
    expect(contrast(STORY_CARD.paper, "#a3135f")).toBeGreaterThanOrEqual(STORY_CARD.minContrast);
  });
});

describe("when the results row is made", () => {
  it("lists the spots that this run claimed, in claim order, with NEW on a first claim", () => {
    let s = fresh();
    s = markSpot(s, "bridge", "claimed");
    s = markSpot(s, "tower", "claimed");
    s = markSpot(s, "district", "found");
    const view = landmarkView(s);
    expect(runClaims(view.run)).toEqual([
      { id: "bridge", first: true },
      { id: "tower", first: true },
    ]);
    const cards = resultsCards(view, { cardOf, artOf: (id) => `/landmark-cards/${id}.jpg` });
    expect(cards.map((c) => [c.id, c.stamp])).toEqual([
      ["bridge", "NEW"],
      ["tower", "NEW"],
    ]);
    expect(isFirstClaim(view.run, "tower")).toBe(true);
    expect(isFirstClaim(view.run, "district")).toBe(false);
    expect(cardButtonLabel(cards[0])).toBe("Trail Bridge, new. Open the story card");
  });

  it("is empty in a new run, though the claims of the save stay (AC-6)", () => {
    const s = startLandmarkRun(markSpot(fresh(), "tower", "claimed"));
    const view = landmarkView(s);
    expect(view.spots.find((x) => x.id === "tower").state).toBe("claimed");
    expect(resultsCards(view, { cardOf })).toEqual([]);
    expect(isFirstClaim(view.run, "tower")).toBe(false);
  });

  it("shows a claim with no points but no NEW stamp, and lists a spot once", () => {
    const run = { claimed: [{ id: "tower", points: 0, first: false }, { id: "tower", points: 0, first: false }, null], claimSum: 0 };
    expect(runClaims(run)).toEqual([{ id: "tower", first: false }]);
    expect(runClaims(null)).toEqual([]);
    expect(resultsCards(null)).toEqual([]);
  });

  it("gives a card with 3 to 5 facts for every spot of the shipped level", () => {
    const file = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/landmarks.json", import.meta.url), "utf8"));
    for (const spot of file.spots) {
      const s = { id: spot.id, kind: spot.kind, name: spot.name, state: spot.kind === "edge" ? "found" : "claimed", cardUnlocked: true, challenge: spot.challenge ?? null };
      const m = storyCardModel(s, spot.card);
      expect(m.facts.length, spot.id).toBeGreaterThanOrEqual(3);
      expect(m.facts.length, spot.id).toBeLessThanOrEqual(5);
      expect(m.facts.every((f) => f.source && f.source.url && f.source.url.startsWith("https://")), spot.id).toBe(true);
    }
  });
});
