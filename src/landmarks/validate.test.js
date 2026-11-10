import { beforeAll, describe, expect, it } from "vitest";
import { LANDMARK_RULES, grindMeters, isPrimarySource, landmarkCounts, onPaved, outlineDistance, validateLandmarks } from "./validate.js";
import { checkLevel } from "../../scripts/validate-landmarks.mjs";

// A small level: a trail along z = 0, a square building north of it, a
// park south of it, a 30 m rail, and a 10 m rail.
const LEVEL = {
  name: "test-level",
  bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
  buildings: [{ id: "b1", outer: [[-10, -30], [10, -30], [10, -6], [-10, -6]] }],
  areas: [{ id: "a1", kind: "park", outer: [[-20, 5], [20, 5], [20, 40], [-20, 40]] }],
  strips: [
    { id: "t1", kind: "trail", width: 4, points: [[-90, 0], [90, 0]] },
    { id: "s1", kind: "street", width: 8, points: [[-90, 60], [90, 60]] },
  ],
};
const CTX = {
  level: LEVEL,
  grindables: [
    { id: "rail:long", total: 30, points: [[0, 0.5, 2], [30, 0.5, 2]] },
    { id: "rail:short", total: 10, points: [[-40, 0.5, 2], [-30, 0.5, 2]] },
  ],
  goals: [{ id: "gap-test", type: "gap", zone: { x: 50, z: 0, r: 12 } }],
  permissions: ["2026-11-10-artist.md"],
};

const fact = (n, url = "https://npgallery.nps.gov/AssetDetail/NRIS/1") => ({ text: `The warehouse opened in 19${10 + n}.`, source: { name: "National Park Service", url } });
const card = () => [fact(1), fact(2), fact(3)];
const building = (over = {}) => ({
  id: "old-warehouse",
  kind: "building",
  name: "Old Warehouse",
  at: [0, -18],
  footprint: { building: "b1" },
  find: { edge: 8 },
  short: "A 1911 warehouse on the old rail line.",
  card: card(),
  challenge: { type: "combo", tier: "typical", hint: "Land a 1,000 point combo here", zone: { x: 0, z: 0, r: 10 }, points: 1000 },
  ...over,
});
const file = (...spots) => ({ v: 1, level: "test-level", spots });
const errorsOf = (...spots) => validateLandmarks(file(...spots), CTX);

describe("validateLandmarks", () => {
  it("passes a complete spot of each challenge type and an edge marker", () => {
    const spots = [
      building(),
      building({ id: "gap-spot", kind: "bridge", footprint: undefined, at: [50, 0], find: { r: 20 }, challenge: { type: "gap", tier: "easy", hint: "Hop under the bridge", zone: { x: 50, z: 0, r: 12 }, goal: "gap-test" } }),
      building({ id: "grind-spot", kind: "park", at: [0, 20], footprint: { areas: ["a1"] }, challenge: { type: "grind", tier: "typical", hint: "Grind the long rail", feature: "rail:long", zone: { x: 10, z: 2, r: 15 }, meters: 15 } }),
      building({ id: "line-spot", challenge: { type: "line", tier: "typical", hint: "Ride the 3 rings in order", checkpoints: [[-30, 0], [0, 0], [30, 0]], seconds: 14 } }),
      building({ id: "edge-spot", kind: "edge", footprint: undefined, at: [95, 0], find: { at: [90, 0], r: 20 }, challenge: undefined }),
    ];
    expect(errorsOf(...spots)).toEqual([]);
    expect(landmarkCounts(file(...spots))).toMatchObject({ spots: 5, claim: 4, edge: 1 });
  });

  it("needs every field of rule 1 (AC-1)", () => {
    expect(errorsOf(building({ id: "Bad Id" }))[0]).toMatch(/id needs/);
    expect(errorsOf(building(), building())).toContain("old-warehouse: id is used twice");
    expect(errorsOf(building({ kind: "castle" }))[0]).toMatch(/kind "castle"/);
    expect(errorsOf(building({ name: "" }))[0]).toMatch(/name is missing/);
    expect(errorsOf(building({ at: [0] }))[0]).toMatch(/`at` needs/);
    expect(errorsOf(building({ at: [0, 50] }))).toContain("old-warehouse: `at` is not inside the footprint");
    expect(errorsOf(building({ find: {} }))[0]).toMatch(/`find` needs/);
    expect(errorsOf(building({ find: { edge: 8, r: 20 } }))[0]).toMatch(/not both/);
    expect(errorsOf(building({ challenge: undefined }))).toContain("old-warehouse: challenge is missing");
    expect(errorsOf(building({ kind: "edge" }))).toContain("old-warehouse: an edge marker has no challenge");
  });

  it("keeps the find value in the GDD range and near a paved way", () => {
    expect(errorsOf(building({ find: { edge: 13 } }))[0]).toMatch(/find.edge is 13/);
    expect(errorsOf(building({ find: { edge: 4 } }))[0]).toMatch(/no trail, path, or sidewalk comes within find.edge/);
    expect(errorsOf(building({ footprint: undefined, find: { r: 9 } }))[0]).toMatch(/find.r is 9/);
    expect(errorsOf(building({ footprint: undefined, find: { at: [0, -60], r: 20 } }))[0]).toMatch(/within find.r/);
    expect(errorsOf(building({ footprint: undefined, find: { at: [99, 0], r: 20 } }))[0]).toMatch(/outside the edge fence/);
    expect(errorsOf(building({ footprint: { building: "nope" } }))[0]).toMatch(/not a building of the level/);
  });

  it("rejects a `short` line over 90 characters", () => {
    expect(errorsOf(building({ short: "x".repeat(90) }))).toEqual([]);
    expect(errorsOf(building({ short: "x".repeat(91) }))).toEqual(["old-warehouse: short has 91 characters (max 90)"]);
  });

  it("needs 3 to 5 facts, each with a source name and URL (S-1)", () => {
    expect(errorsOf(building({ card: card().slice(0, 2) }))[0]).toMatch(/card needs 3 to 5 facts \(has 2\)/);
    expect(errorsOf(building({ card: [1, 2, 3, 4, 5, 6].map((n) => fact(n)) }))[0]).toMatch(/has 6/);
    const noSource = card();
    delete noSource[1].source;
    expect(errorsOf(building({ card: noSource }))).toEqual(["old-warehouse: card fact 2 has no source (name and URL)"]);
    const noUrl = card();
    noUrl[0].source = { name: "National Park Service" };
    expect(errorsOf(building({ card: noUrl }))).toEqual(["old-warehouse: card fact 1 has no source (name and URL)"]);
    const http = card();
    http[2].source.url = "http://npgallery.nps.gov/x";
    expect(errorsOf(building({ card: http }))[0]).toMatch(/not an https URL/);
    expect(errorsOf(building({ card: [fact(1), fact(1), fact(2)] }))[0]).toMatch(/repeats another fact/);
  });

  it("needs a primary source for each fact (S-3)", () => {
    expect(errorsOf(building({ card: [fact(1), fact(2), fact(3, "https://en.wikipedia.org/wiki/Warehouse")] }))).toEqual(['old-warehouse: card fact 3 source "en.wikipedia.org" is not a primary source']);
    expect(errorsOf(building({ card: [fact(1), fact(2), fact(3, "https://oldwarehouse.example/history")] }))[0]).toMatch(/not a primary source/);
    // The spot's own site is a source when the spot names it.
    expect(errorsOf(building({ site: "oldwarehouse.example", card: [fact(1), fact(2), fact(3, "https://www.oldwarehouse.example/history")] }))).toEqual([]);
    expect(errorsOf(building({ site: "wikipedia.org" }))[0]).toMatch(/cannot be a source/);
    // A bare suffix is not a site: it would take in every host under it.
    expect(errorsOf(building({ site: "example", card: [fact(1), fact(2), fact(3, "https://www.oldwarehouse.example/history")] }))[0]).toMatch(/cannot be a source/);
    expect(isPrimarySource("https://some-blog.com/post", "com")).toBe(false);
    expect(isPrimarySource("https://beltline.org/places-to-go/eastside-trail")).toBe(true);
    expect(isPrimarySource("https://www.nps.gov/malu/index.htm")).toBe(true);
    expect(isPrimarySource("https://notnps.gov/x")).toBe(false);
    // Not in the list of docs/decisions.md.
    expect(isPrimarySource("https://www.archives.gov/x")).toBe(false);
    expect(isPrimarySource("https://en.wikipedia.org/wiki/X", "wikipedia.org")).toBe(false);
  });

  it("rejects the words that the political rules forbid", () => {
    const bad = card();
    bad[0].text = "The block saw years of decline.";
    expect(errorsOf(building({ card: bad }))[0]).toMatch(/the word "decline"/);
    expect(errorsOf(building({ challenge: { ...building().challenge, hint: "Do not bail here" } }))[0]).toMatch(/the word "bail"/);
  });

  it("ships an art spot only with a cleared credit (S-2)", () => {
    const art = (credit) => building({ id: "trail-art", kind: "art", footprint: undefined, at: [0, 0], find: { r: 14 }, credit });
    expect(errorsOf(art(undefined))).toEqual(["trail-art: an art spot needs a `credit`"]);
    expect(errorsOf(art({ artist: "A. Painter", title: "Oaks", year: 2015, permission: "asked", ref: "2026-11-10-artist.md" }))[0]).toMatch(/ships only with "written"/);
    expect(errorsOf(art({ artist: "A. Painter", title: "Oaks", year: 2015, permission: "written", ref: "missing.md" }))[0]).toMatch(/not a file in docs\/permissions/);
    expect(errorsOf(art({ artist: "A. Painter", title: "Oaks", year: 2015, permission: "written", ref: "2026-11-10-artist.md" }))).toEqual([]);
    expect(errorsOf(building({ credit: { artist: "A" } }))[0]).toMatch(/for an art spot only/);
  });

  it("rejects a hard grind on a rail under 11 m (F-4)", () => {
    const grind = (c) => building({ challenge: { type: "grind", hint: "Grind the rail", zone: { x: -35, z: 2, r: 15 }, ...c } });
    expect(errorsOf(grind({ tier: "hard", feature: "rail:short", meters: 8 }))).toContain('old-warehouse: a hard grind needs a rail of 11 m or more ("rail:short" is 10.0 m)');
    // The typical tier fits: min(15, 0.8 * 10) = 8 m.
    expect(errorsOf(grind({ tier: "typical", feature: "rail:short", meters: 8 }))).toEqual([]);
    expect(errorsOf(grind({ tier: "typical", feature: "rail:short", meters: 15 }))[0]).toMatch(/challenge.meters is 15/);
    // min(24, 0.8 * 30) = 24 m on the 30 m rail.
    expect(errorsOf(grind({ tier: "hard", feature: "rail:long", meters: 24, zone: { x: 10, z: 2, r: 15 } }))).toEqual([]);
    // The zone holds the middle of the rail and neither of its 2 points.
    expect(errorsOf(grind({ tier: "typical", feature: "rail:long", meters: 15, zone: { x: 15, z: 2, r: 8 } }))).toEqual([]);
    expect(grindMeters("typical", 12.5)).toBe(10);
    expect(grindMeters("easy", 9.96)).toBe(8);
    expect(grindMeters("hard", 60)).toBe(24);
    expect(errorsOf(grind({ tier: "easy", feature: "rail:none", meters: 9 }))[0]).toMatch(/not a grind feature of the level/);
    expect(errorsOf(grind({ tier: "easy", feature: "rail:long", meters: 9 }))[0]).toMatch(/does not pass through challenge.zone/);
  });

  it("checks the gap, line, and combo values against the formulas", () => {
    const gap = (c) => building({ challenge: { type: "gap", hint: "Hop the gap", ...c } });
    expect(errorsOf(gap({ tier: "typical", zone: { x: 0, z: 0, r: 12 } }))[0]).toMatch(/the tier gives 8/);
    expect(errorsOf(gap({ tier: "typical", zone: { x: 0, z: 30, r: 8 } }))[0]).toMatch(/not on a trail, a path, or a sidewalk/);
    expect(errorsOf(gap({ tier: "hard", zone: { x: 0, z: 0, r: 5 } }))[0]).toMatch(/challenge.landing needs/);
    expect(errorsOf(gap({ tier: "hard", zone: { x: 0, z: 0, r: 5 }, landing: { x: 6, z: 0, r: 3 } }))).toEqual([]);
    expect(errorsOf(gap({ tier: "hard", zone: { x: 0, z: 0, r: 5 }, landing: { x: 60, z: 0, r: 3 } }))[0]).toMatch(/more than 12 m from challenge.zone/);
    expect(errorsOf(gap({ tier: "easy", zone: { x: 40, z: 0, r: 12 }, goal: "gap-test" }))[0]).toMatch(/not the zone of the goal/);

    const line = (c) => building({ challenge: { type: "line", hint: "Ride the rings in order", ...c } });
    expect(errorsOf(line({ tier: "typical", checkpoints: [[-30, 0], [0, 0], [30, 0]], seconds: 15 }))[0]).toMatch(/the formula gives 14/);
    expect(errorsOf(line({ tier: "easy", checkpoints: [[-40, 0], [0, 0], [40, 0]], seconds: 24 }))).toEqual([]);
    expect(errorsOf(line({ tier: "typical", checkpoints: [[0, 0], [30, 0]], seconds: 7 }))).toEqual([]);
    expect(errorsOf(line({ tier: "typical", checkpoints: [[0, 0], [45, 0]], seconds: 7 }))[0]).toMatch(/the tier gives 30 m/);
    expect(errorsOf(line({ tier: "typical", checkpoints: [[0, 0]], seconds: 7 }))[0]).toMatch(/needs 2 to 3 points/);

    expect(errorsOf(building({ challenge: { ...building().challenge, points: 999 } }))[0]).toMatch(/the tier gives 1000/);
    expect(errorsOf(building({ challenge: { ...building().challenge, zone: { x: 0, z: 0, r: 12 } } }))[0]).toMatch(/the tier gives 10/);
  });

  it("checks the file header", () => {
    expect(validateLandmarks({ v: 2, level: "other", spots: [building()] }, CTX)).toEqual(["v is 2 (this validator reads version 1)", 'level is "other" (the level file says "test-level")']);
    expect(validateLandmarks({ v: 1, level: "test-level", spots: [] }, CTX)).toEqual(["spots is missing or empty"]);
  });
});

describe("geometry helpers", () => {
  it("measures the distance to a shape, 0 inside it and not 0 in a hole", () => {
    const withHole = [LEVEL.buildings[0].outer, [[-2, -20], [2, -20], [2, -16], [-2, -16]]];
    expect(outlineDistance([0, -18], withHole)).toBeCloseTo(2);
    const ring = [LEVEL.buildings[0].outer];
    expect(outlineDistance([0, -18], ring)).toBe(0);
    expect(outlineDistance([0, 2], ring)).toBeCloseTo(8);
    expect(outlineDistance([13, -2], ring)).toBeCloseTo(5);
  });

  it("knows a paved way from a street", () => {
    expect(onPaved([0, 3], LEVEL)).toBe(true);
    expect(onPaved([0, 4], LEVEL)).toBe(false);
    expect(onPaved([0, 60], LEVEL)).toBe(false);
  });
});

describe("levels/beltline-eastside/landmarks.json", () => {
  let data;
  let errors;
  beforeAll(() => {
    ({ data, errors } = checkLevel("beltline-eastside"));
  });

  it("passes the validator (AC-1, S-1, S-2, S-3)", () => {
    expect(errors).toEqual([]);
  });

  it("has no art spot and no skate spot until their gates clear", () => {
    // Art: written permission (GDD open question 5). Skate: issue #222.
    expect(data.spots.filter((s) => s.kind === "art" || s.kind === "skate")).toEqual([]);
  });

  it("has the 2 edge markers, and each existing gap goal at most once", () => {
    expect(data.spots.filter((s) => s.kind === "edge").map((s) => s.id).sort()).toEqual(["inman-park-historic-district", "jimmy-carter-library"]);
    expect(landmarkCounts(data).claim).toBe(data.spots.length - 2);
  });

  it("keeps each `short` line and each fact a single sentence within its limit", () => {
    for (const s of data.spots) {
      expect([...s.short].length).toBeLessThanOrEqual(LANDMARK_RULES.shortMax);
      for (const f of s.card) expect(f.text.endsWith(".")).toBe(true);
    }
  });
});
